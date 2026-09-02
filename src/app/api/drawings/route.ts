import { NextRequest, NextResponse } from "next/server";
import { getDrawings, saveDrawings } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  return NextResponse.json({ symbol, drawings: getDrawings(symbol) });
}

/** Replaces every drawing on a symbol. The client owns the list and saves it whole. */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const symbol = String(body?.symbol ?? "").trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  if (!Array.isArray(body?.drawings)) return NextResponse.json({ error: "drawings must be an array" }, { status: 400 });
  saveDrawings(symbol, body.drawings);
  return NextResponse.json({ symbol, saved: body.drawings.length });
}
