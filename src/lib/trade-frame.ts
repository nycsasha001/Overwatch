/**
 * The stretch of chart a replay trade's screenshot shows.
 *
 * The picture is taken the moment the trade closes but drawn from the stored candles rather than
 * from the replay chart, so it can show what came after the exit as well as what led up to the
 * entry. This decides how much of each.
 *
 * Before the entry it shows the setup, not just a fixed slice of it. The trade was taken off a
 * move — a sweep of a high or low, and the leg that ran into it — and a picture that starts
 * halfway down that leg shows the entry without the reason for it. So the frame reaches back to
 * the extreme the trade faded and then to where the leg into that extreme began, with a floor of
 * history either way. After the exit it shows the follow-through: long enough to see whether
 * price kept going or turned straight back, short enough that the trade is not crowded off the
 * left of the picture.
 *
 * Measured in bars of whatever timeframe the picture is drawn at, so it reads the same on a 1m
 * chart as on a 15m one.
 */

export const FRAME = {
  /** Bars shown before the entry, at the least. */
  minBefore: 100,
  /** ...and at most, however far back the leg into the trade began. */
  maxBefore: 300,
  /** How far back from the entry to look for the extreme the trade was taken off. */
  sweepLookback: 60,
  /** How far back from that extreme to look for where the leg into it began. */
  legLookback: 150,
  /** Bars left in front of the leg's start, so it is not pressed against the edge of the picture. */
  pad: 8,
  /** Bars shown after the exit: this share of the trade's own length, kept between the two bounds below. */
  afterShare: 0.6,
  minAfter: 15,
  maxAfter: 45,
} as const;

export interface FrameBar {
  ts: number;
  high: number;
  low: number;
}

/** The bar a timestamp falls in: the last one opening at or before it. -1 when it is before them all. */
export function barIndexAt(bars: { ts: number }[], ts: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].ts <= ts) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * The first and last bar to show, as indices into `bars`, both inclusive.
 *
 * `bars` must be oldest first and should reach well past both ends of the trade; the frame is
 * simply cut short where they run out. Null when there are no bars to frame.
 */
export function tradeFrame(opts: {
  bars: FrameBar[];
  entryTs: number;
  exitTs: number;
  direction: "long" | "short";
}): { first: number; last: number } | null {
  const { bars, direction } = opts;
  if (!bars.length) return null;
  const entry = Math.max(0, barIndexAt(bars, opts.entryTs));
  const exit = Math.max(entry, barIndexAt(bars, opts.exitTs));
  const length = Math.max(1, exit - entry);

  const after = Math.round(Math.min(FRAME.maxAfter, Math.max(FRAME.minAfter, length * FRAME.afterShare)));
  const last = Math.min(bars.length - 1, exit + after);

  // The extreme the trade faded: the lowest low before a long, the highest high before a short.
  // The latest one wins a tie, since that is the one price actually turned from.
  const long = direction === "long";
  let sweep = entry;
  for (let i = entry; i >= Math.max(0, entry - FRAME.sweepLookback); i--) {
    if (long ? bars[i].low < bars[sweep].low : bars[i].high > bars[sweep].high) sweep = i;
  }
  // Where the leg into that extreme began: the high the selloff came from, or the low the rally did.
  let leg = sweep;
  for (let i = sweep; i >= Math.max(0, sweep - FRAME.legLookback); i--) {
    if (long ? bars[i].high > bars[leg].high : bars[i].low < bars[leg].low) leg = i;
  }

  const floor = entry - Math.max(FRAME.minBefore, length * 2);
  const first = Math.max(0, entry - FRAME.maxBefore, Math.min(floor, leg - FRAME.pad));
  return { first, last };
}
