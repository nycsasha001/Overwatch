import { NextRequest, NextResponse } from "next/server";
import { getTrade, insertTrade, uid } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const src = getTrade(id);
  if (!src) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  const { screenshots: _s, createdAt: _c, updatedAt: _u, ...rest } = src;
  void _s; void _c; void _u;
  const copy = insertTrade({ ...rest, id: uid("trd") });
  return NextResponse.json(copy, { status: 201 });
}
