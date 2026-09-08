import { NextRequest, NextResponse } from "next/server";
import { userAuthState } from "@/lib/auth";
import { withUserSession } from "@/lib/account-cookie";
import { validateLogin } from "@/lib/account-validate";
import { authenticate } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Sign in to an account.
 *
 * One failure message for every kind of failure, on purpose. "No such user" and "wrong password"
 * are different facts, and telling them apart turns this form into a way to find out who has an
 * account here. `authenticate` hashes even when the identifier is unknown so the timing does not
 * give away what the message withholds.
 */
export async function POST(req: NextRequest) {
  const state = userAuthState(process.env.AUTH_SECRET, process.env.NODE_ENV === "production");
  if (state.mode === "misconfigured") {
    return NextResponse.json({ error: "AUTH_SECRET is not set on the server." }, { status: 503 });
  }
  if (state.mode === "open") {
    return NextResponse.json({ error: "Accounts are disabled on this server." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const invalid = validateLogin(body);
  if (invalid) return NextResponse.json({ error: invalid.error, field: invalid.field }, { status: 400 });

  const user = authenticate(String(body.identifier).trim(), String(body.password));
  if (!user) {
    // The same deliberate pause as the shared password gate: there is no account lockout here, so
    // the only thing limiting a guesser is how many attempts per second they can get.
    await new Promise((r) => setTimeout(r, 250));
    return NextResponse.json({ error: "That email or password is not right." }, { status: 401 });
  }

  return withUserSession(NextResponse.json({ user }), state.secret, user.id);
}
