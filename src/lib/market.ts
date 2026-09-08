import fs from "node:fs";
import path from "node:path";
import { Db, openDatabase } from "./driver";
import { Candle, DERIVED, SUB_MINUTE, SUB_MINUTE_BASE, Timeframe, TIMEFRAMES, aggregate } from "./aggregate";

/**
 * Market data lives in its own SQLite file. Years of 1-minute bars would otherwise dwarf the
 * journal database, making backups slow and putting trade records next to a table that gets
 * bulk-rewritten on every import.
 */
const DATA_DIR = process.env.TJ_DATA_DIR ?? path.join(process.cwd(), "data");

let _market: Db | null = null;

export function market(): Db {
  if (_market) return _market;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const conn = openDatabase(path.join(DATA_DIR, "market.db"));
  conn.pragma("journal_mode = WAL");
  conn.pragma("synchronous = NORMAL");
  conn.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      symbol    TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      ts        INTEGER NOT NULL,
      open      REAL NOT NULL,
      high      REAL NOT NULL,
      low       REAL NOT NULL,
      close     REAL NOT NULL,
      volume    REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (symbol, timeframe, ts)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS drawings (
      symbol     TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS imports (
      id         TEXT PRIMARY KEY,
      symbol     TEXT NOT NULL,
      source     TEXT NOT NULL,
      dataset    TEXT,
      start_date TEXT,
      end_date   TEXT,
      bars       INTEGER NOT NULL DEFAULT 0,
      status     TEXT NOT NULL,
      message    TEXT,
      created_at TEXT NOT NULL
    );
  `);
  _market = conn;
  return conn;
}

export function insertCandles(symbol: string, timeframe: Timeframe, bars: Candle[]): number {
  if (!bars.length) return 0;
  const stmt = market().prepare(
    `INSERT INTO candles (symbol,timeframe,ts,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(symbol,timeframe,ts) DO UPDATE SET open=excluded.open, high=excluded.high,
       low=excluded.low, close=excluded.close, volume=excluded.volume`
  );
  const tx = market().transaction((list: Candle[]) => {
    for (const b of list) stmt.run(symbol, timeframe, b.ts, b.open, b.high, b.low, b.close, b.volume);
  });
  // Chunked so a single huge import does not hold one enormous transaction open.
  const CHUNK = 20000;
  for (let i = 0; i < bars.length; i += CHUNK) tx(bars.slice(i, i + CHUNK));
  return bars.length;
}

export function getCandles(symbol: string, timeframe: Timeframe, from?: number, to?: number, limit = 5000): Candle[] {
  const clauses = ["symbol = ?", "timeframe = ?"];
  const params: unknown[] = [symbol, timeframe];
  if (from !== undefined) {
    clauses.push("ts >= ?");
    params.push(from);
  }
  if (to !== undefined) {
    clauses.push("ts <= ?");
    params.push(to);
  }
  // Take the most recent `limit` bars in range, then return them oldest-first for charting.
  const rows = market()
    .prepare(
      `SELECT ts,open,high,low,close,volume FROM candles WHERE ${clauses.join(" AND ")} ORDER BY ts DESC LIMIT ?`
    )
    .all(...params, limit) as Candle[];
  return rows.reverse();
}

export interface Coverage {
  symbol: string;
  timeframe: Timeframe;
  bars: number;
  first: number | null;
  last: number | null;
}

/**
 * The first and last UTC day held for one symbol and timeframe, or nulls if none.
 *
 * This is all the import guard needs. An earlier version listed every distinct stored day, which
 * meant a DISTINCT over 1.76 million rows — just under a second each time, on a request the
 * importer makes once per window. MIN and MAX ride the primary key instead and are effectively
 * free, and they answer the same question: anything inside the imported span was covered, so an
 * empty day there is a closed market rather than data still owed.
 */
export function storedRange(symbol: string, timeframe: Timeframe): { first: string | null; last: string | null } {
  // Asked as two queries on purpose. SQLite only rewrites a *single* MIN or MAX into an index
  // seek; put both in one statement and it falls back to scanning the group — 207 ms against this
  // table, versus 0.01 ms when they are asked separately.
  const edge = (fn: "MIN" | "MAX") =>
    (
      market()
        .prepare(`SELECT ${fn}(ts) AS ts FROM candles WHERE symbol = ? AND timeframe = ?`)
        .get(symbol, timeframe) as { ts: number | null } | undefined
    )?.ts ?? null;

  const first = edge("MIN");
  const last = edge("MAX");
  const day = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString().slice(0, 10));
  return { first: day(first), last: day(last) };
}

export function coverage(symbol?: string): Coverage[] {
  const sql = `SELECT symbol, timeframe, COUNT(*) AS bars, MIN(ts) AS first, MAX(ts) AS last
               FROM candles ${symbol ? "WHERE symbol = ?" : ""} GROUP BY symbol, timeframe`;
  const rows = (symbol ? market().prepare(sql).all(symbol) : market().prepare(sql).all()) as Coverage[];
  const order = new Map(TIMEFRAMES.map((t, i) => [t, i]));
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || (order.get(a.timeframe) ?? 0) - (order.get(b.timeframe) ?? 0));
}

export function listSymbols(): string[] {
  return (market().prepare("SELECT DISTINCT symbol FROM candles ORDER BY symbol").all() as { symbol: string }[]).map((r) => r.symbol);
}

export function deleteSymbol(symbol: string) {
  market().prepare("DELETE FROM candles WHERE symbol = ?").run(symbol);
}

/** Rebuild every derived timeframe for a symbol from its stored 1m bars. */
export function rebuildDerived(symbol: string): Record<string, number> {
  const base = market()
    .prepare("SELECT ts,open,high,low,close,volume FROM candles WHERE symbol=? AND timeframe='1m' ORDER BY ts")
    .all(symbol) as Candle[];
  const counts: Record<string, number> = { "1m": base.length };
  if (!base.length) return counts;
  for (const tf of DERIVED) {
    const rolled = aggregate(base, tf);
    market().prepare("DELETE FROM candles WHERE symbol=? AND timeframe=?").run(symbol, tf);
    insertCandles(symbol, tf, rolled);
    counts[tf] = rolled.length;
  }
  return counts;
}

/**
 * Build 30-second bars from stored 1-second bars. Sub-minute timeframes cannot come from the
 * 1-minute base, so this is a separate pass that only runs when 1s data exists.
 */
export function rebuildSubMinute(symbol: string): Record<string, number> {
  const base = market()
    .prepare("SELECT ts,open,high,low,close,volume FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts")
    .all(symbol, SUB_MINUTE_BASE) as Candle[];
  const counts: Record<string, number> = { [SUB_MINUTE_BASE]: base.length };
  if (!base.length) return counts;
  for (const tf of SUB_MINUTE) {
    const rolled = aggregate(base, tf, SUB_MINUTE_BASE);
    market().prepare("DELETE FROM candles WHERE symbol=? AND timeframe=?").run(symbol, tf);
    insertCandles(symbol, tf, rolled);
    counts[tf] = rolled.length;
  }
  return counts;
}

/*
 * Drawings used to live here, next to the candles. They moved to the per-user journal when
 * accounts arrived: candles are shared and objective, a drawing is one person's. See src/lib/db.ts.
 */

export function recordImport(row: {
  id: string;
  symbol: string;
  source: string;
  dataset?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  bars: number;
  status: string;
  message?: string | null;
}) {
  market()
    .prepare(
      `INSERT INTO imports (id,symbol,source,dataset,start_date,end_date,bars,status,message,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(row.id, row.symbol, row.source, row.dataset ?? null, row.startDate ?? null, row.endDate ?? null, row.bars, row.status, row.message ?? null, new Date().toISOString());
}

export function listImports(limit = 20) {
  return market().prepare("SELECT * FROM imports ORDER BY created_at DESC LIMIT ?").all(limit);
}
