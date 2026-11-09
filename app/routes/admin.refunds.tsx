import { useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/admin.refunds";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import {
  approveRefundRequest,
  declineRefundRequest,
  getWaitingRefundRequests,
} from "~/lib/refund-requests.server";
import { formatPrice } from "~/lib/utils";
import { RefundStatus, UserRole, users } from "~/db/schema";
import { db } from "~/db";
import { eq } from "drizzle-orm";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, ReceiptText } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";

const resolveRefundRequestSchema = z.object({
  intent: z.enum(["approve", "decline"]),
  refundRequestId: z.coerce.number().int(),
});

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/**
 * Only an Admin resolves a Refund Request — never the course's Instructor.
 * Returns the Admin's user id.
 */
async function requireAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to manage refunds.", {
      status: 401,
    });
  }

  const currentUser = getUserById(currentUserId);

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can resolve refund requests.", { status: 403 });
  }

  return currentUser.id;
}

/**
 * The email the student gets once their Refund Request is resolved. There is
 * no mail transport wired up yet, so the built message goes to the server log.
 */
function buildRefundResolvedEmail(input: {
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  status: RefundStatus.Approved | RefundStatus.Declined;
  amountRefunded: number | null;
}) {
  const approved = input.status === RefundStatus.Approved;

  return {
    to: input.studentEmail,
    subject: approved
      ? `Refund approved — ${input.courseTitle}`
      : `Refund request declined — ${input.courseTitle}`,
    body: [
      `Hi ${input.studentName},`,
      "",
      approved
        ? `We have approved your refund request for "${input.courseTitle}". ${formatPrice(input.amountRefunded ?? 0)} is on its way back to the card you paid with, and your access to the course has ended.`
        : `We have declined your refund request for "${input.courseTitle}". You keep your access to the course.`,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline refund requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  return { refundRequests: getWaitingRefundRequests() };
}

export async function action({ request }: Route.ActionArgs) {
  const adminId = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, resolveRefundRequestSchema);

  if (!parsed.success) {
    throw data("Invalid refund request.", { status: 400 });
  }

  const { intent, refundRequestId } = parsed.data;
  const result =
    intent === "approve"
      ? approveRefundRequest(refundRequestId, adminId)
      : declineRefundRequest(refundRequestId, adminId);

  if (!result.ok) {
    if (result.reason === "not-found") {
      throw data("Refund request not found.", { status: 404 });
    }
    throw data("This refund request has already been resolved.", {
      status: 409,
    });
  }

  const email = buildRefundResolvedEmail(result);
  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);

  return { resolved: result.status };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <div className="mb-8">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-2 h-5 w-80" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    </div>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve a request to refund what the student paid and end their access
          to the course, or decline it. Either decision is final.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <ReceiptText className="size-4" />
        <span>
          {refundRequests.length}{" "}
          {refundRequests.length === 1 ? "request" : "requests"} waiting
        </span>
      </div>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No refund requests are waiting.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {refundRequests.map((refundRequest) => (
            <RefundRequestCard
              key={refundRequest.id}
              refundRequest={refundRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RefundRequestCard({
  refundRequest,
}: {
  refundRequest: Route.ComponentProps["loaderData"]["refundRequests"][number];
}) {
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";
  const pendingIntent = fetcher.formData?.get("intent");

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    toast.success(
      fetcher.data.resolved === RefundStatus.Approved
        ? `Refunded ${refundRequest.studentName}.`
        : `Declined ${refundRequest.studentName}'s request.`
    );
  }, [fetcher.state, fetcher.data, refundRequest.studentName]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={`/courses/${refundRequest.courseSlug}`}
              className="font-medium hover:underline"
            >
              {refundRequest.courseTitle}
            </Link>
            <p className="text-sm text-muted-foreground">
              {refundRequest.studentName} · {refundRequest.studentEmail}
            </p>
          </div>
          <span className="shrink-0 text-lg font-semibold">
            {formatPrice(refundRequest.amountPaid)}
          </span>
        </div>

        <p className="mt-3 text-sm">{refundRequest.reason}</p>

        <p className="mt-3 text-xs text-muted-foreground">
          Bought {new Date(refundRequest.purchasedAt).toLocaleDateString()} ·
          requested {new Date(refundRequest.requestedAt).toLocaleDateString()}
        </p>

        <fetcher.Form method="post" className="mt-4 flex gap-2">
          <input
            type="hidden"
            name="refundRequestId"
            value={refundRequest.id}
          />
          <Button
            type="submit"
            name="intent"
            value="approve"
            size="sm"
            disabled={isSubmitting}
          >
            {pendingIntent === "approve" ? "Approving..." : "Approve refund"}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="decline"
            variant="outline"
            size="sm"
            disabled={isSubmitting}
          >
            {pendingIntent === "decline" ? "Declining..." : "Decline"}
          </Button>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
