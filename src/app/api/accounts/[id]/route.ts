import { NextRequest, NextResponse } from "next/server";
import { deleteAccount, updateAccount } from "@/lib/db";
import { ACCOUNT_TYPES, isAccountType } from "@/lib/types";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const { id } = await ctx.params;
  const b = await req.json();
  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) patch.name = String(b.name).trim();
  if (b.type !== undefined) {
    if (!isAccountType(b.type)) {
      return NextResponse.json({ error: `type must be one of ${ACCOUNT_TYPES.join(", ")}` }, { status: 400 });
    }
    patch.type = b.type;
  }
  if (b.startingBalance !== undefined) patch.startingBalance = Number(b.startingBalance) || 0;
  if (b.currency !== undefined) patch.currency = String(b.currency);
  if (b.defaultRiskPct !== undefined) patch.defaultRiskPct = b.defaultRiskPct === null || b.defaultRiskPct === "" ? null : Number(b.defaultRiskPct);
  if (b.archived !== undefined) patch.archived = b.archived ? 1 : 0;
  if (b.profitTarget !== undefined) patch.profitTarget = num(b.profitTarget);
  if (b.maxDrawdown !== undefined) patch.maxDrawdown = num(b.maxDrawdown);
  if (b.drawdownType !== undefined) patch.drawdownType = b.drawdownType === "trailing" ? "trailing" : "static";
  if (b.dailyLossLimit !== undefined) patch.dailyLossLimit = num(b.dailyLossLimit);
  const acc = updateAccount(u, id, patch);
  if (!acc) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json(acc);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const { id } = await ctx.params;
  deleteAccount(u, id);
  return NextResponse.json({ ok: true });
}
