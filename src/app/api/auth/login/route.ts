import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, authState, passwordMatches, signSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Exchange the password for a session cookie.
 *
 * The password is read from the request body and compared on the server; it is never stored, never
 * logged, and never sent back. What returns is a signed expiry — see src/lib/auth.ts.
 */
export async function POST(req: NextRequest) {
  const state = authState(process.env.APP_PASSWORD, process.env.NODE_ENV === "production");
  if (state.mode === "misconfigured") {
    return NextResponse.json({ error: "APP_PASSWORD is not set on the server." }, { status: 503 });
  }
  if (state.mode === "open") {
    return NextResponse.json({ ok: true, note: "No password is set; the app is open." });
  }

  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  const supplied = typeof body.password === "string" ? body.password : "";

  if (!(await passwordMatches(supplied, state.secret))) {
    /**
     * A deliberate pause on failure.
     *
     * There is one password and no account to lock, so the only thing standing between a guesser
     * and the journal is how fast they can try. A quarter of a second is invisible when you typed
     * it wrong and ruinous to anyone working through a list.
     */
    await new Promise((r) => setTimeout(r, 250));
    return NextResponse.json({ error: "That password is not right." }, { status: 401 });
  }

  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: await signSession(state.secret, expiresAt),
    // Unreadable to JavaScript, so a script injected into the page cannot lift the session.
    httpOnly: true,
    // Sent over HTTPS only in production. Left off in development, where the app is plain http on
    // localhost and a secure cookie would simply never be stored.
    secure: process.env.NODE_ENV === "production",
    // Lax rather than strict: strict withholds the cookie on the first navigation in from an
    // external link, which logs you out every time you open a bookmark from another app.
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
