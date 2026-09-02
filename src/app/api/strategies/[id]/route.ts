import { NextRequest, NextResponse } from "next/server";
import { deleteStrategy, updateStrategy } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await req.json();
  const s = updateStrategy(id, b);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(s);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteStrategy(id);
  return NextResponse.json({ ok: true });
}
