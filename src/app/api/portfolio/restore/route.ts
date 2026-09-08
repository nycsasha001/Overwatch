import { NextRequest, NextResponse } from "next/server";
import { restoreBundle, type PortfolioBundle } from "@/lib/db";
import type { PortfolioHolding, PortfolioTransaction } from "@/lib/types";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

/**
 * Put back what was removed — the other half of both undo and reset.
 *
 * Accepts either a single holding (undoing one deletion) or a whole bundle (undoing a reset). Kept
 * separate from the create endpoint because create *records a buy at today's price*, which is
 * exactly wrong here: restoring must reinstate what was there, not stamp a new purchase at
 * whatever the market happens to be doing right now.
 */
export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const body = (await req.json()) as {
      holding?: PortfolioHolding;
      transactions?: PortfolioTransaction[];
      bundle?: Partial<PortfolioBundle>;
    };

    if (body.bundle) {
      restoreBundle(u, body.bundle);
      return NextResponse.json({ ok: true });
    }

    const h = body.holding;
    if (!h || typeof h.symbol !== "string" || !h.symbol.trim()) {
      return NextResponse.json({ error: "Nothing to restore" }, { status: 400 });
    }
    if (!Number.isFinite(h.shares) || !Number.isFinite(h.avgCost)) {
      return NextResponse.json({ error: "That holding is not restorable" }, { status: 400 });
    }

    const transactions = Array.isArray(body.transactions)
      ? body.transactions.filter(
          (t) => t && typeof t.symbol === "string" && Number.isFinite(t.shares) && Number.isFinite(t.price) && typeof t.date === "string"
        )
      : [];

    restoreBundle(u, { holdings: [{ holding: h, transactions }] });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not restore it" }, { status: 500 });
  }
}
