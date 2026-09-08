import { NextRequest, NextResponse } from "next/server";
import { readPriceCache, writePriceCache } from "@/lib/db";
import { hasApiKey, refreshQuotes } from "@/lib/prices";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

/**
 * One live price, for the Add-holding form.
 *
 * Deliberately does NOT return anything the form should treat as your cost basis. The price is
 * shown for reference and can be copied into the cost field by an explicit click — auto-filling it
 * would make every position read as roughly break-even, because cost basis is what you paid, not
 * what it is worth today.
 */
export async function GET(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "A symbol is required" }, { status: 400 });
  if (!/^[A-Z0-9.:-]{1,15}$/.test(symbol)) return NextResponse.json({ error: "That is not a symbol" }, { status: 400 });

  try {
    if (!hasApiKey()) return NextResponse.json({ symbol, quote: null, pricingEnabled: false });

    const cache = readPriceCache(u);
    const { quotes, fetched } = await refreshQuotes([symbol], cache);
    if (fetched.length) {
      const q = quotes.get(symbol);
      if (q) writePriceCache(u, [{ symbol: q.symbol, price: q.price, previousClose: q.previousClose, fetchedAt: q.fetchedAt }]);
    }
    return NextResponse.json({ symbol, quote: quotes.get(symbol) ?? null, pricingEnabled: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not fetch a price" }, { status: 500 });
  }
}
