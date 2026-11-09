import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { notExists } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  approvedRefundOf,
  getCourseRefundsByCountry,
  getRefundTotal,
  getRefundsByBucket,
  getRefundsByCourse,
} from "./refund-revenue.server";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

const NOW = new Date("2026-11-09T12:00:00.000Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

let studentId: number;
let instructorId: number;
let courseId: number;
let otherCourseId: number;

function purchase(
  onCourse: number,
  amountPaid: number,
  boughtDaysAgo: number,
  country: string | null = null
) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: studentId,
      courseId: onCourse,
      amountPaid,
      country,
      createdAt: daysAgo(boughtDaysAgo),
    })
    .returning()
    .get().id;
}

function refundRequest(
  purchaseId: number,
  status: schema.RefundStatus,
  resolvedDaysAgo: number | null,
  amountRefunded: number | null
) {
  testDb
    .insert(schema.refunds)
    .values({
      purchaseId,
      status,
      reason: "Not what I expected",
      amountRefunded,
      resolvedAt: resolvedDaysAgo === null ? null : daysAgo(resolvedDaysAgo),
    })
    .run();
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

  testDb = createTestDb();
  const base = seedBaseData(testDb);
  studentId = base.user.id;
  instructorId = base.instructor.id;
  courseId = base.course.id;

  const otherInstructorId = testDb
    .insert(schema.users)
    .values({
      name: "Other Instructor",
      email: "other@example.com",
      role: schema.UserRole.Instructor,
    })
    .returning()
    .get().id;

  otherCourseId = testDb
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Someone else's course",
      salesCopy: "## Other Course",
      instructorId: otherInstructorId,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get().id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getRefundTotal", () => {
  it("counts only approved Refund Requests", () => {
    refundRequest(
      purchase(courseId, 7900, 5),
      schema.RefundStatus.Approved,
      2,
      7900
    );
    refundRequest(
      purchase(courseId, 4900, 5),
      schema.RefundStatus.Requested,
      null,
      null
    );
    refundRequest(
      purchase(courseId, 2900, 5),
      schema.RefundStatus.Declined,
      2,
      null
    );

    expect(getRefundTotal(instructorId, "all")).toBe(7900);
  });

  it("dates a Refund by its approval, not by the Purchase", () => {
    // Bought six weeks ago, refunded two days ago: this week's money left.
    refundRequest(
      purchase(courseId, 7900, 42),
      schema.RefundStatus.Approved,
      2,
      7900
    );

    expect(getRefundTotal(instructorId, "7d")).toBe(7900);
    expect(getRefundTotal(instructorId, "30d")).toBe(7900);
  });

  it("leaves out a Refund approved before the range", () => {
    refundRequest(
      purchase(courseId, 7900, 45),
      schema.RefundStatus.Approved,
      40,
      7900
    );

    expect(getRefundTotal(instructorId, "30d")).toBe(0);
    expect(getRefundTotal(instructorId, "all")).toBe(7900);
  });

  it("counts only the instructor's own courses, and every course platform-wide", () => {
    refundRequest(
      purchase(courseId, 7900, 5),
      schema.RefundStatus.Approved,
      2,
      7900
    );
    refundRequest(
      purchase(otherCourseId, 4900, 5),
      schema.RefundStatus.Approved,
      2,
      4900
    );

    expect(getRefundTotal(instructorId, "30d")).toBe(7900);
    expect(getRefundTotal(null, "30d")).toBe(12800);
  });
});

describe("getRefundsByCourse", () => {
  it("totals each course's Refunds", () => {
    refundRequest(
      purchase(courseId, 7900, 5),
      schema.RefundStatus.Approved,
      2,
      7900
    );
    refundRequest(
      purchase(courseId, 4900, 5),
      schema.RefundStatus.Approved,
      1,
      4900
    );

    expect(getRefundsByCourse(instructorId, "30d")).toEqual([
      { courseId, title: "Test Course", refundsCents: 12800 },
    ]);
  });
});

describe("getRefundsByBucket", () => {
  it("files each Refund under the day it was approved", () => {
    refundRequest(
      purchase(courseId, 7900, 20),
      schema.RefundStatus.Approved,
      2,
      7900
    );

    expect(getRefundsByBucket(instructorId, "30d", "day")).toEqual(
      new Map([[daysAgo(2).slice(0, 10), 7900]])
    );
  });
});

describe("getCourseRefundsByCountry", () => {
  it("files each Refund under the country of the refunded Purchase", () => {
    refundRequest(
      purchase(courseId, 3900, 5, "IN"),
      schema.RefundStatus.Approved,
      2,
      3900
    );
    refundRequest(
      purchase(courseId, 7900, 5, null),
      schema.RefundStatus.Approved,
      2,
      7900
    );

    expect(getCourseRefundsByCountry(courseId, "30d")).toEqual(
      new Map<string | null, number>([
        ["IN", 3900],
        [null, 7900],
      ])
    );
  });
});

describe("approvedRefundOf", () => {
  it("picks out purchases with an approved Refund, for leaving them out", () => {
    const refunded = purchase(courseId, 7900, 5);
    const declined = purchase(courseId, 4900, 5);
    const kept = purchase(courseId, 2900, 5);
    refundRequest(refunded, schema.RefundStatus.Approved, 2, 7900);
    refundRequest(declined, schema.RefundStatus.Declined, 2, null);

    const paidFor = testDb
      .select({ id: schema.purchases.id })
      .from(schema.purchases)
      .where(notExists(approvedRefundOf(schema.purchases.id)))
      .orderBy(schema.purchases.id)
      .all()
      .map((row) => row.id);

    expect(paidFor).toEqual([declined, kept]);
  });
});
