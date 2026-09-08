import { NextRequest, NextResponse } from "next/server";
import { deleteTrade, getTrade, updateTrade } from "@/lib/db";
import { jsonError, normalizeTrade } from "@/lib/validate";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const { id } = await ctx.params;
  const t = getTrade(u, id);
  if (!t) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  return NextResponse.json(t);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const existing = getTrade(u, id);
    if (!existing) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    const t = updateTrade(u, id, normalizeTrade(body, id, String(body.accountId ?? existing.accountId)));
    return NextResponse.json(t);
  } catch (e) {
    const { error, field, status } = jsonError(e) as { error: string; field?: string; status: number };
    return NextResponse.json({ error, field }, { status });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const { id } = await ctx.params;
  deleteTrade(u, id);
  return NextResponse.json({ ok: true });
}
