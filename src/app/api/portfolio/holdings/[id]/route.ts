import { NextRequest, NextResponse } from "next/server";
import { deleteHolding, getHolding, snapshotHolding, updateHolding } from "@/lib/db";
import { validateHolding } from "@/lib/portfolio-validate";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const existing = getHolding(id);
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
    return NextResponse.json({
      holding: updateHolding(id, {
        ...parsed,
        shares: parsed.shares ?? existing.shares,
        avgCost: parsed.avgCost ?? existing.avgCost,
      }),
      previous: existing,
    });
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
  const { id } = await ctx.params;
  const snapshot = snapshotHolding(id);
  if (!snapshot) return NextResponse.json({ error: "Holding not found" }, { status: 404 });
  deleteHolding(id);
  return NextResponse.json({ ok: true, ...snapshot });
}
