import { NextResponse } from "next/server";
import { rebaselineToNow } from "@/lib/db";
import { portfolioState } from "@/lib/portfolio-server";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

/**
 * Set today's value as the starting point.
 *
 * The current total is computed here rather than accepted from the browser: the baseline every
 * future gain is measured against must be a number the server worked out, not one the client sent.
 */
export async function POST() {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    // Priced first, so the baseline is the real total rather than whatever was last cached.
    const state = await portfolioState(u, { force: true });
    const { totals } = state;

    if (totals.marketValue <= 0 && totals.cash <= 0) {
      return NextResponse.json(
        { error: "There is nothing to set a starting point from yet. Add a holding or a cash balance first." },
        { status: 400 }
      );
    }

    // The new baseline carries its own class split, so a filtered chart works from the reset
    // forward instead of starting blind again.
    const breakdown: Record<string, number> = {};
    for (const p of state.positions) {
      if (p.marketValue === null) continue;
      breakdown[p.holding.assetType] = Math.round(((breakdown[p.holding.assetType] ?? 0) + p.marketValue) * 100) / 100;
    }

    const { removed, ts } = rebaselineToNow(u, totals.total, totals.cash, totals.marketValue, breakdown);
    return NextResponse.json({ ok: true, total: totals.total, ts, removed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not set the starting point" }, { status: 500 });
  }
}
