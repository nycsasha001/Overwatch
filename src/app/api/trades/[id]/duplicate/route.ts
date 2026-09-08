import { NextRequest, NextResponse } from "next/server";
import { getTrade, insertTrade, uid } from "@/lib/db";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const { id } = await ctx.params;
  const src = getTrade(u, id);
  if (!src) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  const { screenshots: _s, createdAt: _c, updatedAt: _u, ...rest } = src;
  void _s; void _c; void _u;
  const copy = insertTrade(u, { ...rest, id: uid("trd") });
  return NextResponse.json(copy, { status: 201 });
}
