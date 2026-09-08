import { NextResponse } from "next/server";
import { clearUserSession } from "@/lib/account-cookie";

export const dynamic = "force-dynamic";

/**
 * Sign out of the account, staying inside the shared-password gate.
 *
 * Deliberately does not clear the app-password cookie: those are two different doors, and someone
 * switching accounts should not have to retype the shared password to do it.
 */
export async function POST() {
  return clearUserSession(NextResponse.json({ ok: true }));
}
