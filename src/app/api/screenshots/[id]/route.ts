import { NextRequest, NextResponse } from "next/server";
import { deleteScreenshot } from "@/lib/db";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const { id } = await ctx.params;
  deleteScreenshot(u, id);
  return NextResponse.json({ ok: true });
}
