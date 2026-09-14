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

const same = (a: Candle, b: Candle) =>
  a.ts === b.ts && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;

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
export function replayWindow(opts: {
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
}): Candle[] {
  const { history, buffer, cursor, currentBucket, tf, baseTf } = opts;
  if (!buffer.length || cursor < 0) return [];

  // Base bars from the start of the current bucket up to the cursor form the live candle.
  let from = Math.min(cursor, buffer.length - 1);
  while (from > 0 && buffer[from - 1].ts >= currentBucket) from--;
  const forming = aggregate(buffer.slice(from, cursor + 1), tf, baseTf);

  // Everything between the end of the settled window and the bucket now forming.
  const lastSettled = history.length ? history[history.length - 1].ts : null;
  let fillFrom = from;
  if (lastSettled !== null) {
    while (fillFrom > 0 && bucketStart(buffer[fillFrom - 1].ts, tf) > lastSettled) fillFrom--;
  }
  const closed = fillFrom < from ? aggregate(buffer.slice(fillFrom, from), tf, baseTf) : [];

  return ensureAscending([...history, ...closed, ...forming]);
}
