import { NextRequest, NextResponse } from "next/server";
import { portfolioState } from "@/lib/portfolio-server";

export const dynamic = "force-dynamic";

/**
 * The whole portfolio in one response.
 *
 * `?refresh=1` bypasses the price cache, which is what the Refresh button sends. Without it prices
 * older than a minute are refetched and anything newer is served from cache, so simply opening the
 * page repeatedly costs no API calls.
 */
export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    return NextResponse.json(await portfolioState({ force }));
  } catch (e) {
    // The page has to render something even when the database or the network misbehaves; an
    // unhandled throw here would give a blank screen with no explanation.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load the portfolio" }, { status: 500 });
  }
}
