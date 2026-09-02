/**
 * The password gate.
 *
 * One shared password, held only in `APP_PASSWORD` on the server. What goes in the cookie is not
 * the password and not a hash of it — it is an expiry timestamp plus an HMAC of that timestamp,
 * keyed by the password. So a stolen cookie reveals nothing about the secret, cannot be extended
 * past its expiry without the key, and every session dies the moment the password is changed.
 *
 * Written against Web Crypto rather than node:crypto because middleware runs on the Edge runtime,
 * where node:crypto does not exist. The same functions therefore work in both places, which is what
 * lets one implementation guard both the pages and the API.
 */

export const SESSION_COOKIE = "overwatch_session";

/** How long a login lasts. Long enough not to be a nuisance, short enough to expire if forgotten. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/**
 * Compare without leaking, through timing, how much of the value was right.
 *
 * Both arguments here are always fixed-length digests, never raw secrets, so the early length
 * check cannot leak the length of anything that matters.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Is this the right password?
 *
 * Both sides are run through the same HMAC before comparing, so the comparison is between two
 * equal-length digests. Comparing the raw strings would return early on the first wrong character
 * and, worse, reveal the password's length through the length check.
 */
export async function passwordMatches(supplied: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([hmac(expected, supplied), hmac(expected, expected)]);
  return safeEqual(a, b);
}

/** A session token valid until `expiresAt` (epoch ms). */
export async function signSession(secret: string, expiresAt: number): Promise<string> {
  const payload = String(Math.floor(expiresAt));
  return `${payload}.${await hmac(secret, payload)}`;
}

/**
 * Is this token ours, and still valid?
 *
 * Expiry is checked as well as the signature: a token whose time has passed is refused even though
 * its signature is perfectly good, which is what makes the expiry mean anything.
 */
export async function verifySession(
  secret: string,
  token: string | undefined | null,
  now: number = Date.now()
): Promise<boolean> {
  if (!secret || !token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  return safeEqual(await hmac(secret, payload), signature);
}

/**
 * Whether the gate is switched on, and whether that is a problem.
 *
 * With no `APP_PASSWORD` set, development stays open — otherwise every local run would demand a
 * password nobody has configured yet. A production build with no password is the dangerous case,
 * and that one fails closed: better an app nobody can reach than a journal anybody can.
 */
export function authState(password: string | undefined, isProduction: boolean):
  | { mode: "enforced"; secret: string }
  | { mode: "open" }
  | { mode: "misconfigured" } {
  const secret = password?.trim() ?? "";
  if (secret) return { mode: "enforced", secret };
  return isProduction ? { mode: "misconfigured" } : { mode: "open" };
}

/** Paths reachable without a session: the login screen and the endpoint that creates one. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/_next/")
  );
}
