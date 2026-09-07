import { NextRequest, NextResponse } from "next/server";
import { deleteTransaction, listTransactions, syncHoldingFromTransactions } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Delete a transaction and rebuild the position from what remains.
 *
 * This is how a mistake gets corrected: remove the wrong buy and the average cost recalculates
 * itself, rather than you working out what the average should have been.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Find which symbol it belonged to before deleting it, or there is nothing left to resync.
  const symbol = listTransactions().find((t) => t.id === id)?.symbol ?? null;
  deleteTransaction(id);
  if (symbol) syncHoldingFromTransactions(symbol);
  return NextResponse.json({ ok: true });
}
