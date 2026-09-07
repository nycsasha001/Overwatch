import { NextRequest, NextResponse } from "next/server";
import { GROUPS, searchSymbols } from "@/lib/symbols";

export const dynamic = "force-dynamic";

/** The curated catalogue, searchable. Static data — no external call, so it always works. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ groups: GROUPS, results: searchSymbols(q) });
}
