import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  videoWatchEvents,
  LessonProgressStatus,
} from "~/db/schema";

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

export type RefundIneligibility =
  | "no-purchase"
  | "already-requested"
  | "team-purchase"
  | "window-closed"
  | "too-much-completed"
  | "too-much-watched";

export type RefundEligibility =
  | {
      eligible: true;
      purchaseId: number;
      amount: number;
      lastDayInWindow: string;
    }
  | { eligible: false; reason: RefundIneligibility };

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

// A Purchase gets one Refund Request, whatever became of it: a decline is
// final, and an approval has already given the money back.
function hasRefundRequest(purchaseId: number) {
  const existing = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(eq(refunds.purchaseId, purchaseId))
    .get();

  return existing !== undefined;
}

// A purchase of team seats is not refunded through a Refund Request: the
// seats belong to the team, and some may already be claimed.
function isTeamPurchase(purchaseId: number) {
  const seat = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();

  return seat !== undefined;
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

// The fourteen-day window is counted in whole days, not hours — someone who
// buys at 23:00 should still get the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

/**
 * Whether a student may make a Refund Request on their latest Purchase of a
 * course, checking every rule of Refund Eligibility. The course page uses it
 * to decide whether to offer the request, and the refund action uses it to
 * decide whether to accept one, so the two cannot disagree.
 */
export function checkRefundEligibility(
  userId: number,
  courseId: number,
  now: Date = new Date()
): RefundEligibility {
  const purchase = getLatestPurchase(userId, courseId);

  if (!purchase) return { eligible: false, reason: "no-purchase" };

  if (hasRefundRequest(purchase.id)) {
    return { eligible: false, reason: "already-requested" };
  }

  if (isTeamPurchase(purchase.id)) {
    return { eligible: false, reason: "team-purchase" };
  }

  const windowEnd = new Date(purchase.createdAt);
  windowEnd.setDate(windowEnd.getDate() + REFUND_WINDOW_DAYS);
  const lastDayInWindow = calendarDay(windowEnd);
  const today = calendarDay(now);

  if (
    today < calendarDay(new Date(purchase.createdAt)) ||
    today > lastDayInWindow
  ) {
    return { eligible: false, reason: "window-closed" };
  }

  const lessonIds = getLessonIdsForCourse(courseId);

  if (lessonIds.length > 0) {
    const completedCount = getCompletedLessonCount(userId, lessonIds);
    if (completedCount / lessonIds.length >= REFUND_COMPLETION_LIMIT) {
      return { eligible: false, reason: "too-much-completed" };
    }
  }

  if (getSecondsWatched(userId, lessonIds) >= REFUND_WATCH_LIMIT_SECONDS) {
    return { eligible: false, reason: "too-much-watched" };
  }

  // The Refund Amount is what the student actually paid — never the list
  // price, which may have risen since, or been discounted at the time.
  return {
    eligible: true,
    purchaseId: purchase.id,
    amount: purchase.amountPaid,
    lastDayInWindow,
  };
}
