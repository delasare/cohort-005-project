// ─── Analytics Config ───
// The vocabulary the analytics page and its service share: how much the
// platform keeps, and the time ranges a viewer can ask for.
//
// Imported by both the service and the route, so nothing here may touch the
// database or the request.

/**
 * The platform's cut of gross revenue. One constant, named once — the page
 * shows gross, fee and net side by side, and they must agree.
 */
export const PLATFORM_FEE_RATE = 0.2;

/** The same rate as a whole number, for labelling it on screen. */
export const PLATFORM_FEE_PERCENT = PLATFORM_FEE_RATE * 100;

export type AnalyticsRange = "7d" | "30d" | "90d" | "all";

/** The range control's options, in the order they are offered. */
export const ANALYTICS_RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = "30d";

/** Narrows an untrusted search param — anything else falls back to the default. */
export function parseAnalyticsRange(value: string | null): AnalyticsRange {
  return ANALYTICS_RANGES.some((range) => range.value === value)
    ? (value as AnalyticsRange)
    : DEFAULT_ANALYTICS_RANGE;
}

const RANGE_DAYS: Record<Exclude<AnalyticsRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * The inclusive start of a range, as an ISO timestamp, or null for all time.
 *
 * The boundary is decided in exactly one place: a row landing exactly on the
 * cutoff is inside the range. Lives here rather than in the service because
 * panels built on other services have to agree with it.
 */
export function rangeStart(range: AnalyticsRange): string | null {
  if (range === "all") return null;
  return new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString();
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Cents as money — always with the cents shown, and always with a currency
 * symbol. Deliberately not `formatPrice`, which renders 0 as "Free": a day
 * with no sales is $0.00, not free. Money leaving, such as Net Revenue in a
 * period of Refunds, reads "-$63.20".
 */
export function formatMoney(cents: number): string {
  const amount = (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? "-" : ""}$${amount}`;
}

/**
 * A chart axis label for a `YYYY-MM-DD` or `YYYY-MM` bucket.
 *
 * Formatted by slicing the string rather than by constructing a Date, so the
 * server and the browser cannot disagree about the timezone and trip
 * hydration.
 */
export function formatBucket(bucket: string): string {
  const month = MONTHS[Number(bucket.slice(5, 7)) - 1] ?? "";
  const day = bucket.slice(8, 10);
  return day ? `${Number(day)} ${month}` : `${month} ${bucket.slice(2, 4)}`;
}

/**
 * Splits Gross Revenue into Refunds, the Platform Fee and the instructor's
 * Net Revenue. The fee is taken on what is kept after Refunds, so a Refund
 * hands back the platform's share as well as the instructor's. A period whose
 * Refunds outweigh its sales comes out negative, and that is shown as is.
 *
 * Net is what is kept minus the rounded fee rather than a second independent
 * rounding, so the figures always add up on screen.
 */
export function splitRevenue(grossCents: number, refundsCents = 0) {
  const keptCents = grossCents - refundsCents;
  // `|| 0` turns the -0 that rounding a small negative gives into 0.
  const feeCents = Math.round(keptCents * PLATFORM_FEE_RATE) || 0;
  return {
    grossCents,
    refundsCents,
    feeCents,
    netCents: keptCents - feeCents,
  };
}
