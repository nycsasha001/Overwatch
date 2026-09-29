import { NextResponse } from "next/server";
import { SESSION_COOKIE, isPublicServer } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Drop the session. Expiring the cookie is enough — the token is worthless without it. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: isPublicServer(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
