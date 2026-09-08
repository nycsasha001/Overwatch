import { NextResponse } from "next/server";
import { currentUser } from "@/lib/current-user";
import { userAuthState } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Who is signed in, for the shell to render a name and a sign-out button.
 *
 * Returns the public fields only — never the password hash, and never anything that would let a
 * page act on another account's behalf. `accountsEnabled` lets the UI hide the sign-out control on
 * a development server that has no AUTH_SECRET and therefore no accounts.
 */
export async function GET() {
  const state = userAuthState(process.env.AUTH_SECRET, process.env.NODE_ENV === "production");
  const user = await currentUser();
  return NextResponse.json({ user, accountsEnabled: state.mode === "enforced" });
}
