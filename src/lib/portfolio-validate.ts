import { isManuallyValued } from "./portfolio";
import type { AcquisitionType, PortfolioAssetType } from "./types";

/**
 * The boundary between what a form sends and what reaches the database.
 *
 * This lives in lib rather than beside the route because a Next.js route file may only export
 * handlers — exporting a helper from one is a build error that `tsc --noEmit` does not catch. It
 * also means create and edit validate through identical code, so an edit cannot slip past a check
 * the create route enforces.
 */

const ACQUISITION_TYPES: AcquisitionType[] = ["purchase", "gift", "other"];

const ASSET_TYPES: PortfolioAssetType[] = [
  "stock", "etf", "crypto", "other",
  "metal", "cash", "property", "collectible",
];

export interface CleanHolding {
  symbol: string;
  name: string | null;
  /** Null when the caller gave an amount instead; the server divides it by the price it stamps. */
  shares: number | null;
  /** Dollars to invest, as an alternative to a share count. */
  amount: number | null;
  /** Null when the caller did not supply one and the server should stamp today's price. */
  avgCost: number | null;
  assetType: PortfolioAssetType;
  /**
   * Current value per unit for the things no feed quotes. Null both when none was given and,
   * deliberately, whenever the asset type is one the market prices — a hand-typed number must not
   * be able to shadow a real quote for a ticker.
   */
  manualPrice: number | null;
  /** How it came to be yours. Anything unrecognised falls back to a purchase. */
  acquisition: AcquisitionType;
  /**
   * Cash actually parted with, in total. Null means "not stated", which the lot arithmetic reads as
   * the whole basis for a purchase and nothing for a gift. An explicit 0 is a different claim and
   * is preserved.
   */
  amountInvested: number | null;
  /** When it was bought or received, YYYY-MM-DD. Null falls back to today at the point of writing. */
  acquiredAt: string | null;
  note: string | null;
}

export function validateHolding(body: Record<string, unknown>): { error: string } | CleanHolding {
  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  if (!symbol) return { error: "A ticker symbol is required" };
  if (!/^[A-Z0-9.:-]{1,15}$/.test(symbol)) return { error: `"${symbol}" does not look like a ticker symbol` };

  // Either a share count or a dollar amount. The amount is *not* converted here — that division
  // belongs on the server next to the price being recorded, or the cost basis will not equal the
  // amount that was typed.
  const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

  let shares: number | null = null;
  let amount: number | null = null;

  if (has(body.amount)) {
    const parsed = Number(body.amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return { error: "Amount must be a positive number" };
    amount = parsed;
  }

  if (has(body.shares)) {
    const parsed = Number(body.shares);
    if (!Number.isFinite(parsed) || parsed <= 0) return { error: "Shares must be a positive number" };
    shares = parsed;
  }

  if (shares === null && amount === null) return { error: "Enter a number of shares or an amount to invest" };
  // Both given means the caller is confused about which one is authoritative; the amount wins,
  // because that is the field the person was looking at when they chose it.
  if (amount !== null) shares = null;

  // Cost is optional now: you say what you hold, and the server stamps the price it is trading at
  // when you say it. An explicit value is still accepted, for corrections and for recording a buy
  // that happened at a price other than the current one.
  let avgCost: number | null = null;
  if (has(body.avgCost)) {
    const parsed = Number(body.avgCost);
    if (!Number.isFinite(parsed) || parsed < 0) return { error: "Cost must be zero or more" };
    avgCost = parsed;
  }

  const assetType = ASSET_TYPES.includes(body.assetType as PortfolioAssetType) ? (body.assetType as PortfolioAssetType) : "stock";

  // What one unit is worth now, for gold in a safe or a savings balance. Required for those types:
  // there is no feed to fall back on, and a manual holding with no value would sit in the table as
  // an unpriced dash forever.
  let manualPrice: number | null = null;
  if (isManuallyValued(assetType)) {
    if (has(body.manualPrice)) {
      const parsed = Number(body.manualPrice);
      if (!Number.isFinite(parsed) || parsed <= 0) return { error: "Current value must be a positive number" };
      manualPrice = parsed;
    } else if (avgCost !== null) {
      // Not given, but you said what you paid. Valuing it at cost is the honest default: it shows
      // a return of zero rather than inventing a gain, and it is one field to correct later.
      manualPrice = avgCost;
    } else {
      return { error: "Enter what this is worth per unit — there is no price feed for it" };
    }
    // Cost falls back to the current value for the same reason, so a holding you never bought
    // (inherited metal, an opening cash balance) still has a basis to measure against.
    if (avgCost === null) avgCost = manualPrice;
  }

  const acquisition = ACQUISITION_TYPES.includes(body.acquisition as AcquisitionType)
    ? (body.acquisition as AcquisitionType)
    : "purchase";

  // What you actually paid, which is not the basis. Zero is legitimate and common — it is what a
  // gift costs — so this is the one numeric field where a value of 0 must survive rather than being
  // treated as absent.
  let amountInvested: number | null = null;
  if (has(body.amountInvested)) {
    const parsed = Number(body.amountInvested);
    if (!Number.isFinite(parsed) || parsed < 0) return { error: "Amount invested cannot be negative" };
    amountInvested = parsed;
  } else if (acquisition === "gift") {
    // Stated explicitly rather than left null, so a gift reads as a definite zero in the history
    // instead of falling through to "not recorded".
    amountInvested = 0;
  }

  let acquiredAt: string | null = null;
  if (has(body.acquiredAt)) {
    const raw = String(body.acquiredAt).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "Acquisition date must be YYYY-MM-DD" };
    acquiredAt = raw;
  }

  const clean = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());

  return {
    symbol,
    name: clean(body.name),
    shares,
    amount,
    avgCost,
    assetType,
    manualPrice,
    acquisition,
    amountInvested,
    acquiredAt,
    note: clean(body.note),
  };
}
