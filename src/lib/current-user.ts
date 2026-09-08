/**
 * Who is making this request?
 *
 * Middleware already turns away anyone without a valid token, but middleware runs on the Edge and
 * can only check the token's signature — it cannot ask whether the account still exists, and it
 * cannot be the thing that decides which rows a query sees. This is the check that does both, and
 * it runs inside every route handler that touches data.
 *
 * Two gates are not one gate twice. Middleware protects *routing*; this protects *data*. A route
 * that forgot to call it would be reachable only by signed-in users, but would then be free to read
 * whichever journal it liked — so the isolation lives here, not there.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { USER_COOKIE, userAuthState, verifyUserSession } from "./auth";
import { findUserById, type Scope, type User } from "./users";

export type { Scope } from "./users";

export async function currentUser(): Promise<User | null> {
  const state = userAuthState(process.env.AUTH_SECRET, process.env.NODE_ENV === "production");
  if (state.mode !== "enforced") return null;

  const jar = await cookies();
  const userId = await verifyUserSession(state.secret, jar.get(USER_COOKIE)?.value);
  if (!userId) return null;

  // The authoritative check middleware cannot make: a token for a deleted account is a valid
  // signature over a user that no longer exists, and must not open anything.
  return findUserById(userId);
}

/**
 * The scope for this request, or `undefined` when the caller is not entitled to one.
 *
 * `undefined` rather than `null` because `null` is itself a meaningful scope (the legacy journal),
 * and conflating "no account" with "the shared journal" is exactly the bug that would hand one
 * user's trades to another.
 */
export async function requireScope(): Promise<{ scope: Scope; user: User | null } | undefined> {
  const state = userAuthState(process.env.AUTH_SECRET, process.env.NODE_ENV === "production");

  // Development, no accounts configured: the legacy shared journal, as before.
  if (state.mode === "open") return { scope: null, user: null };
  if (state.mode === "misconfigured") return undefined;

  const user = await currentUser();
  if (!user) return undefined;
  return { scope: user.id, user };
}

/** The response for a request with no usable account. Never says whether the account existed. */
export function unauthorized() {
  return NextResponse.json({ error: "No account signed in" }, { status: 401 });
}
