import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  checkRefundEligibility,
  REFUND_WATCH_LIMIT_SECONDS,
} from "./refund-eligibility.server";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

const PRICE = 7900;

// Built from local dates, because the Refund Window counts calendar days in
// local time.
const PURCHASED_AT = new Date(2026, 10, 1, 10, 0);
const DURING_WINDOW = new Date(2026, 10, 9, 12, 0);

let studentId: number;
let course: { id: number; price: number };
let lessonIds: number[];

function purchase({ amountPaid = PRICE } = {}) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: studentId,
      courseId: course.id,
      amountPaid,
      country: null,
      createdAt: PURCHASED_AT.toISOString(),
    })
    .returning()
    .get();
}

function completeLessons(count: number) {
  for (const lessonId of lessonIds.slice(0, count)) {
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: studentId,
        lessonId,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
  }
}

function watch(lessonId: number, positionSeconds: number) {
  testDb
    .insert(schema.videoWatchEvents)
    .values({
      userId: studentId,
      lessonId,
      eventType: "progress",
      positionSeconds,
    })
    .run();
}

beforeEach(() => {
  testDb = createTestDb();
  const base = seedBaseData(testDb);
  studentId = base.user.id;

  testDb
    .update(schema.courses)
    .set({ price: PRICE })
    .where(eq(schema.courses.id, base.course.id))
    .run();
  course = { id: base.course.id, price: PRICE };

  const module = testDb
    .insert(schema.modules)
    .values({ courseId: course.id, title: "Module", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3, 4].map(
    (position) =>
      testDb
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

describe("checkRefundEligibility", () => {
  it("offers the request inside the window, with the last day of the window", () => {
    const bought = purchase();

    expect(checkRefundEligibility(studentId, course.id, DURING_WINDOW)).toEqual(
      {
        eligible: true,
        purchaseId: bought.id,
        amount: PRICE,
        lastDayInWindow: "2026-11-15",
      }
    );
  });

  it("gives back what the student paid, not the course's list price", () => {
    // Bought at a discount that was not a purchasing-power price, such as
    // before a price rise. Handing back the list price would pay out more
    // than was ever paid.
    purchase({ amountPaid: 5900 });

    expect(
      checkRefundEligibility(studentId, course.id, DURING_WINDOW)
    ).toMatchObject({
      eligible: true,
      amount: 5900,
    });
  });

  it("refuses a student who has not bought the course", () => {
    expect(checkRefundEligibility(studentId, course.id, DURING_WINDOW)).toEqual(
      {
        eligible: false,
        reason: "no-purchase",
      }
    );
  });

  describe("one Refund Request per Purchase", () => {
    function requestRefund(status: schema.RefundStatus) {
      const bought = purchase();
      testDb
        .insert(schema.refunds)
        .values({
          purchaseId: bought.id,
          status,
          reason: "Not what I expected",
        })
        .run();
    }

    it("refuses a second request while one is still open", () => {
      requestRefund(schema.RefundStatus.Requested);

      expect(
        checkRefundEligibility(studentId, course.id, DURING_WINDOW)
      ).toEqual({ eligible: false, reason: "already-requested" });
    });

    it("refuses a new request once one has been declined", () => {
      // A decline is final. Otherwise it only means "ask again tomorrow".
      requestRefund(schema.RefundStatus.Declined);

      expect(
        checkRefundEligibility(studentId, course.id, DURING_WINDOW)
      ).toEqual({ eligible: false, reason: "already-requested" });
    });

    it("refuses a new request once one has been approved", () => {
      requestRefund(schema.RefundStatus.Approved);

      expect(
        checkRefundEligibility(studentId, course.id, DURING_WINDOW)
      ).toEqual({ eligible: false, reason: "already-requested" });
    });
  });

  it("refuses a team purchase, even with no seat claimed", () => {
    // Team seats are not refunded through a Refund Request. Without this, an
    // approved request would leave the unclaimed Seats claimable.
    const bought = purchase();
    const team = testDb.insert(schema.teams).values({}).returning().get();
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: course.id,
        code: "SEAT-1",
        purchaseId: bought.id,
      })
      .run();

    expect(checkRefundEligibility(studentId, course.id, DURING_WINDOW)).toEqual(
      {
        eligible: false,
        reason: "team-purchase",
      }
    );
  });

  describe("the Refund Window", () => {
    it("stays open for the whole of the fourteenth day", () => {
      purchase();

      const lateOnLastDay = new Date(2026, 10, 15, 23, 59);
      expect(
        checkRefundEligibility(studentId, course.id, lateOnLastDay)
      ).toMatchObject({
        eligible: true,
      });
    });

    it("closes on the fifteenth day", () => {
      purchase();

      const dayAfter = new Date(2026, 10, 16, 0, 1);
      expect(checkRefundEligibility(studentId, course.id, dayAfter)).toEqual({
        eligible: false,
        reason: "window-closed",
      });
    });
  });

  describe("lessons completed", () => {
    it("allows a student under half the lessons", () => {
      purchase();
      completeLessons(1);

      expect(
        checkRefundEligibility(studentId, course.id, DURING_WINDOW)
      ).toMatchObject({
        eligible: true,
      });
    });

    it("refuses a student at half the lessons", () => {
      purchase();
      completeLessons(2);

      expect(
        checkRefundEligibility(studentId, course.id, DURING_WINDOW)
      ).toEqual({
        eligible: false,
        reason: "too-much-completed",
      });
    });
  });

  describe("time watched", () => {
    it("counts the furthest point in each lesson, not every event", () => {
      purchase();
      // Rewatching the same stretch of one lesson does not add up.
      watch(lessonIds[0], 3000);
      watch(lessonIds[0], 3000);
      watch(lessonIds[0], 3000);

      expect(
        checkRefundEligibility(studentId, course.id, DURING_WINDOW)
      ).toMatchObject({
        eligible: true,
      });
    });

    it("refuses a student who has watched two hours", () => {
      purchase();
      watch(lessonIds[0], REFUND_WATCH_LIMIT_SECONDS / 2);
      watch(lessonIds[1], REFUND_WATCH_LIMIT_SECONDS / 2);

      expect(
        checkRefundEligibility(studentId, course.id, DURING_WINDOW)
      ).toEqual({
        eligible: false,
        reason: "too-much-watched",
      });
    });
  });
});
