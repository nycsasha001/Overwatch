import type { Candle } from "./aggregate";

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
