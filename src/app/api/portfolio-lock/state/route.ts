import { NextRequest, NextResponse } from "next/server";
import { PORTFOLIO_COOKIE, portfolioLockState, verifySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Whether the lock is configured, and whether it is currently open.
 *
 * Says nothing about the password itself — only whether one exists. The page needs this to decide
 * between showing the lock screen and showing your holdings.
 */
export async function GET(req: NextRequest) {
  const lock = portfolioLockState(process.env.PORTFOLIO_PASSWORD);
  if (lock.mode === "off") return NextResponse.json({ enabled: false, unlocked: true });

  const unlocked = await verifySession(lock.secret, req.cookies.get(PORTFOLIO_COOKIE)?.value);
  return NextResponse.json({ enabled: true, unlocked });
}
