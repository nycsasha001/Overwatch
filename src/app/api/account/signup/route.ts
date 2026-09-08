import { NextRequest, NextResponse } from "next/server";
import { userAuthState } from "@/lib/auth";
import { withUserSession } from "@/lib/account-cookie";
import { validateSignup } from "@/lib/account-validate";
import { adoptLegacyJournal } from "@/lib/adopt-legacy";
import { countUsers, createUser, emailTaken, usernameTaken } from "@/lib/users";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Create an account.
 *
 * Reachable only after the shared `APP_PASSWORD` gate, which is the point of having two layers:
 * without it, anyone who found the URL could sign up and be inside. With it, they need the shared
 * password first, and all that buys them is a sign-up form.
 *
 * The response never contains the password, and nothing here logs it.
 */
export async function POST(req: NextRequest) {
  const state = userAuthState(process.env.AUTH_SECRET, process.env.NODE_ENV === "production");
  if (state.mode === "misconfigured") {
    return NextResponse.json({ error: "AUTH_SECRET is not set on the server." }, { status: 503 });
  }
  if (state.mode === "open") {
    return NextResponse.json(
      { error: "Accounts are disabled: this server has no AUTH_SECRET configured." },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const invalid = validateSignup(body);
  if (invalid) return NextResponse.json({ error: invalid.error, field: invalid.field }, { status: 400 });

  const username = String(body.username).trim();
  const email = String(body.email).trim();
  const password = String(body.password);

  if (emailTaken(email)) return NextResponse.json({ error: "That email is already registered.", field: "email" }, { status: 409 });
  if (usernameTaken(username)) return NextResponse.json({ error: "That display name is taken.", field: "username" }, { status: 409 });

  const first = countUsers() === 0;

  let user;
  try {
    user = createUser({ username, email, password });
  } catch {
    // The unique indexes are the real arbiter, and they can reject a request that passed the checks
    // above when two signups race. A 409 is the honest answer; a 500 would blame the wrong party.
    return NextResponse.json({ error: "That email or display name is already registered." }, { status: 409 });
  }

  // The first account inherits the journal that existed before accounts did. Only ever the first,
  // and only when there is something to inherit — see src/lib/adopt-legacy.ts.
  if (first) adoptLegacyJournal(user.id);

  // Create the journal now rather than on first read, so a new account lands on a working app
  // instead of an error the first time something queries an absent file.
  db(user.id);

  const res = NextResponse.json({ user }, { status: 201 });
  return withUserSession(res, state.secret, user.id);
}
