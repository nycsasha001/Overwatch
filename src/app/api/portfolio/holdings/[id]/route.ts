import { NextRequest, NextResponse } from "next/server";
import { deleteHolding, getHolding, listTransactions, restateCostBasis, snapshotHolding, updateHolding } from "@/lib/db";
import { validateHolding } from "@/lib/portfolio-validate";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const { id } = await ctx.params;
    const existing = getHolding(u, id);
    if (!existing) return NextResponse.json({ error: "Holding not found" }, { status: 404 });

    const body = await req.json();
    // An edit sends only what changed, so validate the merged result rather than the patch — that
    // way "shares: 0" is still rejected while an untouched field is left alone.
    const parsed = validateHolding({ ...existing, ...body });
    if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });

    // Cost is optional on the way in but a holding always has one; falling back to what is stored
    // means an edit that touches only the share count cannot blank it.
    // Editing works in shares, never amounts — "set this position to $500" is ambiguous about
    // whether the cost basis should move with it.
    const holding = updateHolding(u, id, {
      ...parsed,
      shares: parsed.shares ?? existing.shares,
      avgCost: parsed.avgCost ?? existing.avgCost,
    });

    /**
     * A changed average cost has to go through the transaction history, not around it.
     *
     * `updateHolding` writes the column, but the column is derived: the next buy, sell or deleted
     * transaction calls `syncHoldingFromTransactions`, which recomputes it from the lots and
     * overwrites whatever was typed. Restating the lots makes the new figure the thing the
     * computation produces, so it holds.
     *
     * Only when it actually changed. An edit to the share count alone must not quietly collapse a
     * multi-lot history into one row.
     */
    const wantsNewCost = parsed.avgCost !== null && Math.abs(parsed.avgCost - existing.avgCost) > 1e-9;

    // Captured before the restatement, because it is about to delete them. Returned so undo does
    // not depend on the browser having fetched the lots beforehand.
    const previousTransactions = wantsNewCost ? listTransactions(u, existing.symbol) : [];
    const restated = wantsNewCost ? restateCostBasis(u, id, parsed.avgCost as number, holding?.shares) : holding;

    return NextResponse.json({ holding: restated, previous: existing, previousTransactions });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not update the holding" }, { status: 500 });
  }
}

/**
 * Delete a position, returning everything needed to put it back.
 *
 * The response carries the holding and its transactions so undo does not depend on the browser
 * having remembered them, and does not need a second round trip before deleting. Without this the
 * cascade on holding_id takes the transactions with the row and nothing could restore them.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const { id } = await ctx.params;
  const snapshot = snapshotHolding(u, id);
  if (!snapshot) return NextResponse.json({ error: "Holding not found" }, { status: 404 });
  deleteHolding(u, id);
  return NextResponse.json({ ok: true, ...snapshot });
}
