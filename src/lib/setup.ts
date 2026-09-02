import type { Trade } from "./types";

/**
 * Was the entry taken into a stacked PD array?
 *
 * The question this answers is confluence, not inventory: a fair value gap on its own is a weaker
 * entry than the same gap overlapping an order block or a breaker. So the journal reports one
 * thing — did at least two arrays line up — rather than listing which array was tapped.
 *
 * A gap is required. Two non-gap arrays overlapping is not the pattern being tracked here, and
 * counting it would quietly change what the tick means.
 *
 * Evidence is read from the structured flags first and the free-text PD array field second, since
 * breakers have no flag of their own and are only ever recorded as text.
 */
export interface PdArrayParts {
  fvg: boolean;
  orderBlock: boolean;
  breaker: boolean;
}

const has = (text: string | null | undefined, re: RegExp) => (text ? re.test(text) : false);

export function pdArrayParts(trade: Pick<Trade, "fvg" | "orderBlock" | "pdArray">): PdArrayParts {
  const text = trade.pdArray ?? "";
  return {
    fvg: Boolean(trade.fvg) || has(text, /\bi?fvg\b|fair value gap|\bdfvg\b/i),
    orderBlock: Boolean(trade.orderBlock) || has(text, /order block|\bob\b/i),
    breaker: has(text, /breaker|\bbb\b/i),
  };
}

/** True when a gap overlapped an order block or a breaker — the confluence worth ticking. */
export function pdArrayStacked(trade: Pick<Trade, "fvg" | "orderBlock" | "pdArray">): boolean {
  const p = pdArrayParts(trade);
  return p.fvg && (p.orderBlock || p.breaker);
}

/** "OB + BB + FVG" — for the tooltip, so the tick can be checked against what was recorded. */
export function pdArrayLabel(trade: Pick<Trade, "fvg" | "orderBlock" | "pdArray">): string {
  const p = pdArrayParts(trade);
  const parts = [p.orderBlock && "OB", p.breaker && "BB", p.fvg && "FVG"].filter(Boolean) as string[];
  return parts.join(" + ");
}
