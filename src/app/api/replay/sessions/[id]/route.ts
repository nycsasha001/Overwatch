import { NextRequest, NextResponse } from "next/server";
import { deleteReplaySession, getReplaySession } from "@/lib/db";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const { id } = await ctx.params;
  const session = getReplaySession(u, id);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ session });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const { id } = await ctx.params;
  const session = getReplaySession(u, id);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  // Returned so a delete can be undone without a second round trip, the way holdings already work.
  deleteReplaySession(u, id);
  return NextResponse.json({ ok: true, session });
}
