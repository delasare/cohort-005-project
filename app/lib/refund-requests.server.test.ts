import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  approveRefundRequest,
  declineRefundRequest,
  getWaitingRefundRequests,
} from "./refund-requests.server";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

const RESOLVED_AT = new Date(2026, 10, 9, 12, 0);

let studentId: number;
let adminId: number;
let courseId: number;
let lessonId: number;
let refundRequestId: number;

function enrollmentExists() {
  return (
    testDb
      .select()
      .from(schema.enrollments)
      .where(eq(schema.enrollments.userId, studentId))
      .get() !== undefined
  );
}

function getRefundRequest() {
  const row = testDb
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.id, refundRequestId))
    .get();
  if (!row) throw new Error("Refund Request missing");
  return row;
}

beforeEach(() => {
  testDb = createTestDb();
  const base = seedBaseData(testDb);
  studentId = base.user.id;
  courseId = base.course.id;

  adminId = testDb
    .insert(schema.users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      role: schema.UserRole.Admin,
    })
    .returning()
    .get().id;

  const module = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  lessonId = testDb
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson", position: 1 })
    .returning()
    .get().id;

  const purchase = testDb
    .insert(schema.purchases)
    .values({ userId: studentId, courseId, amountPaid: 5900, country: null })
    .returning()
    .get();
  testDb
    .insert(schema.enrollments)
    .values({ userId: studentId, courseId })
    .run();
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId: studentId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
    })
    .run();

  refundRequestId = testDb
    .insert(schema.refunds)
    .values({ purchaseId: purchase.id, reason: "Not what I expected" })
    .returning()
    .get().id;
});

describe("approveRefundRequest", () => {
  it("records a Refund of the amount paid, and who approved it when", () => {
    const result = approveRefundRequest(refundRequestId, adminId, RESOLVED_AT);

    expect(result).toMatchObject({
      ok: true,
      status: schema.RefundStatus.Approved,
      studentEmail: "test@example.com",
      courseTitle: "Test Course",
      amountRefunded: 5900,
    });
    expect(getRefundRequest()).toMatchObject({
      status: schema.RefundStatus.Approved,
      amountRefunded: 5900,
      resolvedAt: RESOLVED_AT.toISOString(),
      resolvedByUserId: adminId,
    });
  });

  it("ends access to the course but keeps the student's progress", () => {
    approveRefundRequest(refundRequestId, adminId, RESOLVED_AT);

    expect(enrollmentExists()).toBe(false);
    expect(
      testDb
        .select()
        .from(schema.lessonProgress)
        .where(eq(schema.lessonProgress.userId, studentId))
        .all()
    ).toHaveLength(1);
  });
});

describe("declineRefundRequest", () => {
  it("records the decline, refunds nothing, and keeps access", () => {
    const result = declineRefundRequest(refundRequestId, adminId, RESOLVED_AT);

    expect(result).toMatchObject({
      ok: true,
      status: schema.RefundStatus.Declined,
      amountRefunded: null,
    });
    expect(getRefundRequest()).toMatchObject({
      status: schema.RefundStatus.Declined,
      amountRefunded: null,
      resolvedAt: RESOLVED_AT.toISOString(),
      resolvedByUserId: adminId,
    });
    expect(enrollmentExists()).toBe(true);
  });
});

describe("resolving a Refund Request", () => {
  it("cannot change a request that is already resolved", () => {
    declineRefundRequest(refundRequestId, adminId, RESOLVED_AT);

    expect(approveRefundRequest(refundRequestId, adminId)).toEqual({
      ok: false,
      reason: "already-resolved",
    });
    expect(getRefundRequest().status).toBe(schema.RefundStatus.Declined);
    expect(enrollmentExists()).toBe(true);
  });

  it("reports a request that does not exist", () => {
    expect(approveRefundRequest(refundRequestId + 100, adminId)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("getWaitingRefundRequests", () => {
  it("lists only requests still waiting on an Admin", () => {
    expect(getWaitingRefundRequests()).toMatchObject([
      { id: refundRequestId, studentName: "Test User", amountPaid: 5900 },
    ]);

    approveRefundRequest(refundRequestId, adminId);

    expect(getWaitingRefundRequests()).toEqual([]);
  });
});
