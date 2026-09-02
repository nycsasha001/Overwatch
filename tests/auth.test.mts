import assert from "node:assert/strict";
import {
  SESSION_COOKIE,
  authState,
  isPublicPath,
  passwordMatches,
  signSession,
  verifySession,
} from "../src/lib/auth.ts";

let checks = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  checks++;
  console.log(`  ok  ${name}`);
};

const SECRET = "correct horse battery staple";
const HOUR = 3600_000;

await ok("the right password is accepted and near misses are not", async () => {
  assert.equal(await passwordMatches(SECRET, SECRET), true);
  for (const wrong of ["", " ", "Correct horse battery staple", `${SECRET} `, SECRET.slice(0, -1), "x"]) {
    assert.equal(await passwordMatches(wrong, SECRET), false, `accepted ${JSON.stringify(wrong)}`);
  }
});

await ok("with no password configured nothing is accepted", async () => {
  // Belt and braces: authState already refuses to enforce with an empty secret, but a bug there
  // must not turn into "any password works".
  assert.equal(await passwordMatches("", ""), false);
  assert.equal(await passwordMatches("anything", ""), false);
});

await ok("a signed session verifies, and only against its own secret", async () => {
  const token = await signSession(SECRET, Date.now() + HOUR);
  assert.equal(await verifySession(SECRET, token), true);
  assert.equal(await verifySession("some other password", token), false);
});

await ok("the token carries no secret and no password", async () => {
  const token = await signSession(SECRET, Date.now() + HOUR);
  assert.ok(!token.includes(SECRET), "the password is in the cookie");
  // Only an expiry and a signature, separated by a dot.
  assert.match(token, /^\d+\.[A-Za-z0-9_-]+$/);
});

await ok("an expired token is refused even though it is properly signed", async () => {
  const expired = await signSession(SECRET, Date.now() - 1);
  assert.equal(await verifySession(SECRET, expired), false, "expiry means nothing if this passes");

  // And valid right up to the moment it is not.
  const at = Date.now() + HOUR;
  const token = await signSession(SECRET, at);
  assert.equal(await verifySession(SECRET, token, at - 1), true);
  assert.equal(await verifySession(SECRET, token, at), false);
});

await ok("a tampered expiry is refused", async () => {
  // The attack this exists to stop: take a real cookie, push its expiry into the future.
  const token = await signSession(SECRET, Date.now() + HOUR);
  const signature = token.slice(token.indexOf(".") + 1);
  const forged = `${Date.now() + 400 * 24 * HOUR}.${signature}`;
  assert.equal(await verifySession(SECRET, forged), false);
});

await ok("a tampered signature is refused", async () => {
  const token = await signSession(SECRET, Date.now() + HOUR);
  const [payload, sig] = token.split(".");
  const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
  assert.equal(await verifySession(SECRET, `${payload}.${flipped}`), false);
  assert.equal(await verifySession(SECRET, `${payload}.`), false);
  assert.equal(await verifySession(SECRET, payload), false, "no signature at all");
});

await ok("junk and empty tokens are refused rather than throwing", async () => {
  for (const junk of [undefined, null, "", ".", "..", "abc", "abc.def", "NaN.xxx", "1e999.xxx", "-1.xxx"]) {
    assert.equal(await verifySession(SECRET, junk as string | null | undefined), false, `accepted ${junk}`);
  }
});

await ok("no password in development leaves the app open; in production it fails closed", () => {
  // The whole point: a local run should not demand a password nobody has set, and a deploy that
  // forgot to set one must not quietly serve the journal to the internet.
  assert.deepEqual(authState(undefined, false), { mode: "open" });
  assert.deepEqual(authState("", false), { mode: "open" });
  assert.deepEqual(authState("   ", false), { mode: "open" });

  assert.deepEqual(authState(undefined, true), { mode: "misconfigured" });
  assert.deepEqual(authState("", true), { mode: "misconfigured" });
  assert.deepEqual(authState("   ", true), { mode: "misconfigured" }, "whitespace is not a password");
});

await ok("a configured password is enforced in both environments", () => {
  assert.deepEqual(authState(SECRET, false), { mode: "enforced", secret: SECRET });
  assert.deepEqual(authState(SECRET, true), { mode: "enforced", secret: SECRET });
  assert.deepEqual(authState(`  ${SECRET}  `, true), { mode: "enforced", secret: SECRET }, "trimmed");
});

await ok("only the login screen and its endpoints are public", () => {
  for (const open of ["/login", "/api/auth/login", "/api/auth/logout", "/_next/static/x.js"]) {
    assert.equal(isPublicPath(open), true, `${open} should be reachable`);
  }
  // Everything else, and the API especially — this is the list that must not grow by accident.
  for (const closed of [
    "/",
    "/journal",
    "/replay",
    "/settings",
    "/api/trades",
    "/api/accounts",
    "/api/settings",
    "/api/candles",
    "/api/market/import",
    "/api/obsidian/export",
    "/api/screenshots",
    "/login/../api/trades",
  ]) {
    assert.equal(isPublicPath(closed), false, `${closed} must be behind the password`);
  }
});

await ok("the cookie name is stable", () => {
  // Renaming it silently signs everyone out, so it is worth a test noticing.
  assert.equal(SESSION_COOKIE, "overwatch_session");
});

console.log(`\n${checks} auth checks passed`);
