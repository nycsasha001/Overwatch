import { NextRequest, NextResponse } from "next/server";
import {
  createTransaction,
  listHoldings,
  listTransactions,
  readPriceCache,
  syncHoldingFromTransactions,
  writePriceCache,
} from "@/lib/db";
import { hasApiKey, refreshQuotes } from "@/lib/prices";
import { isManuallyValued, sharesForAmount } from "@/lib/portfolio";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const symbol = req.nextUrl.searchParams.get("symbol");
  return NextResponse.json(listTransactions(u, symbol));
}

/**
 * Record a buy or a sell.
 *
 * Omit `price` and the server stamps what the symbol is trading at now — the "I just bought more"
 * case. Supply one and it is used as given, which is what you want when entering something that
 * happened on a different day at a different price.
 *
 * Shares can be given directly or as a dollar `amount`, which is divided by the price actually
 * being recorded — so "another $200 of AAPL" lands on a cost of exactly $200.
 *
 * Either way the holding is rebuilt from the full transaction history afterwards, so the average
 * cost is always the weighted average of everything you have actually bought.
 */
export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const b = (await req.json()) as Record<string, unknown>;

    const symbol = String(b.symbol ?? "").trim().toUpperCase();
    if (!symbol) return NextResponse.json({ error: "A ticker symbol is required" }, { status: 400 });
    if (!/^[A-Z0-9.:-]{1,15}$/.test(symbol)) return NextResponse.json({ error: "That is not a symbol" }, { status: 400 });

    const kind = b.kind === "sell" ? "sell" : "buy";
    const acquisition =
      b.acquisition === "gift" || b.acquisition === "other" ? (b.acquisition as "gift" | "other") : "purchase";

    const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

    let shares: number | null = null;
    let amount: number | null = null;

    if (has(b.amount)) {
      const parsed = Number(b.amount);
      if (!Number.isFinite(parsed) || parsed <= 0) return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
      amount = parsed;
    } else {
      shares = Number(b.shares);
      if (!Number.isFinite(shares) || shares <= 0) return NextResponse.json({ error: "Shares must be a positive number" }, { status: 400 });
    }

    const date = b.date ? String(b.date).trim() : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "A date is required (YYYY-MM-DD)" }, { status: 400 });

    let price: number;
    const given = b.price === undefined || b.price === null || String(b.price).trim() === "" ? null : Number(b.price);

    // Nothing quotes bullion or a savings account, so for those "leave it blank" means "the value
    // I last set" rather than a feed lookup that would answer with nothing. Without this, adding a
    // second purchase of gold would be impossible without retyping a price the app already holds.
    const existing = listHoldings(u).find((h) => h.symbol === symbol);
    const manualFallback =
      existing && isManuallyValued(existing.assetType) && existing.manualPrice !== null ? existing.manualPrice : null;

    if (given !== null) {
      if (!Number.isFinite(given) || given < 0) return NextResponse.json({ error: "Price must be zero or more" }, { status: 400 });
      price = given;
    } else if (manualFallback !== null) {
      price = manualFallback;
    } else {
      if (!hasApiKey()) {
        return NextResponse.json({ error: "Live prices are off, so there is no price to record. Enter one, or set FINNHUB_API_KEY." }, { status: 400 });
      }
      const cache = readPriceCache(u);
      const { quotes, fetched } = await refreshQuotes([symbol], cache, { force: true });
      const quote = quotes.get(symbol);
      if (!quote) return NextResponse.json({ error: `No price is available for ${symbol} right now.` }, { status: 400 });
      if (fetched.length) {
        writePriceCache(u, [{ symbol: quote.symbol, price: quote.price, previousClose: quote.previousClose, fetchedAt: quote.fetchedAt }]);
      }
      price = quote.price;
    }

    if (shares === null) {
      // Converted here rather than in the browser, against the exact price being recorded.
      shares = sharesForAmount(amount as number, price);
      if (shares === null) {
        return NextResponse.json({ error: `${symbol} has no usable price, so that amount cannot be converted to shares.` }, { status: 400 });
      }
    }

    // Cash for this lot. Zero is a real answer, so it is only defaulted when nothing was sent —
    // and a gift defaults to nothing rather than to its basis.
    let cashPaid: number | null = null;
    if (has(b.cashPaid)) {
      const parsed = Number(b.cashPaid);
      if (!Number.isFinite(parsed) || parsed < 0) return NextResponse.json({ error: "Amount invested cannot be negative" }, { status: 400 });
      cashPaid = parsed;
    } else if (acquisition === "gift") {
      cashPaid = 0;
    }

    const fees = Number(b.fees);
    const tx = createTransaction(u, {
      symbol,
      kind,
      shares,
      price,
      fees: Number.isFinite(fees) ? fees : 0,
      acquisition,
      cashPaid,
      date,
      note: b.note ? String(b.note) : null,
    });

    const holding = syncHoldingFromTransactions(u, symbol);
    return NextResponse.json({ transaction: tx, holding }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not record the transaction" }, { status: 500 });
  }
}
