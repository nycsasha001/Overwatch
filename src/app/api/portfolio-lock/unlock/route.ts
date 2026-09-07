import { NextRequest, NextResponse } from "next/server";
import {
  PORTFOLIO_COOKIE,
  PORTFOLIO_MAX_AGE_SECONDS,
  passwordMatches,
  portfolioLockState,
  signSession,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Exchange the portfolio password for a short-lived cookie. */
export async function POST(req: NextRequest) {
  const lock = portfolioLockState(process.env.PORTFOLIO_PASSWORD);
  if (lock.mode === "off") return NextResponse.json({ ok: true, note: "No portfolio password is set." });

  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  const supplied = typeof body.password === "string" ? body.password : "";

  if (!(await passwordMatches(supplied, lock.secret))) {
    // The same deliberate pause as the main login. One password, no account to lock, so the only
    // thing between a guesser and your holdings is how fast they can try.
    await new Promise((r) => setTimeout(r, 250));
    return NextResponse.json({ error: "That password is not right." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, expiresIn: PORTFOLIO_MAX_AGE_SECONDS });
  res.cookies.set({
    name: PORTFOLIO_COOKIE,
    value: await signSession(lock.secret, Date.now() + PORTFOLIO_MAX_AGE_SECONDS * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Scoped to "/" rather than "/portfolio" so the browser sends it to /api/portfolio too — a
    // cookie pathed at /portfolio would be withheld from the very endpoints that need checking.
    path: "/",
    maxAge: PORTFOLIO_MAX_AGE_SECONDS,
  });
  return res;
}
