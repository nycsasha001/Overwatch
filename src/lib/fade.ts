/**
 * Fade tracking for shapes that come and go on the chart.
 *
 * Indicators are recomputed from scratch on every candle, so a shape either is or is not in the
 * new result — there is no "entering" or "leaving" state in the data itself. Drawing that result
 * directly makes a gap snap to full strength the instant its third candle closes and vanish the
 * instant price fills it. Stepping through a replay one bar at a time, that reads as flicker
 * rather than as something happening.
 *
 * This keeps a little state beside the data: each shape carries an opacity that eases towards 1
 * while it is present and towards 0 once it has left, and is dropped only after it has finished
 * fading out. Deliberately free of any chart, canvas or DOM types, so the state machine can be
 * tested on its own rather than through a rendered frame.
 */

export interface Fading<T> {
  value: T;
  /** 0..1 progress, multiplied into the shape's own opacity when it is drawn. */
  alpha: number;
  /** 1 while the shape is in the current data, 0 once it has left it. */
  target: 0 | 1;
}

/**
 * Matches --default-transition-duration in globals.css.
 *
 * Long enough to read as a transition rather than a jump, short enough that holding the
 * next-candle key does not leave the chart permanently half-drawn.
 */
export const FADE_MS = 160;

/**
 * Smoothstep. Opacity ramped linearly still starts and stops abruptly, because the eye tracks the
 * change in brightness, not the brightness itself — easing both ends is what removes the tick at
 * the start and the snap at the end.
 */
export function smooth(a: number): number {
  const t = a < 0 ? 0 : a > 1 ? 1 : a;
  return t * t * (3 - 2 * t);
}

/**
 * Reconcile the tracked set against the shapes now present.
 *
 * A shape already being tracked keeps its current opacity and has its value refreshed, so a box
 * whose right edge moved does not restart its fade, and one that disappears and comes back while
 * still fading out reverses from wherever it got to rather than starting again from nothing.
 *
 * With `animate` false everything snaps, which is what a reduced-motion preference asks for.
 */
export function syncFades<T>(
  tracked: Map<string, Fading<T>>,
  items: readonly T[],
  key: (item: T) => string,
  animate = true
): void {
  if (!animate) {
    tracked.clear();
    for (const item of items) tracked.set(key(item), { value: item, alpha: 1, target: 1 });
    return;
  }

  const present = new Set<string>();
  for (const item of items) {
    const k = key(item);
    present.add(k);
    const existing = tracked.get(k);
    if (existing) {
      existing.value = item;
      existing.target = 1;
    } else {
      tracked.set(k, { value: item, alpha: 0, target: 1 });
    }
  }

  for (const [k, f] of tracked) if (!present.has(k)) f.target = 0;
}

/**
 * Move every fade one frame closer to its target, dropping whatever has finished leaving.
 *
 * Returns true while anything is still in motion — the caller's signal to ask for another frame.
 * `dtMs` is clamped because a tab restored after a spell in the background arrives with a delta
 * large enough to jump every pending fade straight to its end, which is the exact pop being
 * avoided here.
 */
export function advanceFades<T>(tracked: Map<string, Fading<T>>, dtMs: number, durationMs = FADE_MS): boolean {
  const step = Math.min(Math.max(dtMs, 0), 100) / Math.max(durationMs, 1);
  let moving = false;

  for (const [k, f] of tracked) {
    if (f.alpha !== f.target) {
      f.alpha = f.target > f.alpha ? Math.min(f.alpha + step, 1) : Math.max(f.alpha - step, 0);
      if (f.alpha !== f.target) moving = true;
    }
    // Only once it has actually reached zero. Removing it at the moment it left the data is what
    // the fade exists to prevent.
    if (f.alpha === 0 && f.target === 0) tracked.delete(k);
  }

  return moving;
}
