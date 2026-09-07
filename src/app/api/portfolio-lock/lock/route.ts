import { NextResponse } from "next/server";
import { PORTFOLIO_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Lock it again.
 *
 * Called when you navigate away from the Portfolio page, which is what makes "click out and back
 * means type it again" true rather than merely likely. The cookie's own ten-minute expiry is the
 * backstop for when this cannot run — a crashed tab, a closed laptop.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: PORTFOLIO_COOKIE, value: "", httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
