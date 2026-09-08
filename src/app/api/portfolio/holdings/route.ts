import { NextRequest, NextResponse } from "next/server";
import {
  createHolding,
  createTransaction,
  listHoldings,
  readPriceCache,
  syncHoldingFromTransactions,
  writePriceCache,
} from "@/lib/db";
import { hasApiKey, refreshQuotes } from "@/lib/prices";
import { isManuallyValued, sharesForAmount } from "@/lib/portfolio";
import { validateHolding } from "@/lib/portfolio-validate";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  return NextResponse.json(listHoldings(u));
}

/**
 * Add a position.
 *
 * You give the symbol and either a share count or a dollar amount; the server stamps the price it
 * is trading at right now and records that as a buy. So the day you enter it is the day you bought
 * it, at that price.
 *
 * When an amount is given the division happens here, against the very price being recorded, so that
 * shares x price equals the amount exactly. Converting in the browser against a price fetched a
 * moment earlier would turn "$500 of AAPL" into a cost basis of $499.83.
 *
 * The price is fetched here rather than accepted from the browser on purpose. A cost basis posted
 * by the client is a number the client chose, and every return figure on the page is computed from
 * it; fetching it server-side means the recorded price is one the market actually quoted.
 *
 * None of that applies to gold in a safe, a savings balance or a house. Those have no ticker, so
 * the feed is skipped entirely and your own figures are taken at face value — including when the
 * API key is missing, which must not stop you recording something the key was never going to help
 * with.
 */
export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const parsed = validateHolding(await req.json());
    if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });

    const manual = isManuallyValued(parsed.assetType);
    const today = new Date().toISOString().slice(0, 10);
    const date = parsed.acquiredAt ?? today;
    let price = parsed.avgCost;

    // A gift's basis is its value on the day it arrived, and this feed cannot quote a past day —
    // its /quote endpoint returns the current price and nothing else. Stamping today's price onto
    // something received last year would invent a basis and, with it, every return figure derived
    // from it. So it is only allowed to stand in when the gift arrived today.
    if (price === null && parsed.acquisition !== "purchase" && date !== today) {
      return NextResponse.json(
        { error: "Enter what it was worth when you received it — prices for past dates cannot be looked up." },
        { status: 400 }
      );
    }

    // Validation guarantees a cost and a value for manual types, so there is nothing to look up.
    if (price === null && !manual) {
      if (!hasApiKey()) {
        return NextResponse.json(
          { error: "Live prices are off, so there is no price to record. Set FINNHUB_API_KEY, or enter the price you paid." },
          { status: 400 }
        );
      }
      const cache = readPriceCache(u);
      const { quotes, fetched } = await refreshQuotes([parsed.symbol], cache, { force: true });
      const quote = quotes.get(parsed.symbol);
      if (!quote) {
        return NextResponse.json(
          { error: `No price is available for ${parsed.symbol} right now, so it cannot be recorded. Check the ticker, or try again in a moment.` },
          { status: 400 }
        );
      }
      if (fetched.length) {
        writePriceCache(u, [{ symbol: quote.symbol, price: quote.price, previousClose: quote.previousClose, fetchedAt: quote.fetchedAt }]);
      }
      price = quote.price;
    }

    if (price === null) {
      return NextResponse.json({ error: `No price could be determined for ${parsed.symbol}.` }, { status: 400 });
    }

    let shares = parsed.shares;
    if (shares === null) {
      shares = sharesForAmount(parsed.amount as number, price);
      if (shares === null) {
        return NextResponse.json({ error: `${parsed.symbol} has no usable price, so that amount cannot be converted to shares.` }, { status: 400 });
      }
    }

    // The holding row carries the name, type and — for the things no feed quotes — what you say a
    // unit is worth. The share count and cost come from the transactions below.
    createHolding(u, {
      symbol: parsed.symbol,
      name: parsed.name,
      shares,
      avgCost: price,
      assetType: parsed.assetType,
      manualPrice: parsed.manualPrice,
      note: parsed.note,
    });

    createTransaction(u, {
      symbol: parsed.symbol,
      kind: "buy",
      shares,
      // The basis per unit. For a gift, what it was worth when it arrived.
      price,
      acquisition: parsed.acquisition,
      // Null lets the lot arithmetic apply the default for the acquisition type — full basis for a
      // purchase, nothing for a gift — rather than freezing a number the form never asked for.
      cashPaid: parsed.amountInvested,
      date,
    });

    // Recompute from the full history, so buying more later averages correctly rather than
    // depending on the order things happened to be entered.
    const holding = syncHoldingFromTransactions(u, parsed.symbol);
    return NextResponse.json(holding, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not add the holding" }, { status: 500 });
  }
}
