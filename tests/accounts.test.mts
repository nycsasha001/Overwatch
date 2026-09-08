import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The account layer, and the isolation it exists to provide.
 *
 * The last group is the one that matters. Everything else here checks a component in isolation;
 * those checks prove the actual claim — that one user's journal cannot be read or written through
 * another user's session, and that the guarantee holds at the storage layer rather than depending
 * on every route remembering to filter.
 *
 * A temporary data directory is set before anything imports the modules under test, because both
 * db.ts and users.ts read TJ_DATA_DIR once at module load.
 */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "overwatch-accounts-"));
process.env.TJ_DATA_DIR = TMP;

const {
  USER_COOKIE,
  USER_MAX_AGE_SECONDS,
  isAccountPath,
  signUserSession,
  userAuthState,
  verifyUserSession,
} = await import("../src/lib/auth.ts");

const { authenticate, createUser, emailTaken, hashPassword, usernameTaken, verifyPassword, countUsers, userDir } =
  await import("../src/lib/users.ts");

const { validateLogin, validateSignup } = await import("../src/lib/account-validate.ts");

const db = await import("../src/lib/db.ts");

let checks = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  checks++;
  console.log(`  ok  ${name}`);
};

/* --------------------------------- hashing ---------------------------------- */

await ok("a password verifies against its own hash and nothing else", () => {
  const hash = hashPassword("a long enough password");
  assert.equal(verifyPassword("a long enough password", hash), true);
  for (const wrong of ["", "a long enough passwor", "A long enough password", "a long enough password "]) {
    assert.equal(verifyPassword(wrong, hash), false, `accepted ${JSON.stringify(wrong)}`);
  }
});

await ok("the same password hashes differently every time", () => {
  // A per-password salt is what stops one rainbow table covering every account at once.
  assert.notEqual(hashPassword("same password here"), hashPassword("same password here"));
});

await ok("a corrupt stored hash fails closed rather than throwing", () => {
  for (const bad of ["", "not-a-hash", "scrypt$$$$", "bcrypt$1$2$3$4$5", "scrypt$32768$8$1$@@@$@@@"]) {
    assert.equal(verifyPassword("anything", bad), false, `threw or accepted on ${JSON.stringify(bad)}`);
  }
});

await ok("the stored hash contains neither the password nor anything reversible to it", () => {
  const hash = hashPassword("hunter2-but-longer");
  assert.ok(!hash.includes("hunter2"), "the password appears in its own hash");
  assert.ok(hash.startsWith("scrypt$"), "the parameters must travel with the hash so they can be raised later");
});

/* -------------------------------- validation -------------------------------- */

await ok("signup rejects what it should and accepts what it should", () => {
  assert.equal(validateSignup({ username: "sasha", email: "a@b.co", password: "0123456789", confirm: "0123456789" }), null);

  assert.equal(validateSignup({ username: "", email: "a@b.co", password: "0123456789", confirm: "0123456789" })?.field, "username");
  assert.equal(validateSignup({ username: "s", email: "a@b.co", password: "0123456789", confirm: "0123456789" })?.field, "username");
  assert.equal(validateSignup({ username: "sasha", email: "nope", password: "0123456789", confirm: "0123456789" })?.field, "email");
  assert.equal(validateSignup({ username: "sasha", email: "a@b.co", password: "short", confirm: "short" })?.field, "password");
  assert.equal(validateSignup({ username: "sasha", email: "a@b.co", password: "0123456789", confirm: "different!!" })?.field, "confirm");
  // An unbounded password is a way to make the server do unbounded scrypt work per request.
  assert.equal(validateSignup({ username: "sasha", email: "a@b.co", password: "x".repeat(5000), confirm: "x".repeat(5000) })?.field, "password");
});

await ok("login requires both fields", () => {
  assert.equal(validateLogin({ identifier: "a@b.co", password: "x" }), null);
  assert.equal(validateLogin({ identifier: "", password: "x" })?.field, "identifier");
  assert.equal(validateLogin({ identifier: "a@b.co", password: "" })?.field, "password");
});

/* ------------------------------- user records ------------------------------- */

const alice = createUser({ username: "Alice", email: "Alice@Example.COM", password: "alice-password-1" });
const bob = createUser({ username: "Bob", email: "bob@example.com", password: "bob-password-1" });

await ok("an account is created and can sign in with either identifier", () => {
  assert.equal(authenticate("alice@example.com", "alice-password-1")?.id, alice.id);
  assert.equal(authenticate("Alice", "alice-password-1")?.id, alice.id);
  // Email is stored normalised, so the case someone typed at signup does not become a password.
  assert.equal(alice.email, "alice@example.com");
});

await ok("the wrong password does not sign anyone in", () => {
  assert.equal(authenticate("alice@example.com", "bob-password-1"), null);
  assert.equal(authenticate("alice@example.com", ""), null);
  assert.equal(authenticate("nobody@example.com", "alice-password-1"), null);
});

await ok("email and display name are unique, case-insensitively", () => {
  assert.equal(emailTaken("ALICE@example.com"), true);
  assert.equal(usernameTaken("alice"), true);
  assert.equal(emailTaken("carol@example.com"), false);
  assert.throws(() => createUser({ username: "carol", email: "alice@example.com", password: "x".repeat(12) }));
});

await ok("a user record never carries the password hash off the module", () => {
  assert.equal("password_hash" in (alice as Record<string, unknown>), false);
  assert.equal(countUsers(), 2);
});

/* -------------------------------- sessions ---------------------------------- */

const SECRET = "a-signing-key-for-tests";

await ok("a session names its user and verifies only against its own key", async () => {
  const token = await signUserSession(SECRET, alice.id, Date.now() + 60_000);
  assert.equal(await verifyUserSession(SECRET, token), alice.id);
  assert.equal(await verifyUserSession("a-different-key", token), null);
});

await ok("a session cannot be edited to name someone else", async () => {
  const token = await signUserSession(SECRET, alice.id, Date.now() + 60_000);
  // The signature covers the id, so swapping it invalidates the whole token rather than
  // producing a valid session for Bob.
  const forged = token.replace(alice.id, bob.id);
  assert.notEqual(forged, token);
  assert.equal(await verifyUserSession(SECRET, forged), null);
});

await ok("a session cannot have its expiry extended", async () => {
  const expired = await signUserSession(SECRET, alice.id, Date.now() - 1);
  assert.equal(await verifyUserSession(SECRET, expired), null);
  const extended = expired.replace(/\.\d+\./, `.${Date.now() + 86_400_000}.`);
  assert.equal(await verifyUserSession(SECRET, extended), null);
});

await ok("junk is refused rather than throwing", async () => {
  for (const bad of ["", "a", "a.b", "....", "usr_x.notanumber.sig", `${alice.id}.${Date.now() + 1000}.wrong`]) {
    assert.equal(await verifyUserSession(SECRET, bad), null, `accepted ${JSON.stringify(bad)}`);
  }
  assert.equal(await verifyUserSession(SECRET, undefined), null);
  assert.equal(await verifyUserSession("", "anything"), null);
});

await ok("no signing key fails closed in production and stays open in development", () => {
  assert.equal(userAuthState(undefined, true).mode, "misconfigured");
  assert.equal(userAuthState("", true).mode, "misconfigured");
  assert.equal(userAuthState(undefined, false).mode, "open");
  assert.equal(userAuthState("key", true).mode, "enforced");
});

await ok("the account cookie is its own thing, and long-lived enough to be usable", () => {
  assert.notEqual(USER_COOKIE, "overwatch_session");
  assert.ok(USER_MAX_AGE_SECONDS >= 7 * 24 * 3600);
});

await ok("only the sign-in screen and its endpoints are reachable without an account", () => {
  for (const p of ["/account", "/api/account/login", "/api/account/signup", "/api/account/logout", "/api/account/me"]) {
    assert.equal(isAccountPath(p), true, `${p} must stay reachable`);
  }
  for (const p of ["/", "/journal", "/api/trades", "/api/portfolio", "/api/accounts", "/settings", "/api/account"]) {
    assert.equal(isAccountPath(p), false, `${p} must require an account`);
  }
});

/* -------------------------------- isolation --------------------------------- */

await ok("each user gets their own journal file, and a bad id cannot escape the users directory", () => {
  assert.notEqual(userDir(alice.id), userDir(bob.id));
  for (const bad of ["../escape", "usr_../../etc", "", "usr_short", "usr_" + "z".repeat(24)]) {
    assert.throws(() => userDir(bad), `accepted ${JSON.stringify(bad)}`);
  }
});

await ok("a trade written by one user is invisible to the other", () => {
  const account = db.createAccount(alice.id, {
    name: "Alice main",
    type: "personal",
    startingBalance: 1000,
    currency: "USD",
    defaultRiskPct: 1,
    archived: 0,
  } as Parameters<typeof db.createAccount>[1]);

  db.insertTrade(alice.id, {
    id: "trd_alice_secret",
    accountId: account.id,
    date: "2026-01-02",
    instrument: "ES",
    direction: "long",
    result: "win",
    pnl: 500,
    tags: [],
  } as Parameters<typeof db.insertTrade>[1]);

  assert.equal(db.listTrades(alice.id, null).length, 1);
  // The claim, stated plainly: Bob's session cannot see it.
  assert.equal(db.listTrades(bob.id, null).length, 0);
  assert.equal(db.listAccounts(bob.id).length, 0);
});

await ok("guessing another user's trade id returns nothing rather than the trade", () => {
  // This is the attack the requirement names: change an id in a request and see whose row comes
  // back. It cannot work here, because the row is in a file this session never opens.
  assert.notEqual(db.getTrade(alice.id, "trd_alice_secret"), null);
  assert.equal(db.getTrade(bob.id, "trd_alice_secret"), null);
});

await ok("one user's writes cannot reach through to another's records", () => {
  // Deleting by a known-good id belonging to someone else.
  db.deleteTrade(bob.id, "trd_alice_secret");
  assert.notEqual(db.getTrade(alice.id, "trd_alice_secret"), null, "Bob's delete removed Alice's trade");

  // And updating it — the same id, a full valid payload, posted from the wrong session.
  const overwrite = {
    id: "trd_alice_secret",
    accountId: "acc_whatever",
    date: "2026-01-02",
    instrument: "ES",
    direction: "long",
    result: "loss",
    pnl: -9999,
    tags: [],
  } as Parameters<typeof db.updateTrade>[2];

  assert.equal(db.updateTrade(bob.id, "trd_alice_secret", overwrite), null, "Bob's update found a row it should not see");
  assert.equal(db.getTrade(alice.id, "trd_alice_secret")?.pnl, 500, "Bob's update changed Alice's trade");
});

await ok("settings and uploads are separated too, not just trades", () => {
  db.saveSettings(alice.id, { ...db.getSettings(alice.id), defaultAccountId: "acc_alice" });
  assert.notEqual(db.getSettings(alice.id).defaultAccountId, db.getSettings(bob.id).defaultAccountId);
  assert.notEqual(db.uploadDir(alice.id), db.uploadDir(bob.id));
  assert.ok(db.uploadDir(alice.id).includes(alice.id));
});

await ok("the journals really are separate files on disk", () => {
  assert.ok(fs.existsSync(path.join(userDir(alice.id), "journal.db")));
  assert.ok(fs.existsSync(path.join(userDir(bob.id), "journal.db")));
  assert.notEqual(path.join(userDir(alice.id), "journal.db"), path.join(userDir(bob.id), "journal.db"));
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${checks} account checks passed`);
