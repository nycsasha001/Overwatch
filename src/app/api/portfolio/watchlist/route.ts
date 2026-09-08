import { NextRequest, NextResponse } from "next/server";
import { addWatch, listWatchlist, readPriceCache, writePriceCache } from "@/lib/db";
import { refreshQuotes } from "@/lib/prices";
import { lookup } from "@/lib/symbols";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

/** The watchlist with a live price against each row. */
export async function GET() {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const items = listWatchlist(u);
    if (items.length === 0) return NextResponse.json({ items: [], quotes: {} });

    const cache = readPriceCache(u);
    const { quotes, fetched } = await refreshQuotes(items.map((i) => i.symbol), cache);
    if (fetched.length) {
      writePriceCache(u, 
        fetched
          .map((s) => quotes.get(s))
          .filter((q): q is NonNullable<typeof q> => Boolean(q))
          .map((q) => ({ symbol: q.symbol, price: q.price, previousClose: q.previousClose, fetchedAt: q.fetchedAt }))
      );
    }
    return NextResponse.json({ items, quotes: Object.fromEntries(quotes) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load the watchlist" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const b = await req.json();
    const symbol = String(b.symbol ?? "").trim().toUpperCase();
    if (!symbol) return NextResponse.json({ error: "A symbol is required" }, { status: 400 });
    if (!/^[A-Z0-9.:-]{1,15}$/.test(symbol)) {
      return NextResponse.json({ error: `"${symbol}" does not look like a ticker symbol` }, { status: 400 });
    }
    // Fall back to the catalogue for the name so the row is not just a bare ticker.
    const name = b.name ? String(b.name) : lookup(symbol)?.name ?? null;
    return NextResponse.json(addWatch(u, { symbol, name, note: b.note ? String(b.note) : null }), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not add to the watchlist" }, { status: 500 });
  }
}
