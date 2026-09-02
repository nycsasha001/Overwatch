/**
 * Contract specifications.
 *
 * Sizing is done in contracts, so the dollar risk on a trade is derived rather than typed:
 *   risk $ = |entry − stop| × point value × contracts
 *
 * Values are per single contract. Override or extend them in Settings — an unknown symbol falls
 * back to a point value of 1, which keeps R correct while making the dollars obviously wrong
 * rather than quietly wrong.
 */

export interface ContractSpec {
  pointValue: number;
  tickSize: number;
  label?: string;
}

export const DEFAULT_CONTRACT_SPECS: Record<string, ContractSpec> = {
  MNQ: { pointValue: 2, tickSize: 0.25, label: "Micro E-mini Nasdaq" },
  NQ: { pointValue: 20, tickSize: 0.25, label: "E-mini Nasdaq" },
  MES: { pointValue: 5, tickSize: 0.25, label: "Micro E-mini S&P" },
  ES: { pointValue: 50, tickSize: 0.25, label: "E-mini S&P" },
  MYM: { pointValue: 0.5, tickSize: 1, label: "Micro E-mini Dow" },
  YM: { pointValue: 5, tickSize: 1, label: "E-mini Dow" },
  M2K: { pointValue: 5, tickSize: 0.1, label: "Micro E-mini Russell" },
  RTY: { pointValue: 50, tickSize: 0.1, label: "E-mini Russell" },
  MGC: { pointValue: 10, tickSize: 0.1, label: "Micro Gold" },
  GC: { pointValue: 100, tickSize: 0.1, label: "Gold" },
  MCL: { pointValue: 100, tickSize: 0.01, label: "Micro Crude" },
  CL: { pointValue: 1000, tickSize: 0.01, label: "Crude Oil" },
};

export const FALLBACK_SPEC: ContractSpec = { pointValue: 1, tickSize: 0.01 };

export function specFor(symbol: string, overrides?: Record<string, ContractSpec>): ContractSpec {
  const key = symbol.trim().toUpperCase();
  return overrides?.[key] ?? DEFAULT_CONTRACT_SPECS[key] ?? FALLBACK_SPEC;
}

/** Dollar risk implied by a stop distance and a position size. */
export function riskFor(entry: number, stop: number, contracts: number, pointValue: number): number {
  return Math.abs(entry - stop) * pointValue * contracts;
}
