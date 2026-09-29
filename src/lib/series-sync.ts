import { aggregate, bucketStart, ensureAscending, type Candle, type Timeframe } from "./aggregate";

/**
 * Deciding whether the chart can be updated in place or has to be rebuilt.
 *
 * Handing lightweight-charts a whole new array through setData makes it discard and rebuild the
 * series: every bar re-ingested, the price scale recomputed, the pane repainted from nothing.
 * Doing that once when the instrument changes is correct. Doing it on every replay step — which is
 * what a fresh `bars` array causes, even when only the last candle differs — is what makes a step
 * look like a redraw rather than a candle arriving.
 *
 * `update()` is the other path: it takes one bar and appends or replaces it, touching nothing
 * else. This works out which of the two a given change deserves.
 */

export type SeriesPatch =
  /** Nothing usable in common — hand the chart the whole array. */
  | { kind: "replace" }
  /** Everything before `from` is already drawn and unchanged; update from there to the end. */
  | { kind: "append"; from: number }
  /** Byte-for-byte what is already on the chart. */
  | { kind: "none" };

/**
 * Identity first: the settled part of a replay window is the same bar objects render after
 * render, so a pointer comparison answers for almost every bar in the array and the field-by-field
 * check is only reached where something genuinely differs.
 */
const same = (a: Candle, b: Candle) =>
  a === b || (a.ts === b.ts && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close);

/**
 * Compare what is drawn against what should be.
 *
 * The last drawn bar is always treated as suspect, because during a replay it is a candle still
 * forming: its high, low and close move as the cursor advances through it. Everything before it
 * has to match exactly — if any of it moved, the window itself has shifted and an in-place update
 * would silently draw the wrong thing, so the answer is a full replace.
 */
export function diffBars(prev: readonly Candle[], next: readonly Candle[]): SeriesPatch {
  if (!prev.length || !next.length) return next.length === prev.length ? { kind: "none" } : { kind: "replace" };
  // A shorter array means bars were removed from somewhere; update() has no way to express that.
  if (next.length < prev.length) return { kind: "replace" };
  // The cheapest possible rejection of a window that slid, before the scan below.
  if (prev[0].ts !== next[0].ts) return { kind: "replace" };

  for (let i = 0; i < prev.length - 1; i++) if (!same(prev[i], next[i])) return { kind: "replace" };

  const last = prev.length - 1;
  if (next.length === prev.length && same(prev[last], next[last])) return { kind: "none" };
  /**
   * The bar being written must not sit before the one the series already ends on.
   *
   * update() refuses to move backwards — it throws rather than rewriting history — so a last bar
   * whose timestamp has gone backwards has to be a replace. This is what stepping *back* through a
   * replay does: the count is unchanged and every earlier bar matches, but the forming candle
   * returns to an earlier bucket. It read as an ordinary append and took the page down with a
   * runtime error.
   */
  if (next[last].ts < prev[last].ts) return { kind: "replace" };
  return { kind: "append", from: last };
}

/**
 * The candles the chart should be showing at a point in a replay.
 *
 * Three pieces: the settled window behind the cursor, the candle the cursor is inside — built
 * from base bars up to the cursor and no further, because the rest of it has not happened yet —
 * and, between them, any candle that closed since the window was last brought forward.
 *
 * That middle piece is the whole point. The settled window is fetched once and then extended as
 * the replay runs, and the extending happens in a passive effect — after the browser has painted.
 * So on the render that crosses a boundary, the candle that just closed is in neither the window
 * nor the forming bar, and the chart is handed an array with a hole where it belongs. You see the
 * hole open up in front of the last candle on every press.
 *
 * It costs more than a frame of flicker. `diffBars` decides between appending and rebuilding by
 * matching the new array against what is drawn, and an array with a hole in it matches neither —
 * so the correction that lands a moment later rebuilds every bar in the window, tens of thousands
 * of them, recomputing the price scale and repainting the pane. Rebuilding the closed candle here
 * from base bars already in hand means the array is right the first time, every step is an
 * append, and the roll-forward becomes bookkeeping that changes nothing on screen.
 */
export interface ReplayWindowOpts {
  /** The settled window behind the cursor: fetched history, or a locally rebuilt stand-in. */
  history: readonly Candle[];
  /** Base-timeframe bars for the session. */
  buffer: readonly Candle[];
  /** Index into `buffer` of the last bar that has happened. */
  cursor: number;
  /** Start of the bucket the cursor is inside. */
  currentBucket: number;
  /** The timeframe being drawn. */
  tf: Timeframe;
  /** The timeframe `buffer` is in. */
  baseTf: Timeframe;
}

/**
 * Index into `buffer` of the first base bar belonging to the bucket now forming.
 *
 * Found by binary search rather than by walking back from the cursor: the answer is a property of
 * the bucket, not of where the cursor sits inside it, so it holds still for every step through
 * that candle and only has to be found again when the cursor crosses into the next one.
 */
export function bucketFirstIndex(buffer: readonly Candle[], currentBucket: number): number {
  let lo = 0;
  let hi = buffer.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (buffer[mid].ts < currentBucket) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The bars strictly before an instant.
 *
 * Bars arrive in order, so the answer is a prefix — found by binary search, and handed back
 * without copying at all in the ordinary case, where every bar is already behind the cursor.
 * Filtering instead walks and rebuilds the whole window: fifty thousand bars examined and fifty
 * thousand copied, per step, to arrive at the array that was passed in.
 */
export function barsBefore(bars: readonly Candle[], ts: number): Candle[] {
  if (!bars.length) return [];
  if (bars[bars.length - 1].ts < ts) return bars as Candle[];
  const end = bucketFirstIndex(bars, ts);
  return end === bars.length ? (bars as Candle[]) : bars.slice(0, end);
}

/**
 * Everything on the chart behind the candle that is forming — the part a step cannot change.
 *
 * Split out from the forming candle because of what a replay step actually does: it moves the
 * cursor one base bar, which changes the high, low and close of exactly one candle and nothing
 * else. Rebuilding the settled window alongside it meant filtering, concatenating and re-scanning
 * fifty thousand bars to hand back an array whose first 49,999 entries were the ones already
 * there — several milliseconds and a few megabytes of garbage per step, every step, on the same
 * thread that has to answer the mouse. Anchored here, it is computed once per candle instead.
 */
export function settledWindow(opts: Omit<ReplayWindowOpts, "cursor">): Candle[] {
  const { history, buffer, currentBucket, tf, baseTf } = opts;
  if (!buffer.length) return [];
  const from = bucketFirstIndex(buffer, currentBucket);

  // Everything between the end of the settled window and the bucket now forming.
  const lastSettled = history.length ? history[history.length - 1].ts : null;
  let fillFrom = from;
  if (lastSettled !== null) {
    while (fillFrom > 0 && bucketStart(buffer[fillFrom - 1].ts, tf) > lastSettled) fillFrom--;
  }
  const closed = fillFrom < from ? aggregate(buffer.slice(fillFrom, from), tf, baseTf) : [];

  return ensureAscending(closed.length ? [...history, ...closed] : (history as Candle[]));
}

/**
 * The candle the cursor is inside: base bars from the start of its bucket up to the cursor, and
 * no further, because the rest of it has not happened yet.
 */
export function formingWindow(opts: Omit<ReplayWindowOpts, "history">): Candle[] {
  const { buffer, cursor, currentBucket, tf, baseTf } = opts;
  if (!buffer.length || cursor < 0) return [];
  const from = Math.min(bucketFirstIndex(buffer, currentBucket), cursor);
  return aggregate(buffer.slice(from, cursor + 1), tf, baseTf);
}

/**
 * The candles the chart should be showing at a point in a replay: the settled window, then the
 * candle forming on the end of it.
 */
export function replayWindow(opts: ReplayWindowOpts): Candle[] {
  const { history, buffer, cursor, currentBucket, tf, baseTf } = opts;
  if (!buffer.length || cursor < 0) return [];
  const settled = settledWindow({ history, buffer, currentBucket, tf, baseTf });
  const forming = formingWindow({ buffer, cursor, currentBucket, tf, baseTf });
  return joinForming(settled, forming);
}

/**
 * Put the forming candle on the end of the settled window.
 *
 * The join is checked rather than assumed — a stale window after a jump can overlap the bucket now
 * forming — but the check is two timestamps, so the ordinary case costs a concatenation and the
 * full re-scan is kept for the case that actually needs it.
 */
export function joinForming(settled: readonly Candle[], forming: readonly Candle[]): Candle[] {
  if (!settled.length) return forming as Candle[];
  if (!forming.length) return settled as Candle[];
  const joined = settled.concat(forming);
  return settled[settled.length - 1].ts < forming[0].ts ? joined : ensureAscending(joined);
}
