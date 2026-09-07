import { aggregate, bucketStart, type Candle, type Timeframe } from "./aggregate";
import { etParts } from "./session";

/**
 * Indicators are computed here as plain shapes — boxes and horizontal levels in data space —
 * and drawn by the overlay. Keeping the maths separate from the rendering means it can be tested
 * directly, and the same output could later be fed to the Python engine.
 */

export interface Box {
  from: number; // epoch ms
  to: number; // epoch ms, or Infinity to extend
  top: number;
  bottom: number;
  color: string;
  label?: string;
  dashed?: boolean;
  /** Draw the 50% level through the middle. */
  midline?: boolean;
  labelPosition?: "left" | "center" | "right" | "hidden";
}

export interface Level {
  from: number;
  to: number;
  price: number;
  color: string;
  label?: string;
  dashed?: boolean;
  swept?: boolean;
}

export interface Shapes {
  boxes: Box[];
  levels: Level[];
}

export const EMPTY_SHAPES: Shapes = { boxes: [], levels: [] };

/* ------------------------------- FVG / iFVG ------------------------------- */

export interface FvgOptions {
  /** Ignore gaps smaller than this fraction of price (0.0001 = 1bp). */
  minSize: number;
  /** Hide a gap once price has traded through its far edge. A tap inside it does not count. */
  hideFilled: boolean;
  /** Keep showing a gap that was traded through, as an inverse FVG. */
  showInverse: boolean;
  maxCount: number;
  /**
   * How far a gap extends to the right, in bars.
   *
   * Zero runs it to the edge of the chart, which means the right edge follows the canvas and the
   * box appears to stretch every time a candle is added. Any positive value pins it to a fixed
   * point in bar space and it stays put.
   */
  extendBars: number;
  /** Faint dashed line through the middle of the gap — its 50% level. */
  midline: boolean;
  labelPosition: "left" | "center" | "right" | "hidden";
  bullColor: string;
  bearColor: string;
  inverseColor: string;
}

export const DEFAULT_FVG: FvgOptions = {
  minSize: 0,
  hideFilled: true,
  showInverse: true,
  maxCount: 40,
  extendBars: 30,
  midline: true,
  labelPosition: "right",
  bullColor: "rgba(255,255,255,0.10)",
  bearColor: "rgba(120,123,134,0.18)",
  inverseColor: "rgba(255,255,255,0.24)",
};

/**
 * A fair value gap is a three-candle imbalance: the wicks of the first and third candle fail to
 * overlap. An inverse FVG is one that price has since closed through, flipping its role from
 * support to resistance or the other way round.
 */
export function fairValueGaps(bars: Candle[], opts: FvgOptions = DEFAULT_FVG): Shapes {
  const boxes: Box[] = [];
  if (bars.length < 3) return { boxes, levels: [] };

  // Typical spacing, so a fixed extension in bars works on any timeframe and can project past
  // the last candle rather than stopping at it.
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(bars.length, 50); i++) gaps.push(bars[i].ts - bars[i - 1].ts);
  gaps.sort((a, b) => a - b);
  const spacing = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 60000;

  /**
   * Walked backwards, stopping as soon as `maxCount` boxes are in hand.
   *
   * Only the most recent boxes are ever drawn. Building every gap in the window and then keeping
   * the last few is the same answer arrived at the expensive way — and each gap built costs a
   * forward scan for its fill, so over a replay's fifty-thousand-bar history it is tens of
   * milliseconds on every step, for candles that are hours off the left edge of the screen.
   */
  const limit = opts.maxCount > 0 ? opts.maxCount : Infinity;
  for (let i = bars.length - 1; i >= 2 && boxes.length < limit; i--) {
    const a = bars[i - 2];
    const c = bars[i];

    const bullish = c.low > a.high;
    const bearish = c.high < a.low;
    if (!bullish && !bearish) continue;

    const top = bullish ? c.low : a.low;
    const bottom = bullish ? a.high : c.high;
    const size = Math.abs(top - bottom);
    if (opts.minSize > 0 && size / Math.max(c.close, 1) < opts.minSize) continue;

    // Walk forward to see whether price filled it, and whether it later inverted.
    let filledAt: number | null = null;
    let invertedAt: number | null = null;
    for (let j = i + 1; j < bars.length; j++) {
      const b = bars[j];
      if (filledAt === null) {
        const touched = bullish ? b.low <= bottom : b.high >= top;
        if (touched) filledAt = b.ts;
      }
      if (filledAt !== null && invertedAt === null) {
        const closedThrough = bullish ? b.close < bottom : b.close > top;
        if (closedThrough) {
          invertedAt = b.ts;
          break;
        }
      }
    }

    const inverted = invertedAt !== null;
    if (inverted && !opts.showInverse) continue;
    if (!inverted && filledAt !== null && opts.hideFilled) continue;

    /**
     * Where the box stops.
     *
     * Anchored to the timestamp of an actual bar when one exists that far ahead, and only
     * projected with the estimated spacing beyond the end of the data. The estimate is derived
     * from the first fifty bars, so it drifts as the visible window changes — pinning to a real
     * bar keeps a finished gap in exactly the same place from one step to the next.
     */
    const endIdx = i + opts.extendBars;
    const to =
      opts.extendBars > 0
        ? endIdx < bars.length
          ? bars[endIdx].ts
          : c.ts + opts.extendBars * spacing
        : Infinity;

    boxes.push({
      from: a.ts,
      to,
      top,
      bottom,
      color: inverted ? opts.inverseColor : bullish ? opts.bullColor : opts.bearColor,
      label: opts.labelPosition === "hidden" ? undefined : inverted ? "iFVG" : "FVG",
      midline: opts.midline,
      labelPosition: opts.labelPosition,
    });
  }

  boxes.reverse(); // collected newest-first above; drawn oldest-first
  return { boxes, levels: [] };
}

/* --------------------------- session highs & lows -------------------------- */

export interface SessionWindow {
  name: string;
  /** Minutes from midnight in the chosen timezone. */
  start: number;
  end: number;
  color: string;
  enabled: boolean;
}

export interface SessionOptions {
  /** IANA zone the session hours are expressed in. */
  timezone: string;
  windows: SessionWindow[];
  /** A level stops extending once price trades through it. */
  stopAtSweep: boolean;
  /** How many past occurrences of each session to keep. */
  lookback: number;
}

export const DEFAULT_SESSIONS: SessionOptions = {
  timezone: "Europe/Brussels",
  windows: [
    // Separated by brightness rather than hue, so the three sessions stay distinguishable on a
    // monochrome chart. Each is still editable per window in the indicator settings.
    { name: "Asia", start: 0, end: 9 * 60, color: "#6c737f", enabled: true },
    { name: "London", start: 9 * 60, end: 14 * 60, color: "#9598a1", enabled: true },
    { name: "NY", start: 14 * 60, end: 23 * 60, color: "#d1d4dc", enabled: true },
  ],
  stopAtSweep: true,
  lookback: 1,
};

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = zoneFormatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    zoneFormatters.set(timezone, fmt);
  }
  return fmt;
}

/**
 * The granularity offsets are resolved at.
 *
 * Half an hour rather than an hour because Lord Howe Island shifts its clock by thirty minutes
 * half past the hour; every other zone in use changes on the hour, and a bucket that lands on
 * both is exact for all of them.
 */
const OFFSET_STEP = 1800000;
/** Zone offset in ms, per timezone, keyed by the bucket it applies to. */
const zoneOffsets = new Map<string, Map<number, number>>();

/**
 * How far the zone is from UTC at a given instant, resolved once per bucket rather than per bar.
 *
 * `formatToParts` costs a few microseconds, which is invisible until it is called for every bar
 * of a fifty-thousand-bar window on every replay step — that is most of a second of work per
 * press, and it is the lag you feel when stepping. An offset holds for every instant inside its
 * bucket, so one call answers for all of them, whatever the timeframe.
 */
function zoneOffset(ts: number, timezone: string): number {
  let byHour = zoneOffsets.get(timezone);
  if (!byHour) {
    byHour = new Map();
    zoneOffsets.set(timezone, byHour);
  }
  const hour = Math.floor(ts / OFFSET_STEP);
  const hit = byHour.get(hour);
  if (hit !== undefined) return hit;
  const parts = zoneFormatter(timezone).formatToParts(new Date(hour * OFFSET_STEP));
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  // Half-hour and quarter-hour zones land on a non-zero minute here, which is exactly the offset
  // being measured — so the minute has to be part of the comparison, not assumed to be zero.
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offset = local - hour * OFFSET_STEP;
  // A replay can walk through years of hours; drop the cache rather than grow it without bound.
  if (byHour.size > 100_000) byHour.clear();
  byHour.set(hour, offset);
  return offset;
}

const DAY = 86400000;

/**
 * Local day and minute-of-day, with no `Date` allocated.
 *
 * The day is a day number rather than a calendar date because nothing here needs to read it —
 * it only ever has to group bars that belong to the same session and stay ordered, and an
 * integer does both while a formatted string costs an allocation per bar.
 */
function zoneLocal(ts: number, timezone: string): { day: number; minutes: number } {
  const local = ts + zoneOffset(ts, timezone);
  const day = Math.floor(local / DAY);
  return { day, minutes: Math.floor((local - day * DAY) / 60000) };
}

/** True when an instant falls inside a window, handling windows that cross midnight. */
export function inWindow(ts: number, w: SessionWindow, timezone = DEFAULT_SESSIONS.timezone): boolean {
  const { minutes } = zoneLocal(ts, timezone);
  if (w.end > 24 * 60) return minutes >= w.start || minutes < w.end - 24 * 60;
  return minutes >= w.start && minutes < w.end;
}

/** Index of the first bar strictly after `ts`, by binary search over ascending bars. */
function firstAfter(bars: Candle[], ts: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].ts <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The high and low of each session, drawn from the candle that made them and extending forward
 * until price trades back through the level.
 */
export function sessionLevels(bars: Candle[], opts: SessionOptions = DEFAULT_SESSIONS): Shapes {
  const levels: Level[] = [];
  if (!bars.length) return { boxes: [], levels };
  const timezone = opts.timezone || DEFAULT_SESSIONS.timezone;
  const lastTs = bars[bars.length - 1].ts;

  /**
   * Every window is answered in one pass over the bars.
   *
   * A pass per window meant resolving each bar's local time once per window, and a replay window
   * is tens of thousands of bars re-read on every step. Reading it once and testing the windows
   * against it is the same work divided by however many sessions are switched on.
   */
  const active = opts.windows.filter((w) => w.enabled);
  if (!active.length) return { boxes: [], levels };
  type Group = { high: number; low: number; highTs: number; lowTs: number; end: number };
  const perWindow = active.map(() => new Map<number, Group>());

  for (const b of bars) {
    const { day, minutes } = zoneLocal(b.ts, timezone);
    for (let wi = 0; wi < active.length; wi++) {
      const w = active[wi];
      // Windows that run past midnight belong to the day they opened on, not the one they end in.
      const crossed = w.end > 24 * 60 && minutes < w.end - 24 * 60;
      const inside = w.end > 24 * 60 ? minutes >= w.start || crossed : minutes >= w.start && minutes < w.end;
      if (!inside) continue;
      const key = crossed ? day - 1 : day;
      const groups = perWindow[wi];
      const g = groups.get(key);
      if (!g) {
        groups.set(key, { high: b.high, low: b.low, highTs: b.ts, lowTs: b.ts, end: b.ts });
        continue;
      }
      if (b.high > g.high) {
        g.high = b.high;
        g.highTs = b.ts;
      }
      if (b.low < g.low) {
        g.low = b.low;
        g.lowTs = b.ts;
      }
      g.end = b.ts;
    }
  }

  for (let wi = 0; wi < active.length; wi++) {
    const w = active[wi];
    const groups = perWindow[wi];

    for (const [, g] of [...groups.entries()].slice(-Math.max(opts.lookback, 1))) {
      for (const side of ["high", "low"] as const) {
        const price = side === "high" ? g.high : g.low;
        // The line starts at the candle that made the extreme, as the original does.
        const anchor = side === "high" ? g.highTs : g.lowTs;

        let sweptAt: number | null = null;
        if (opts.stopAtSweep) {
          // Bars are ascending, so the search starts where the session ended rather than at the
          // front of a window that can be fifty thousand bars long.
          for (let i = firstAfter(bars, g.end); i < bars.length; i++) {
            const b = bars[i];
            if (side === "high" ? b.high >= price : b.low <= price) {
              sweptAt = b.ts;
              break;
            }
          }
        }

        /**
         * A level runs to where it stopped mattering, and no further.
         *
         * Two endings: price traded through it, or it simply has not happened yet — in which case
         * it ends at the most recent candle rather than running to the edge of the screen. A line
         * drawn into empty space past the last bar says the level exists in the future, which is
         * not something the chart knows.
         */
        levels.push({
          from: anchor,
          to: sweptAt ?? lastTs,
          price,
          color: w.color,
          label: `${w.name} ${side === "high" ? "High" : "Low"}`,
          swept: sweptAt !== null,
        });
      }
    }
  }

  return { boxes: [], levels };
}

/* --------------------------------- PO3 ------------------------------------ */

export interface Po3Options {
  timeframe: Timeframe;
  /** How many higher-timeframe candles to draw. */
  count: number;
  /** Gap between the last bar and the projection, in bars. */
  offset: number;
  /** Width of each projected candle, in bars. */
  width: number;
  color: string;
}

export const DEFAULT_PO3: Po3Options = { timeframe: "1h", count: 4, offset: 13, width: 2, color: "#d1d4dc" };

export interface Po3Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  ts: number;
  complete: boolean;
}

/**
 * Power of three: the higher-timeframe candles the current price action is building, drawn beside
 * the chart so the accumulation, manipulation and distribution of the HTF candle is visible while
 * trading a lower timeframe.
 */
export function po3Candles(bars: Candle[], baseTf: Timeframe, opts: Po3Options = DEFAULT_PO3): Po3Candle[] {
  if (!bars.length) return [];
  const rolled = aggregate(bars, opts.timeframe, baseTf);
  const lastTs = bars[bars.length - 1].ts;
  const openBucket = bucketStart(lastTs, opts.timeframe);
  return rolled.slice(-opts.count).map((c) => ({ ...c, complete: c.ts < openBucket }));
}
