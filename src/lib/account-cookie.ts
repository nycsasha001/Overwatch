/**
 * Issuing and clearing the account session cookie, in one place.
 *
 * Three routes set or clear this cookie, and the flags are what make it safe. Keeping them here
 * means they cannot drift apart — a logout that forgets `path` leaves a cookie the browser still
 * sends, and a login that forgets `httpOnly` puts the session within reach of any script on the
 * page.
 */

import { NextResponse } from "next/server";
import { USER_COOKIE, USER_MAX_AGE_SECONDS, signUserSession } from "./auth";

export async function withUserSession(res: NextResponse, secret: string, userId: string): Promise<NextResponse> {
  res.cookies.set({
    name: USER_COOKIE,
    value: await signUserSession(secret, userId, Date.now() + USER_MAX_AGE_SECONDS * 1000),
    // Out of reach of JavaScript, so an injected script cannot read the session out of the page.
    httpOnly: true,
    // HTTPS only in production; left off locally, where a secure cookie would simply never be set.
    secure: process.env.NODE_ENV === "production",
    // Lax, not strict: strict withholds the cookie on the first navigation in from an external
    // link, which signs you out every time you open a bookmark from another app.
    sameSite: "lax",
    path: "/",
    maxAge: USER_MAX_AGE_SECONDS,
  });
  return res;
}

export function clearUserSession(res: NextResponse): NextResponse {
  // maxAge 0 rather than deleting: an expired cookie with the same flags is what reliably replaces
  // the existing one across browsers.
  res.cookies.set({
    name: USER_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
