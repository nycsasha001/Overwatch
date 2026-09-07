import { NextRequest, NextResponse } from "next/server";
import { resetPortfolio, snapshotPortfolio } from "@/lib/db";

export const dynamic = "force-dynamic";

/** What is actually there, so the confirmation can name real numbers instead of a vague warning. */
export async function GET() {
  const b = snapshotPortfolio();
  return NextResponse.json({
    holdings: b.holdings.length,
    transactions: b.holdings.reduce((n, h) => n + h.transactions.length, 0),
    snapshots: b.snapshots.length,
    watchlist: b.watchlist.length,
    cash: b.cash,
  });
}

/**
 * Clear the portfolio back to nothing.
 *
 * Returns everything it removed, so undo can put it all back. Defaults to clearing every part —
 * "reset" means reset — but each is selectable, because wiping the recorded value history is the
 * one genuinely unrecoverable loss here: prices can be refetched and positions retyped, but a
 * record of what the portfolio was worth last Tuesday cannot be reconstructed from anywhere.
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const flag = (k: string) => (b[k] === undefined ? true : b[k] === true);

    const removed = resetPortfolio({
      holdings: flag("holdings"),
      history: flag("history"),
      cash: flag("cash"),
      watchlist: flag("watchlist"),
    });

    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not reset the portfolio" }, { status: 500 });
  }
}
