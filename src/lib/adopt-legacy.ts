/**
 * Hand the pre-accounts journal to the first account created.
 *
 * Before this feature there was one journal at `<data>/journal.db` and one uploads folder beside
 * it. After it, every user has their own under `<data>/users/<id>/`. Something has to decide who
 * inherits the original, and the only answer that needs no configuration is: whoever signs up
 * first. On a personal deployment that is the owner, which is the intent.
 *
 * Three properties this has to have, because it runs exactly once against irreplaceable data:
 *
 *  - **It never deletes.** Files are moved, and if a move fails the original stays where it is.
 *  - **It runs once.** A marker in auth.db records the outcome, so a second signup cannot claim a
 *    journal that has already been adopted — including the case where the first user has since
 *    deleted things they did not want.
 *  - **It refuses to overwrite.** If the new owner's journal already exists and holds anything, the
 *    adoption is abandoned rather than merged. Two journals colliding is a data-loss bug; leaving
 *    the legacy file untouched is recoverable by hand.
 */

import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "./driver";
import { DATA_DIR, authMeta, setAuthMeta, userDir } from "./users";

const MARKER = "legacy_journal_adopted_by";

/** The sidecars SQLite keeps beside a database. Moving the file without these corrupts it. */
const SIDECARS = ["", "-wal", "-shm"];

function hasRows(file: string): boolean {
  try {
    const conn = openDatabase(file);
    for (const table of ["accounts", "trades", "holdings", "portfolio_transactions"]) {
      try {
        const row = conn.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined;
        if ((row?.n ?? 0) > 0) return true;
      } catch {
        // Table absent in an older file: not an error, just nothing to count.
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Returns what happened, for the signup handler to log. Never throws: a failure to adopt must not
 * stop an account being created, because the alternative is an install nobody can sign in to.
 */
export function adoptLegacyJournal(userId: string): "adopted" | "nothing-to-adopt" | "already-done" | "skipped" {
  try {
    if (authMeta(MARKER)) return "already-done";

    const legacy = path.join(DATA_DIR, "journal.db");
    if (!fs.existsSync(legacy) || !hasRows(legacy)) {
      // An empty file is what a previous boot left behind. Claim the marker anyway so this does not
      // re-run on every future signup.
      setAuthMeta(MARKER, "none");
      return "nothing-to-adopt";
    }

    const dir = userDir(userId);
    const target = path.join(dir, "journal.db");
    if (fs.existsSync(target) && hasRows(target)) return "skipped";

    fs.mkdirSync(dir, { recursive: true });

    // The database and its sidecars, together and in that order.
    for (const suffix of SIDECARS) {
      const from = `${legacy}${suffix}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${target}${suffix}`);
    }

    // Uploads, one file at a time: the destination folder already exists (db() creates it), so a
    // directory rename would fail on a non-empty target.
    const legacyUploads = path.join(DATA_DIR, "uploads");
    const targetUploads = path.join(dir, "uploads");
    if (fs.existsSync(legacyUploads)) {
      fs.mkdirSync(targetUploads, { recursive: true });
      for (const name of fs.readdirSync(legacyUploads)) {
        const from = path.join(legacyUploads, name);
        const to = path.join(targetUploads, name);
        if (!fs.existsSync(to) && fs.statSync(from).isFile()) fs.renameSync(from, to);
      }
    }

    copyLegacyDrawings(target);

    setAuthMeta(MARKER, userId);
    return "adopted";
  } catch {
    return "skipped";
  }
}

/**
 * Chart drawings used to live in market.db. They belong to a person, not to the candles, so they
 * move with the journal — copied rather than moved, because market.db stays shared and a failed
 * write here must not lose the only copy.
 */
function copyLegacyDrawings(journalFile: string) {
  try {
    const marketFile = path.join(DATA_DIR, "market.db");
    if (!fs.existsSync(marketFile)) return;

    const market = openDatabase(marketFile);
    let rows: { symbol: string; data: string; updated_at: string }[] = [];
    try {
      rows = market.prepare("SELECT symbol, data, updated_at FROM drawings").all() as typeof rows;
    } catch {
      return; // no drawings table in this market.db
    }
    if (!rows.length) return;

    const journal = openDatabase(journalFile);
    journal.exec(
      `CREATE TABLE IF NOT EXISTS drawings (symbol TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)`
    );
    const insert = journal.prepare(
      `INSERT INTO drawings (symbol, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO NOTHING`
    );
    for (const row of rows) insert.run(row.symbol, row.data, row.updated_at);
  } catch {
    // Drawings are an ornament on top of the journal; never fail an adoption over them.
  }
}
