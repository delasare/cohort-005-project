import { and, eq, gte, sql, sum } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import { courses, purchases, refunds, RefundStatus } from "~/db/schema";
import { rangeStart, type AnalyticsRange } from "~/lib/analytics";

// ─── Refunds in Revenue ───
// Analytics count a Refund on the day it was approved, not the day of the
// Purchase, so an instructor's past periods never change after the fact. Only
// approved Refund Requests count: nothing leaves on one still waiting, or on
// one declined.

/**
 * Correlated: has the purchase in the outer query been refunded? For the
 * panels about who paid, which leave refunded purchases out entirely.
 */
export function approvedRefundOf(purchaseId: SQLiteColumn) {
  return db
    .select({ one: sql`1` })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Approved)
      )
    );
}

function refundScope(instructorId: number | null, range: AnalyticsRange) {
  const start = rangeStart(range);
  return and(
    eq(refunds.status, RefundStatus.Approved),
    instructorId === null ? undefined : eq(courses.instructorId, instructorId),
    start === null ? undefined : gte(refunds.resolvedAt, start)
  );
}

/** Every Refund approved in the range, in cents. */
export function getRefundTotal(
  instructorId: number | null,
  range: AnalyticsRange
): number {
  const row = db
    .select({ refunded: sum(refunds.amountRefunded) })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(refundScope(instructorId, range))
    .get();

  // sum() returns null over an empty set, and a string when SQLite has rows.
  return Number(row?.refunded ?? 0);
}

/** Refunds approved in the range, per course. */
export function getRefundsByCourse(
  instructorId: number | null,
  range: AnalyticsRange
) {
  return db
    .select({
      courseId: courses.id,
      title: courses.title,
      refunded: sum(refunds.amountRefunded),
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(refundScope(instructorId, range))
    .groupBy(courses.id)
    .all()
    .map((row) => ({
      courseId: row.courseId,
      title: row.title,
      refundsCents: Number(row.refunded ?? 0),
    }));
}

/** Refunds approved in the range, keyed by the day or month of approval. */
export function getRefundsByBucket(
  instructorId: number | null,
  range: AnalyticsRange,
  granularity: "day" | "month"
): Map<string, number> {
  const bucketExpr = sql<string>`substr(${refunds.resolvedAt}, 1, ${
    granularity === "day" ? 10 : 7
  })`;

  const rows = db
    .select({ bucket: bucketExpr, refunded: sum(refunds.amountRefunded) })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(refundScope(instructorId, range))
    .groupBy(bucketExpr)
    .all();

  return new Map(rows.map((row) => [row.bucket, Number(row.refunded ?? 0)]));
}

/**
 * Refunds approved in the range on one course, keyed by the country the
 * refunded Purchase was made from.
 */
export function getCourseRefundsByCountry(
  courseId: number,
  range: AnalyticsRange
): Map<string | null, number> {
  const rows = db
    .select({
      country: purchases.country,
      refunded: sum(refunds.amountRefunded),
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(and(eq(courses.id, courseId), refundScope(null, range)))
    .groupBy(purchases.country)
    .all();

  return new Map(rows.map((row) => [row.country, Number(row.refunded ?? 0)]));
}
