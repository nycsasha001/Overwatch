/**
 * Thin SQLite driver abstraction.
 *
 * Primary driver is better-sqlite3 (fast, battle-tested, ships prebuilt binaries).
 * If it is unavailable — for example the native build was skipped because no prebuilt
 * binary matched the machine — we fall back to Node's built-in `node:sqlite`, which
 * requires no compilation. Both expose the same subset of API used by src/lib/db.ts.
 */

import fs from "node:fs";
/**
 * better-sqlite3 is an *optional* dependency: a machine where the native build did not succeed
 * must still boot, falling back to node:sqlite. That means the bundler must not try to resolve it
 * at build time, and the lookup has to happen at runtime instead.
 *
 * `eval("require")` is the one form the bundler leaves alone while still resolving against the
 * project's node_modules. `createRequire` from node:module is not available inside the server
 * bundle — it evaluates to undefined, which silently sent every machine down the fallback path.
 * The specifier is assembled at runtime for the same reason: a literal string would be traced.
 */
const runtimeRequire: NodeRequire | null = (() => {
  try {
    return eval("require") as NodeRequire;
  } catch {
    return null;
  }
})();
const BETTER_SQLITE3 = ["better", "sqlite3"].join("-");

export interface Statement {
  run: (...params: unknown[]) => { changes: number | bigint };
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

export interface Db {
  exec: (sql: string) => void;
  pragma: (statement: string) => void;
  prepare: (sql: string) => Statement;
  transaction: <A>(fn: (arg: A) => void) => (arg: A) => void;
  driver: "better-sqlite3" | "node:sqlite";
}

/**
 * A crashed process, or a database file living on a synced/virtual filesystem, can leave a
 * stale -shm alongside an empty -wal. SQLite then fails every open with SQLITE_IOERR_SHORT_READ
 * even though the database itself is intact. Removing the sidecars is safe *only* when the WAL
 * holds no data — an empty or missing -wal means nothing is waiting to be checkpointed.
 */
function clearStaleSidecars(file: string): boolean {
  try {
    const wal = `${file}-wal`;
    const shm = `${file}-shm`;
    const walSize = fs.existsSync(wal) ? fs.statSync(wal).size : 0;
    if (walSize > 0) return false; // real data pending — never discard it
    let removed = false;
    for (const f of [shm, wal]) {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        removed = true;
      }
    }
    return removed;
  } catch {
    return false;
  }
}

const isIoError = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? "";
  return code.startsWith("SQLITE_IOERR") || code === "SQLITE_CORRUPT" || /disk I\/O error/i.test((e as Error)?.message ?? "");
};

export function openDatabase(file: string): Db {
  const forced = process.env.TJ_DRIVER;

  if (forced !== "node") {
    if (!runtimeRequire) throw new Error("no runtime require available");
    const open = () => new (runtimeRequire(BETTER_SQLITE3))(file);
    try {
      let conn;
      try {
        conn = open();
        conn.pragma("journal_mode = WAL");
      } catch (e) {
        if (!isIoError(e) || !clearStaleSidecars(file)) throw e;
        console.warn("[overwatch] cleared a stale -shm/-wal pair after an I/O error and reopened the database");
        conn = open();
        conn.pragma("journal_mode = WAL");
      }
      const db = conn;
      console.info("[overwatch] database driver: better-sqlite3");
      return {
        exec: (sql) => db.exec(sql),
        pragma: (p) => db.pragma(p),
        prepare: (sql) => db.prepare(sql) as Statement,
        transaction: (fn) => db.transaction(fn),
        driver: "better-sqlite3",
      };
    } catch (e) {
      if (forced === "better-sqlite3") throw e;
      console.warn("[overwatch] better-sqlite3 unavailable, falling back to node:sqlite —", (e as Error).message);
    }
  }

  const { DatabaseSync } = (runtimeRequire ?? require)("node:sqlite") as typeof import("node:sqlite");
  const conn = new DatabaseSync(file);
  return {
    exec: (sql) => conn.exec(sql),
    pragma: (p) => conn.exec(`PRAGMA ${p}`),
    prepare: (sql) => {
      const st = conn.prepare(sql);
      return {
        run: (...params: unknown[]) => st.run(...(params as never[])) as { changes: number | bigint },
        get: (...params: unknown[]) => st.get(...(params as never[])),
        all: (...params: unknown[]) => st.all(...(params as never[])) as unknown[],
      };
    },
    transaction:
      <A,>(fn: (arg: A) => void) =>
      (arg: A) => {
        conn.exec("BEGIN");
        try {
          fn(arg);
          conn.exec("COMMIT");
        } catch (e) {
          conn.exec("ROLLBACK");
          throw e;
        }
      },
    driver: "node:sqlite",
  };
}
