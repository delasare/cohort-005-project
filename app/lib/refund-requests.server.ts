import { and, asc, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  enrollments,
  purchases,
  refunds,
  users,
  RefundStatus,
} from "~/db/schema";

/**
 * Every Refund Request still waiting on an Admin, oldest first, with what the
 * Admin needs to decide it.
 */
export function getWaitingRefundRequests() {
  return db
    .select({
      id: refunds.id,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      amountPaid: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
      studentName: users.name,
      studentEmail: users.email,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.status, RefundStatus.Requested))
    .orderBy(asc(refunds.requestedAt))
    .all();
}

export type RefundResolution =
  | {
      ok: true;
      status: RefundStatus.Approved | RefundStatus.Declined;
      studentName: string;
      studentEmail: string;
      courseTitle: string;
      amountRefunded: number | null;
    }
  | { ok: false; reason: "not-found" | "already-resolved" };

function getRequestWithPurchase(refundRequestId: number) {
  return db
    .select({
      status: refunds.status,
      userId: purchases.userId,
      courseId: purchases.courseId,
      amountPaid: purchases.amountPaid,
      studentName: users.name,
      studentEmail: users.email,
      courseTitle: courses.title,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.id, refundRequestId))
    .get();
}

function resolve(
  refundRequestId: number,
  adminId: number,
  status: RefundStatus.Approved | RefundStatus.Declined,
  now: Date
): RefundResolution {
  return db.transaction((tx) => {
    const request = getRequestWithPurchase(refundRequestId);

    if (!request) return { ok: false, reason: "not-found" };
    if (request.status !== RefundStatus.Requested) {
      return { ok: false, reason: "already-resolved" };
    }

    // The Refund Amount is always what was paid, so there is no partial
    // refund to record.
    const amountRefunded =
      status === RefundStatus.Approved ? request.amountPaid : null;

    tx.update(refunds)
      .set({
        status,
        amountRefunded,
        resolvedAt: now.toISOString(),
        resolvedByUserId: adminId,
      })
      .where(eq(refunds.id, refundRequestId))
      .run();

    // A Refund ends access to the course. Lesson progress and watch history
    // stay, so a student who buys again picks up where they left off.
    if (status === RefundStatus.Approved) {
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, request.userId),
            eq(enrollments.courseId, request.courseId)
          )
        )
        .run();
    }

    return {
      ok: true,
      status,
      studentName: request.studentName,
      studentEmail: request.studentEmail,
      courseTitle: request.courseTitle,
      amountRefunded,
    };
  });
}

export function approveRefundRequest(
  refundRequestId: number,
  adminId: number,
  now: Date = new Date()
) {
  return resolve(refundRequestId, adminId, RefundStatus.Approved, now);
}

export function declineRefundRequest(
  refundRequestId: number,
  adminId: number,
  now: Date = new Date()
) {
  return resolve(refundRequestId, adminId, RefundStatus.Declined, now);
}
