import { NextRequest, NextResponse } from "next/server";
import { deleteBacktest } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteBacktest(id);
  return NextResponse.json({ ok: true });
}
