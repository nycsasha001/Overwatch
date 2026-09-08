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

/* ---------------------------- the portfolio gate ----------------------------- */

/**
 * A second, separate lock in front of the Portfolio page.
 *
 * Same crypto as the main gate, different secret and a much shorter life. The point is different
 * too: `APP_PASSWORD` keeps other people out of the app, while this keeps the one screen showing
 * your net worth from being on display to anyone who wanders past an already-signed-in browser.
 *
 * Be clear about what it is and is not. Anyone who has already passed `APP_PASSWORD` is inside the
 * app; this adds a second thing to know, not a second layer of cryptography. It is worth having for
 * exactly the reason you asked for it — shoulders and borrowed laptops — and not worth relying on
 * for anything more.
 */
export const PORTFOLIO_COOKIE = "overwatch_portfolio";

/**
 * Ten minutes.
 *
 * Short on purpose: the page locks itself when you navigate away, and this is the backstop for when
 * that cannot run — a crashed tab, a killed browser, a machine put to sleep mid-session. Long
 * enough that a reload during normal use is not a nuisance.
 */
export const PORTFOLIO_MAX_AGE_SECONDS = 10 * 60;

/**
 * Is the second gate switched on?
 *
 * Unset means off, in development *and* production — unlike the main password, which fails closed.
 * The difference is what each protects: shipping without `APP_PASSWORD` exposes the whole app to
 * the internet, whereas shipping without this exposes the Portfolio page to someone who already
 * knows your main password. Failing closed here would lock you out of your own feature for not
 * configuring an optional extra, which is a worse outcome than not having it.
 */
export function portfolioLockState(password: string | undefined): { mode: "enforced"; secret: string } | { mode: "off" } {
  const secret = password?.trim() ?? "";
  return secret ? { mode: "enforced", secret } : { mode: "off" };
}

/** Paths the second gate covers: the page itself and everything serving it data. */
export function isPortfolioPath(pathname: string): boolean {
  return pathname === "/portfolio" || pathname.startsWith("/portfolio/") || pathname.startsWith("/api/portfolio");
}

/** The endpoints that unlock and lock it, which must stay reachable while it is locked. */
export function isPortfolioAuthPath(pathname: string): boolean {
  return pathname === "/api/portfolio-lock/unlock" || pathname === "/api/portfolio-lock/lock" || pathname === "/api/portfolio-lock/state";
}

/* ------------------------------ the account gate ----------------------------- */

/**
 * The second layer: which person is this?
 *
 * `APP_PASSWORD` above decides whether a browser may reach Overwatch at all. This decides whose
 * journal it then sees. Both gates must pass, in that order — knowing the shared password gets you
 * to a sign-in screen and nothing else.
 *
 * The token is the same shape as the one above with the user id folded in: `userId.expiry.hmac`,
 * signed with `AUTH_SECRET`. It carries no password material, so a stolen cookie cannot be turned
 * back into anyone's credentials, and it cannot be edited to name a different user without the key.
 *
 * Signed rather than looked up because middleware runs on the Edge runtime, where SQLite does not
 * exist. Middleware can therefore prove a token is authentic and unexpired but not that the account
 * still exists — so it decides *routing* only, and every route handler independently resolves the
 * user against the database before touching data. See requireUser in src/lib/session.ts.
 */
export const USER_COOKIE = "overwatch_user";

/** Matches the app-password session: long enough not to nag, short enough to lapse if forgotten. */
export const USER_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The key user sessions are signed with.
 *
 * Deliberately not `APP_PASSWORD`. That value is shared with everyone who is allowed to reach the
 * app — including, one day, someone you would rather not have the ability to mint session tokens
 * for other people's accounts. It also changes whenever you rotate the shared password, which would
 * sign everybody out for an unrelated reason.
 *
 * Fails closed in production for the same reason APP_PASSWORD does: running with no signing key
 * means accepting forged sessions, which is worse than not running.
 */
export function userAuthState(secret: string | undefined, isProduction: boolean):
  | { mode: "enforced"; secret: string }
  | { mode: "open" }
  | { mode: "misconfigured" } {
  const value = secret?.trim() ?? "";
  if (value) return { mode: "enforced", secret: value };
  return isProduction ? { mode: "misconfigured" } : { mode: "open" };
}

export async function signUserSession(secret: string, userId: string, expiresAt: number): Promise<string> {
  const payload = `${userId}.${Math.floor(expiresAt)}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

/**
 * Returns the user id the token names, or null.
 *
 * Everything is checked before the id is believed: the signature covers both the id and the expiry,
 * so neither can be altered independently, and an expired token is refused even though its
 * signature is perfectly good.
 */
export async function verifyUserSession(
  secret: string,
  token: string | undefined | null,
  now: number = Date.now()
): Promise<string | null> {
  if (!secret || !token) return null;

  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);

  const split = payload.lastIndexOf(".");
  if (split <= 0) return null;
  const userId = payload.slice(0, split);
  const expiresAt = Number(payload.slice(split + 1));
  if (!userId || !Number.isFinite(expiresAt) || expiresAt <= now) return null;

  if (!safeEqual(await hmac(secret, payload), signature)) return null;
  return userId;
}

/**
 * Paths reachable once past the shared password but before signing in to an account.
 *
 * Kept as tight as it can be: the account screen, the three endpoints it posts to, and the one that
 * tells the page who (if anyone) is signed in. Everything else in the app requires an account.
 */
export function isAccountPath(pathname: string): boolean {
  return (
    pathname === "/account" ||
    pathname === "/api/account/login" ||
    pathname === "/api/account/signup" ||
    pathname === "/api/account/logout" ||
    pathname === "/api/account/me"
  );
}
