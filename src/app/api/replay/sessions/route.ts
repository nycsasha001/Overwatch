import { NextRequest, NextResponse } from "next/server";
import { listReplaySessions, saveReplaySession } from "@/lib/db";
import { parseSessionState } from "@/lib/replay-session";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const symbol = req.nextUrl.searchParams.get("symbol");
  return NextResponse.json({ sessions: listReplaySessions(u, symbol ?? undefined) });
}

/**
 * Save where you are in a replay.
 *
 * `auto` writes the rolling slot for the symbol — one row, overwritten as you step — while a named
 * save creates or updates a row of its own. The distinction lives here rather than in the browser
 * so that a tab left open overnight cannot quietly overwrite a run you deliberately kept.
 *
 * The state blob is parsed and re-serialised rather than stored as sent: what comes back out is
 * then guaranteed to be something the replay can actually load, instead of whatever shape the
 * client happened to post.
 */
export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const b = (await req.json()) as Record<string, unknown>;

    const symbol = String(b.symbol ?? "").trim().toUpperCase();
    if (!symbol) return NextResponse.json({ error: "A symbol is required" }, { status: 400 });

    const cursorTs = Number(b.cursorTs);
    if (!Number.isFinite(cursorTs)) return NextResponse.json({ error: "A cursor timestamp is required" }, { status: 400 });

    const auto = b.auto === true;
    const name = String(b.name ?? "").trim() || (auto ? "Where you left off" : "Untitled session");
    if (name.length > 80) return NextResponse.json({ error: "That name is too long" }, { status: 400 });

    const session = saveReplaySession(u, {
      id: typeof b.id === "string" && b.id ? b.id : null,
      name,
      symbol,
      tf: String(b.tf ?? "5m"),
      baseTf: String(b.baseTf ?? "1m"),
      cursorTs,
      auto,
      state: parseSessionState(b.state),
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save the session" }, { status: 500 });
  }
}
