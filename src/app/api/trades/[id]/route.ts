import { NextRequest, NextResponse } from "next/server";
import { deleteTrade, getTrade, updateTrade } from "@/lib/db";
import { jsonError, normalizeTrade } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = getTrade(id);
  if (!t) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  return NextResponse.json(t);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const existing = getTrade(id);
    if (!existing) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    const t = updateTrade(id, normalizeTrade(body, id, String(body.accountId ?? existing.accountId)));
    return NextResponse.json(t);
  } catch (e) {
    const { error, field, status } = jsonError(e) as { error: string; field?: string; status: number };
    return NextResponse.json({ error, field }, { status });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteTrade(id);
  return NextResponse.json({ ok: true });
}
