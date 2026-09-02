/**
 * Which parts of a requested date range are not already stored.
 *
 * The import endpoint used to hand every request straight to Databento, which bills per request on
 * the streaming endpoint — so asking twice for the same five years paid for it twice. This works
 * out what is genuinely missing so only that is ever fetched.
 *
 * Days are the unit deliberately. The stored data is bar-level, but a partly-filled day is
 * indistinguishable from a quiet one (holidays and early closes have few bars and no gap), so
 * anything finer would re-buy real data on every holiday. A day that holds any bars is treated as
 * covered; the daily update handles the trailing edge.
 */

export interface DayRange {
  /** Inclusive, YYYY-MM-DD. */
  start: string;
  /** Inclusive, YYYY-MM-DD. */
  end: string;
}

const DAY = 86400000;

export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** Every day from start to end inclusive. */
export function daysBetween(start: string, end: string): string[] {
  const a = dayMs(start);
  const b = dayMs(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out: string[] = [];
  for (let t = a; t <= b; t += DAY) out.push(isoDay(t));
  return out;
}

/**
 * Which parts of a requested range fall outside what has already been imported.
 *
 * Testing "does this day hold bars?" is not good enough, and getting it wrong costs real money.
 * Over five years of stored MNQ that test flagged 268 missing days — every one a Saturday, when
 * CME is closed and no amount of paying will produce a bar. Holidays behave the same way.
 *
 * So a day counts as missing only when it lies outside the imported span. Inside it the period was
 * already covered, and an empty day there means the market was shut, not that data is owed.
 *
 * Returning ranges rather than single days matters too: the importer walks range by range, and one
 * request for a month costs far less than thirty requests for its days.
 */
export function missingRanges(
  start: string,
  end: string,
  stored: { first: string | null; last: string | null }
): DayRange[] {
  const wanted = daysBetween(start, end);
  if (!wanted.length) return [];

  const { first, last } = stored;
  // Nothing imported yet — the whole request is genuinely missing.
  const isMissing = (day: string) => (first === null || last === null ? true : day < first || day > last);

  const out: DayRange[] = [];
  let open: DayRange | null = null;
  for (const day of wanted) {
    if (!isMissing(day)) {
      if (open) {
        out.push(open);
        open = null;
      }
      continue;
    }
    if (open) open.end = day;
    else open = { start: day, end: day };
  }
  if (open) out.push(open);
  return out;
}

/** Total number of days across a set of ranges — what the caller is about to pay for. */
export function daysIn(ranges: DayRange[]): number {
  return ranges.reduce((n, r) => n + daysBetween(r.start, r.end).length, 0);
}
