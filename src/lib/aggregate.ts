import { fourHourOpen, sessionOpen, tradingDay, weekOpen } from "./session";

export const TIMEFRAMES = ["1s", "30s", "1m", "2m", "3m", "4m", "5m", "15m", "1h", "4h", "1d", "1w"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TF_LABEL: Record<Timeframe, string> = {
  "1s": "1 second",
  "30s": "30 second",
  "1m": "1 minute",
  "2m": "2 minute",
  "3m": "3 minute",
  "4m": "4 minute",
  "5m": "5 minute",
  "15m": "15 minute",
  "1h": "1 hour",
  "4h": "4 hour",
  "1d": "Daily",
  "1w": "Weekly",
};

/** The timeframes structure is actually read on — surfaced first in the UI. */
export const CORE_TIMEFRAMES: Timeframe[] = ["1m", "15m", "1h", "4h", "1d"];

/**
 * Sub-minute bars cannot come from the 1-minute base — they have to be built from 1-second data,
 * which is a separate (and much larger) download.
 */
export const SUB_MINUTE: Timeframe[] = ["30s"];
export const SUB_MINUTE_BASE: Timeframe = "1s";

/** Derived timeframes, in the order they must be built (all from the 1m base). */
export const DERIVED: Timeframe[] = ["2m", "3m", "4m", "5m", "15m", "1h", "4h", "1d", "1w"];

export interface Candle {
  ts: number; // bar open, epoch ms UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const MINUTE = 60000;

/**
 * The opening timestamp of the bucket a given instant falls into.
 *
 * Minute and hourly buckets divide evenly into an hour, and the CME session opens on the hour,
 * so epoch alignment and session alignment agree for those. 4H, daily and weekly are anchored to
 * the 18:00 ET session open instead.
 */
export function bucketStart(ms: number, tf: Timeframe): number {
  switch (tf) {
    case "1s":
      return Math.floor(ms / 1000) * 1000;
    case "30s":
      return Math.floor(ms / 30000) * 30000;
    case "1m":
      return Math.floor(ms / MINUTE) * MINUTE;
    case "2m":
    case "3m":
    case "4m":
    case "5m":
    case "15m": {
      const n = Number(tf.replace("m", ""));
      return Math.floor(ms / (n * MINUTE)) * (n * MINUTE);
    }
    case "1h":
      return Math.floor(ms / (60 * MINUTE)) * (60 * MINUTE);
    case "4h":
      return fourHourOpen(ms);
    case "1d":
      return sessionOpen(tradingDay(ms));
    case "1w":
      return weekOpen(ms);
  }
}

/** Roll bars up into a higher timeframe. Input must be sorted ascending and finer than `tf`. */
export function aggregate(bars: Candle[], tf: Timeframe, sourceTf?: Timeframe): Candle[] {
  if (tf === (sourceTf ?? "1m")) return bars;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curBucket = Number.NaN;

  for (const b of bars) {
    const bucket = bucketStart(b.ts, tf);
    if (!cur || bucket !== curBucket) {
      if (cur) out.push(cur);
      curBucket = bucket;
      cur = { ts: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Drop any bar that is not strictly newer than the one before it.
 *
 * The charting library asserts on out-of-order data and throws a runtime error rather than
 * recovering, so this is applied at every hand-off. It matters when two async sources are
 * stitched together — history from the database and a live bar built locally — and one of them
 * is momentarily stale after a jump.
 */
export function ensureAscending(bars: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const b of bars) {
    const prev = out[out.length - 1];
    if (prev && b.ts <= prev.ts) {
      if (b.ts === prev.ts) out[out.length - 1] = b; // same bucket rebuilt — keep the newer version
      continue;
    }
    out.push(b);
  }
  return out;
}

/** Gaps larger than the expected bar spacing, used to surface missing data honestly. */
export function findGaps(bars: Candle[], maxGapMinutes: number): { from: number; to: number; minutes: number }[] {
  const gaps: { from: number; to: number; minutes: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    const minutes = (bars[i].ts - bars[i - 1].ts) / MINUTE;
    if (minutes > maxGapMinutes) gaps.push({ from: bars[i - 1].ts, to: bars[i].ts, minutes });
  }
  return gaps;
}
