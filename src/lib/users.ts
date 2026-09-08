/**
 * The account store: who exists, and what their password is.
 *
 * This is the *second* gate. `APP_PASSWORD` (src/lib/auth.ts) decides whether a browser may reach
 * the app at all; this decides which person is using it once inside. The two are deliberately
 * independent — knowing the shared password gets you to a sign-in screen and no further.
 *
 * Three decisions worth stating, because each is load-bearing:
 *
 *  1. **Accounts live in their own database.** `/data/auth.db`, not journal.db and emphatically not
 *     market.db. Credentials and trading records have different lifetimes, different backup needs
 *     and different blast radii; a bug in a journal migration must not be able to touch a password
 *     hash, and exporting a journal must not be able to leak one.
 *
 *  2. **Each user's journal is a separate SQLite file**, at `/data/users/<id>/journal.db`. Isolation
 *     is therefore physical rather than a `WHERE user_id = ?` that someone forgets to write. A
 *     request for another user's trade id does not return "forbidden" — the row does not exist in
 *     the database that request opened. See src/lib/db.ts.
 *
 *  3. **scrypt, from node:crypto.** No new dependency: bcrypt and argon2 are native modules, and
 *     this image already tiptoes around better-sqlite3's optional native build. scrypt is a memory
 *     hard KDF in the standard library, which is the right trade here.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openDatabase, type Db } from "./driver";

export const DATA_DIR = process.env.TJ_DATA_DIR ?? path.join(process.cwd(), "data");

/** Where each user's own journal and uploads live. */
export const USERS_DIR = path.join(DATA_DIR, "users");

/**
 * The journal a request may open.
 *
 * `null` is the legacy single-user journal at the root of the data directory — the one that existed
 * before accounts did. Reachable only in development with no `AUTH_SECRET`, which keeps a local
 * checkout working as it always has. Production refuses to serve without a signing key, so a null
 * scope cannot arise there.
 */
export type Scope = string | null;

export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserRow extends User {
  password_hash: string;
}

let _auth: Db | null = null;

function auth(): Db {
  if (_auth) return _auth;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const conn = openDatabase(path.join(DATA_DIR, "auth.db"));
  conn.pragma("foreign_keys = ON");
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    /*
     * Uniqueness is enforced here rather than only in the signup handler. Two requests can pass the
     * same "is this email taken?" check concurrently and both proceed; the index is what actually
     * makes the second one fail. Both columns are stored already-normalised (see normaliseEmail),
     * so a plain unique index is enough — no COLLATE NOCASE, which only folds ASCII anyway.
     */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

    /* Key/value for things about the install itself, not about any one user. */
    CREATE TABLE IF NOT EXISTS auth_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  _auth = conn;
  return conn;
}

export function authMeta(key: string): string | null {
  const row = auth().prepare(`SELECT value FROM auth_meta WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAuthMeta(key: string, value: string) {
  auth()
    .prepare(`INSERT INTO auth_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, value);
}

/* --------------------------------- hashing ---------------------------------- */

/**
 * scrypt parameters. N=2^15 costs roughly 100ms and 32MB per hash on a small Railway instance,
 * which is slow enough to make a stolen database expensive to attack and fast enough that signing
 * in does not feel broken. Stored alongside every hash so these can be raised later without
 * invalidating existing passwords — verification reads the parameters from the stored string.
 */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 } as const;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password.normalize("NFKC"), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    // Node's default maxmem (32MB) is *below* what N=32768 needs, and the failure is a throw at
    // signup rather than a weak hash. Give it room proportional to the parameters.
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * Verify without leaking, through timing, how much of the hash matched.
 *
 * Returns false rather than throwing on a malformed stored value: a corrupt row must fail closed,
 * not 500 in a way that tells an attacker the row exists.
 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(keyB64, "base64");

    /*
     * Refuse a hash that decoded to nothing.
     *
     * Buffer.from() does not throw on invalid base64, it returns whatever it could decode — so a
     * corrupt stored value can yield an empty buffer. scrypt would then be asked for a zero-length
     * key, and timingSafeEqual(empty, empty) is true: that row would accept *every* password.
     * Checking the lengths against what this function actually writes closes it.
     */
    if (salt.length < 16 || expected.length < 32) return false;

    const actual = crypto.scryptSync(password.normalize("NFKC"), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------- normalising -------------------------------- */

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normaliseUsername(username: string): string {
  return username.trim();
}

/** Lowercased for the uniqueness index, so "Sasha" and "sasha" cannot both exist. */
function usernameKey(username: string): string {
  return normaliseUsername(username).toLowerCase();
}

/* --------------------------------- queries ---------------------------------- */

function toUser(row: UserRow | undefined): User | null {
  if (!row) return null;
  const { password_hash: _ignored, ...user } = row;
  return { ...user, createdAt: row.createdAt, lastLoginAt: row.lastLoginAt };
}

const SELECT = `SELECT id, username, email, password_hash, created_at AS createdAt, last_login_at AS lastLoginAt FROM users`;

export function countUsers(): number {
  const row = auth().prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
  return row.n;
}

export function findUserById(id: string): User | null {
  return toUser(auth().prepare(`${SELECT} WHERE id = ?`).get(id) as UserRow | undefined);
}

/** Sign-in accepts either identifier, so one lookup covers both columns. */
function findRowByIdentifier(identifier: string): UserRow | undefined {
  const value = identifier.trim();
  return auth()
    .prepare(`${SELECT} WHERE email = ? OR LOWER(username) = ?`)
    .get(normaliseEmail(value), value.toLowerCase()) as UserRow | undefined;
}

export function emailTaken(email: string): boolean {
  return !!auth().prepare(`SELECT 1 FROM users WHERE email = ?`).get(normaliseEmail(email));
}

export function usernameTaken(username: string): boolean {
  return !!auth().prepare(`SELECT 1 FROM users WHERE LOWER(username) = ?`).get(usernameKey(username));
}

export function createUser(input: { username: string; email: string; password: string }): User {
  const id = `usr_${crypto.randomBytes(12).toString("hex")}`;
  const now = new Date().toISOString();
  const username = normaliseUsername(input.username);
  const email = normaliseEmail(input.email);

  auth()
    .prepare(`INSERT INTO users (id, username, email, password_hash, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, NULL)`)
    .run(id, username, email, hashPassword(input.password), now);

  return { id, username, email, createdAt: now, lastLoginAt: null };
}

/**
 * Check a sign-in attempt.
 *
 * When the identifier is unknown we still run a hash before returning, against a throwaway value.
 * Skipping it would make "no such user" measurably faster than "wrong password", which turns the
 * login form into a way to enumerate who has an account here.
 */
export function authenticate(identifier: string, password: string): User | null {
  const row = findRowByIdentifier(identifier);
  if (!row) {
    verifyPassword(password, hashPassword("decoy-so-the-timing-matches"));
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) return null;

  const now = new Date().toISOString();
  auth().prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(now, row.id);
  return { ...toUser(row)!, lastLoginAt: now };
}

/* ------------------------------ per-user storage ----------------------------- */

/**
 * The directory holding one user's journal and uploads.
 *
 * The id is generated by us and is hex, but this is the function every file path in the app is
 * built from, so it validates anyway. A traversal here would be a total compromise of the isolation
 * the whole design rests on, and the check costs nothing.
 */
export function userDir(userId: string): string {
  if (!/^usr_[0-9a-f]{24}$/.test(userId)) throw new Error("Invalid user id");
  const dir = path.join(USERS_DIR, userId);
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(USERS_DIR) + path.sep)) throw new Error("Invalid user id");
  return dir;
}
