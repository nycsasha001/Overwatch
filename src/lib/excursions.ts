import type { Candle } from "./aggregate";
import type { Trade } from "./types";

export interface Excursion {
  mae: number; // R against, positive number
  mfe: number; // R in favour, positive number
  bars: number;
  closedAt: number | null;
}

/**
 * Maximum adverse and favourable excursion, in R, measured from stored 1-minute bars.
 *
 * The window starts at the trade's entry and ends when the trade would realistically have closed:
 * at the recorded exit price if there is one, otherwise at the stop or target, otherwise after
 * `capMinutes`. Bars before the entry are ignored.
 */
export function computeExcursion(trade: Trade, bars: Candle[], entryTs: number, capMinutes = 360): Excursion | null {
  if (trade.entry === null || trade.stop === null) return null;
  const risk = Math.abs(trade.entry - trade.stop);
  if (!risk) return null;

  const long = trade.direction === "long";
  const endBy = entryTs + capMinutes * 60000;
  let mae = 0;
  let mfe = 0;
  let barsUsed = 0;
  let closedAt: number | null = null;

  for (const b of bars) {
    if (b.ts < entryTs) continue;
    if (b.ts > endBy) break;
    barsUsed++;

    const adverse = long ? (trade.entry - b.low) / risk : (b.high - trade.entry) / risk;
    const favourable = long ? (b.high - trade.entry) / risk : (trade.entry - b.low) / risk;
    if (adverse > mae) mae = adverse;
    if (favourable > mfe) mfe = favourable;

    const touched = (price: number | null) => price !== null && b.low <= price && price <= b.high;
    if (touched(trade.exit) || touched(trade.stop) || touched(trade.target)) {
      closedAt = b.ts;
      break;
    }
  }

  if (!barsUsed) return null;
  return { mae: Number(mae.toFixed(3)), mfe: Number(mfe.toFixed(3)), bars: barsUsed, closedAt };
}
