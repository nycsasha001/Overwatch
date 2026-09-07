import { Db, openDatabase } from "./driver";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS } from "./types";
import { costFromTransactions, investedFromTransactions } from "./portfolio";
import { lookup } from "./symbols";
import { parseSessionState, serialiseSessionState, type ReplaySession, type ReplaySessionState } from "./replay-session";
import type { AcquisitionType, Account, Backtest, PortfolioHolding, PortfolioSnapshotRow, PortfolioTransaction, Screenshot, Settings, Setup, Strategy, Trade, TradeInput, WatchlistItem } from "./types";

const DATA_DIR = process.env.TJ_DATA_DIR ?? path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

let _db: Db | null = null;

export function db(): Db {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const conn = openDatabase(path.join(DATA_DIR, "journal.db"));
  conn.pragma("foreign_keys = ON");
  migrate(conn);
  // Only cache once the connection is proven usable; a failed open must not poison later requests.
  _db = conn;
  return conn;
}

/** SQLite has no ADD COLUMN IF NOT EXISTS, so check the table first. */
function addColumn(conn: Db, table: string, column: string, definition: string) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrate(conn: Db) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'personal',
      starting_balance REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      default_risk_pct REAL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      time TEXT,
      instrument TEXT NOT NULL,
      direction TEXT NOT NULL,
      session TEXT,
      strategy TEXT,
      setup TEXT,
      entry REAL, stop REAL, target REAL, exit REAL,
      size REAL,
      risk_amount REAL, risk_pct REAL,
      result TEXT NOT NULL,
      pnl REAL NOT NULL DEFAULT 0,
      r_multiple REAL,
      mae REAL, mfe REAL,
      fees REAL,
      htf_sweep INTEGER NOT NULL DEFAULT 0,
      sweep_4h INTEGER NOT NULL DEFAULT 0,
      sweep_1h INTEGER NOT NULL DEFAULT 0,
      sweep_15m INTEGER NOT NULL DEFAULT 0,
      session_sweep INTEGER NOT NULL DEFAULT 0,
      mss INTEGER NOT NULL DEFAULT 0,
      fvg INTEGER NOT NULL DEFAULT 0,
      order_block INTEGER NOT NULL DEFAULT 0,
      displacement INTEGER NOT NULL DEFAULT 0,
      pd_array TEXT,
      entry_model TEXT,
      liquidity_target TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      thesis TEXT, execution TEXT, review TEXT, mistakes TEXT, emotions TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trades_account_date ON trades(account_id, date);

    CREATE TABLE IF NOT EXISTS screenshots (
      id TEXT PRIMARY KEY,
      trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      phase TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      caption TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shots_trade ON screenshots(trade_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      archived INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS setups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );

    /* ------------------------------- portfolio -------------------------------- */

    CREATE TABLE IF NOT EXISTS holdings (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT,
      shares REAL NOT NULL,
      avg_cost REAL NOT NULL,
      asset_type TEXT NOT NULL DEFAULT 'stock',
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_holdings_symbol ON holdings(symbol);

    CREATE TABLE IF NOT EXISTS portfolio_transactions (
      id TEXT PRIMARY KEY,
      holding_id TEXT REFERENCES holdings(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      shares REAL NOT NULL,
      price REAL NOT NULL,
      fees REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ptx_symbol_date ON portfolio_transactions(symbol, date);

    /* One row per recorded portfolio value. Written at most every fifteen minutes, and only when
       the value actually moved — see shouldSnapshot in lib/portfolio.ts. This is the entire
       source of the performance chart: no snapshot, no line. Nothing is back-filled. */
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      ts INTEGER PRIMARY KEY,
      total REAL NOT NULL,
      cash REAL NOT NULL,
      invested REAL NOT NULL
    );

    /* Symbols you are tracking but do not own. Deliberately a separate table from holdings:
       a watched symbol has no shares and no cost, and squeezing it into holdings would mean
       every total on the page needing to remember to exclude it. */
    CREATE TABLE IF NOT EXISTS watchlist (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist(symbol);


    /* Last known price per symbol, so a restart or an API outage still has something to show. */
    CREATE TABLE IF NOT EXISTS price_cache (
      symbol TEXT PRIMARY KEY,
      price REAL NOT NULL,
      previous_close REAL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backtests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      strategy TEXT,
      instrument TEXT,
      start_date TEXT,
      end_date TEXT,
      params TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      result TEXT,
      engine_note TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Added after the first release — existing databases pick these up in place.
  addColumn(conn, "accounts", "profit_target", "REAL");
  addColumn(conn, "accounts", "max_drawdown", "REAL");
  addColumn(conn, "accounts", "drawdown_type", "TEXT NOT NULL DEFAULT 'static'");
  addColumn(conn, "accounts", "daily_loss_limit", "REAL");
  // The reward-to-risk the trade was *planned* at, as distinct from r_multiple, which is what it
  // actually returned. Both are needed: win rate is only meaningful next to the RR it was earned
  // at, and comparing planned against realised is what shows whether targets are being reached.
  addColumn(conn, "trades", "planned_rr", "REAL");
  // Physical gold, a savings account, a house: things with a value but no ticker. The price is
  // whatever you last set, and the timestamp is kept beside it so the page can say how stale that
  // is rather than presenting a figure from six months ago as though it were live.
  addColumn(conn, "holdings", "manual_price", "REAL");
  addColumn(conn, "holdings", "manual_price_at", "TEXT");
  // Gifts. The basis of a gift is real — it is the value on the day you received it, and every
  // gain is measured from it — but no cash left your account for it. One number cannot say both,
  // so the cash is tracked separately and defaults, for every row that predates this, to the whole
  // basis: that is what those rows have always meant.
  addColumn(conn, "portfolio_transactions", "acquisition", "TEXT NOT NULL DEFAULT 'purchase'");
  addColumn(conn, "portfolio_transactions", "cash_paid", "REAL");
  // Cached onto the holding from its lots, exactly as shares and avg_cost already are. Null means
  // a holding with no transaction history, which is read as "all of the basis was paid".
  addColumn(conn, "holdings", "amount_invested", "REAL");
  addColumn(conn, "holdings", "acquisition", "TEXT");
  addColumn(conn, "holdings", "acquired_at", "TEXT");
  // The per-class split of each recorded value, as JSON. Without it a chart can only ever show the
  // whole portfolio: nothing in a row of (total, cash, invested) says how much of it was gold.
  addColumn(conn, "portfolio_snapshots", "breakdown", "TEXT");

  /* Saved replay sessions: where you were, and the work you did getting there.
     `auto` marks the single rolling slot per symbol that saves itself while you replay; named
     saves are deliberate and never overwritten by it, which is why the unique index is partial. */
  conn.exec(`
    CREATE TABLE IF NOT EXISTS replay_sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      tf TEXT NOT NULL,
      base_tf TEXT NOT NULL,
      cursor_ts INTEGER NOT NULL,
      auto INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_replay_auto ON replay_sessions(symbol) WHERE auto = 1;
    CREATE INDEX IF NOT EXISTS idx_replay_updated ON replay_sessions(updated_at DESC);
  `);
}

export function uid(prefix = "t"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const now = () => new Date().toISOString();

/* ---------------------------------- accounts --------------------------------- */

type AccountRow = {
  id: string; name: string; type: string; starting_balance: number; currency: string;
  default_risk_pct: number | null; archived: number; created_at: string;
  profit_target: number | null; max_drawdown: number | null; drawdown_type: string | null; daily_loss_limit: number | null;
};

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.name,
  type: r.type as Account["type"],
  startingBalance: r.starting_balance,
  currency: r.currency,
  defaultRiskPct: r.default_risk_pct,
  archived: r.archived ? 1 : 0,
  createdAt: r.created_at,
  profitTarget: r.profit_target ?? null,
  maxDrawdown: r.max_drawdown ?? null,
  drawdownType: (r.drawdown_type as Account["drawdownType"]) ?? "static",
  dailyLossLimit: r.daily_loss_limit ?? null,
});

export function listAccounts(): Account[] {
  return (db().prepare("SELECT * FROM accounts ORDER BY archived, created_at").all() as AccountRow[]).map(toAccount);
}

export function createAccount(a: Omit<Account, "id" | "createdAt">): Account {
  const id = uid("acc");
  db()
    .prepare(
      `INSERT INTO accounts (id,name,type,starting_balance,currency,default_risk_pct,archived,created_at,
                             profit_target,max_drawdown,drawdown_type,daily_loss_limit)
       VALUES (@id,@name,@type,@sb,@cur,@risk,@arch,@created,@target,@dd,@ddType,@daily)`
    )
    .run({
      id, name: a.name, type: a.type, sb: a.startingBalance, cur: a.currency, risk: a.defaultRiskPct,
      arch: a.archived ?? 0, created: now(),
      target: a.profitTarget ?? null, dd: a.maxDrawdown ?? null,
      ddType: a.drawdownType ?? "static", daily: a.dailyLossLimit ?? null,
    });
  const s = getSettings();
  if (!s.defaultAccountId) saveSettings({ ...s, defaultAccountId: id });
  return listAccounts().find((x) => x.id === id)!;
}

export function updateAccount(id: string, a: Partial<Account>): Account | null {
  const cur = listAccounts().find((x) => x.id === id);
  if (!cur) return null;
  const next = { ...cur, ...a };
  db()
    .prepare(
      `UPDATE accounts SET name=@name,type=@type,starting_balance=@sb,currency=@cur,default_risk_pct=@risk,
              archived=@arch,profit_target=@target,max_drawdown=@dd,drawdown_type=@ddType,daily_loss_limit=@daily WHERE id=@id`
    )
    .run({
      id, name: next.name, type: next.type, sb: next.startingBalance, cur: next.currency,
      risk: next.defaultRiskPct, arch: next.archived ?? 0,
      target: next.profitTarget ?? null, dd: next.maxDrawdown ?? null,
      ddType: next.drawdownType ?? "static", daily: next.dailyLossLimit ?? null,
    });
  return listAccounts().find((x) => x.id === id)!;
}

export function deleteAccount(id: string) {
  db().prepare("DELETE FROM accounts WHERE id=?").run(id);
  const s = getSettings();
  if (s.defaultAccountId === id) saveSettings({ ...s, defaultAccountId: listAccounts()[0]?.id ?? null });
}

/* ---------------------------------- settings --------------------------------- */

export function getSettings(): Settings {
  const row = db().prepare("SELECT value FROM settings WHERE key='app'").get() as { value: string } | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(row.value) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      classification: { ...DEFAULT_SETTINGS.classification, ...(parsed.classification ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): Settings {
  db()
    .prepare("INSERT INTO settings (key,value) VALUES ('app',@v) ON CONFLICT(key) DO UPDATE SET value=@v")
    .run({ v: JSON.stringify(s) });
  return s;
}

/* --------------------------------- strategies -------------------------------- */

export function listStrategies(): Strategy[] {
  return db().prepare("SELECT * FROM strategies ORDER BY archived, name").all() as Strategy[];
}
export function createStrategy(name: string, description: string | null): Strategy {
  const id = uid("str");
  db().prepare("INSERT INTO strategies (id,name,description,archived) VALUES (?,?,?,0)").run(id, name, description);
  return { id, name, description, archived: 0 };
}
export function updateStrategy(id: string, patch: Partial<Strategy>) {
  const cur = listStrategies().find((s) => s.id === id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  db().prepare("UPDATE strategies SET name=?,description=?,archived=? WHERE id=?").run(next.name, next.description, next.archived, id);
  return next;
}
export function deleteStrategy(id: string) {
  db().prepare("DELETE FROM strategies WHERE id=?").run(id);
}

export function listSetups(): Setup[] {
  return db().prepare("SELECT * FROM setups ORDER BY archived, name").all() as Setup[];
}
export function createSetup(name: string): Setup {
  const id = uid("set");
  db().prepare("INSERT INTO setups (id,name,archived) VALUES (?,?,0)").run(id, name);
  return { id, name, archived: 0 };
}
export function deleteSetup(id: string) {
  db().prepare("DELETE FROM setups WHERE id=?").run(id);
}

/* ----------------------------------- trades ---------------------------------- */

type TradeRow = Record<string, unknown>;

function toTrade(r: TradeRow): Trade {
  const n = (k: string) => (r[k] === null || r[k] === undefined ? null : Number(r[k]));
  const b = (k: string) => (Number(r[k]) ? 1 : 0) as 0 | 1;
  const s = (k: string) => (r[k] === null || r[k] === undefined ? null : String(r[k]));
  let tags: string[] = [];
  try {
    tags = JSON.parse(String(r.tags ?? "[]"));
  } catch {
    tags = [];
  }
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    date: String(r.date),
    time: s("time"),
    instrument: String(r.instrument),
    direction: String(r.direction) as Trade["direction"],
    session: s("session"),
    strategy: s("strategy"),
    setup: s("setup"),
    entry: n("entry"),
    stop: n("stop"),
    target: n("target"),
    exit: n("exit"),
    size: n("size"),
    riskAmount: n("risk_amount"),
    riskPct: n("risk_pct"),
    result: String(r.result) as Trade["result"],
    pnl: Number(r.pnl ?? 0),
    rMultiple: n("r_multiple"),
    plannedRr: n("planned_rr"),
    mae: n("mae"),
    mfe: n("mfe"),
    fees: n("fees"),
    htfSweep: b("htf_sweep"),
    sweep4h: b("sweep_4h"),
    sweep1h: b("sweep_1h"),
    sweep15m: b("sweep_15m"),
    sessionSweep: b("session_sweep"),
    mss: b("mss"),
    fvg: b("fvg"),
    orderBlock: b("order_block"),
    displacement: b("displacement"),
    pdArray: s("pd_array"),
    entryModel: s("entry_model"),
    liquidityTarget: s("liquidity_target"),
    tags,
    thesis: s("thesis"),
    execution: s("execution"),
    review: s("review"),
    mistakes: s("mistakes"),
    emotions: s("emotions"),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const TRADE_PARAMS = (t: TradeInput) => ({
  id: t.id,
  account_id: t.accountId,
  date: t.date,
  time: t.time ?? null,
  instrument: t.instrument,
  direction: t.direction,
  session: t.session ?? null,
  strategy: t.strategy ?? null,
  setup: t.setup ?? null,
  entry: t.entry ?? null,
  stop: t.stop ?? null,
  target: t.target ?? null,
  exit: t.exit ?? null,
  size: t.size ?? null,
  risk_amount: t.riskAmount ?? null,
  risk_pct: t.riskPct ?? null,
  result: t.result,
  pnl: t.pnl ?? 0,
  r_multiple: t.rMultiple ?? null,
  planned_rr: t.plannedRr ?? null,
  mae: t.mae ?? null,
  mfe: t.mfe ?? null,
  fees: t.fees ?? null,
  htf_sweep: t.htfSweep ?? 0,
  sweep_4h: t.sweep4h ?? 0,
  sweep_1h: t.sweep1h ?? 0,
  sweep_15m: t.sweep15m ?? 0,
  session_sweep: t.sessionSweep ?? 0,
  mss: t.mss ?? 0,
  fvg: t.fvg ?? 0,
  order_block: t.orderBlock ?? 0,
  displacement: t.displacement ?? 0,
  pd_array: t.pdArray ?? null,
  entry_model: t.entryModel ?? null,
  liquidity_target: t.liquidityTarget ?? null,
  tags: JSON.stringify(t.tags ?? []),
  thesis: t.thesis ?? null,
  execution: t.execution ?? null,
  review: t.review ?? null,
  mistakes: t.mistakes ?? null,
  emotions: t.emotions ?? null,
});

const COLS = [
  "id","account_id","date","time","instrument","direction","session","strategy","setup","entry","stop","target","exit",
  "size","risk_amount","risk_pct","result","pnl","r_multiple","planned_rr","mae","mfe","fees","htf_sweep","sweep_4h","sweep_1h",
  "sweep_15m","session_sweep","mss","fvg","order_block","displacement","pd_array","entry_model","liquidity_target",
  "tags","thesis","execution","review","mistakes","emotions",
];

export function insertTrade(t: TradeInput): Trade {
  const ts = now();
  const sql = `INSERT INTO trades (${COLS.join(",")},created_at,updated_at)
     VALUES (${COLS.map((c) => "@" + c).join(",")},@created_at,@updated_at)`;
  db().prepare(sql).run({ ...TRADE_PARAMS(t), created_at: ts, updated_at: ts });
  return getTrade(t.id)!;
}

export function updateTrade(id: string, t: TradeInput): Trade | null {
  const sql = `UPDATE trades SET ${COLS.filter((c) => c !== "id").map((c) => `${c}=@${c}`).join(",")}, updated_at=@updated_at WHERE id=@id`;
  const info = db().prepare(sql).run({ ...TRADE_PARAMS({ ...t, id }), updated_at: now() });
  return info.changes ? getTrade(id) : null;
}

export function deleteTrade(id: string) {
  const shots = listScreenshots(id);
  for (const s of shots) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, s.filename));
    } catch {
      /* file already gone */
    }
  }
  db().prepare("DELETE FROM trades WHERE id=?").run(id);
}

export function getTrade(id: string): Trade | null {
  const row = db().prepare("SELECT * FROM trades WHERE id=?").get(id) as TradeRow | undefined;
  if (!row) return null;
  const t = toTrade(row);
  t.screenshots = listScreenshots(id);
  return t;
}

export function listTrades(accountId?: string | null): Trade[] {
  const rows = (accountId
    ? db().prepare("SELECT * FROM trades WHERE account_id=? ORDER BY date DESC, COALESCE(time,'') DESC, created_at DESC").all(accountId)
    : db().prepare("SELECT * FROM trades ORDER BY date DESC, COALESCE(time,'') DESC, created_at DESC").all()) as TradeRow[];
  const trades = rows.map(toTrade);
  const shots = db().prepare("SELECT * FROM screenshots ORDER BY created_at").all() as ScreenshotRow[];
  const byTrade = new Map<string, Screenshot[]>();
  for (const s of shots) {
    const arr = byTrade.get(s.trade_id) ?? [];
    arr.push(toScreenshot(s));
    byTrade.set(s.trade_id, arr);
  }
  for (const t of trades) t.screenshots = byTrade.get(t.id) ?? [];
  return trades;
}

export function insertTradesBulk(list: TradeInput[]): number {
  const ts = now();
  const sql = `INSERT INTO trades (${COLS.join(",")},created_at,updated_at)
     VALUES (${COLS.map((c) => "@" + c).join(",")},@created_at,@updated_at)`;
  const stmt = db().prepare(sql);
  const tx = db().transaction((items: TradeInput[]) => {
    for (const t of items) stmt.run({ ...TRADE_PARAMS(t), created_at: ts, updated_at: ts });
  });
  tx(list);
  return list.length;
}

/* -------------------------------- screenshots -------------------------------- */

type ScreenshotRow = {
  id: string; trade_id: string; phase: string; filename: string; mime: string; caption: string | null; created_at: string;
};
const toScreenshot = (r: ScreenshotRow): Screenshot => ({
  id: r.id,
  tradeId: r.trade_id,
  phase: r.phase as Screenshot["phase"],
  filename: r.filename,
  mime: r.mime,
  caption: r.caption,
  createdAt: r.created_at,
});

export function listScreenshots(tradeId: string): Screenshot[] {
  return (db().prepare("SELECT * FROM screenshots WHERE trade_id=? ORDER BY created_at").all(tradeId) as ScreenshotRow[]).map(toScreenshot);
}

export function addScreenshot(s: Omit<Screenshot, "id" | "createdAt">): Screenshot {
  const id = uid("shot");
  const created = now();
  db()
    .prepare("INSERT INTO screenshots (id,trade_id,phase,filename,mime,caption,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, s.tradeId, s.phase, s.filename, s.mime, s.caption ?? null, created);
  return { ...s, id, createdAt: created };
}

export function deleteScreenshot(id: string) {
  const row = db().prepare("SELECT * FROM screenshots WHERE id=?").get(id) as ScreenshotRow | undefined;
  if (!row) return;
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, row.filename));
  } catch {
    /* already removed */
  }
  db().prepare("DELETE FROM screenshots WHERE id=?").run(id);
}

/* --------------------------------- backtests --------------------------------- */

type BacktestRow = {
  id: string; name: string; strategy: string | null; instrument: string | null; start_date: string | null;
  end_date: string | null; params: string; status: string; result: string | null; engine_note: string | null; created_at: string;
};

const toBacktest = (r: BacktestRow): Backtest => ({
  id: r.id,
  name: r.name,
  strategy: r.strategy,
  instrument: r.instrument,
  startDate: r.start_date,
  endDate: r.end_date,
  params: safeJson(r.params, {}) as Record<string, unknown>,
  status: r.status as Backtest["status"],
  result: r.result ? (safeJson(r.result, null) as Backtest["result"]) : null,
  engineNote: r.engine_note,
  createdAt: r.created_at,
});

function safeJson(v: string, fallback: unknown) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function listBacktests(): Backtest[] {
  return (db().prepare("SELECT * FROM backtests ORDER BY created_at DESC").all() as BacktestRow[]).map(toBacktest);
}

export function createBacktest(b: Omit<Backtest, "id" | "createdAt">): Backtest {
  const id = uid("bt");
  const created = now();
  db()
    .prepare(
      `INSERT INTO backtests (id,name,strategy,instrument,start_date,end_date,params,status,result,engine_note,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, b.name, b.strategy, b.instrument, b.startDate, b.endDate, JSON.stringify(b.params ?? {}), b.status, b.result ? JSON.stringify(b.result) : null, b.engineNote ?? null, created);
  return { ...b, id, createdAt: created };
}

export function updateBacktestResult(id: string, result: Backtest["result"], status: Backtest["status"], note?: string | null) {
  db()
    .prepare("UPDATE backtests SET result=?, status=?, engine_note=COALESCE(?, engine_note) WHERE id=?")
    .run(result ? JSON.stringify(result) : null, status, note ?? null, id);
  return listBacktests().find((b) => b.id === id) ?? null;
}

export function deleteBacktest(id: string) {
  db().prepare("DELETE FROM backtests WHERE id=?").run(id);
}

/* --------------------------------- portfolio --------------------------------- */

/**
 * Holdings, transactions, snapshots and the price cache.
 *
 * All of it lives in the same journal.db as everything else, so it is covered by the same backups
 * and the same TJ_DATA_DIR override — on Railway that means the mounted volume, and it survives a
 * redeploy. Nothing here talks to a broker: holdings are entered by hand, and only prices come from
 * outside.
 */

type HoldingRow = {
  id: string; symbol: string; name: string | null; shares: number; avg_cost: number;
  asset_type: string; manual_price: number | null; manual_price_at: string | null;
  amount_invested: number | null; acquisition: string | null; acquired_at: string | null;
  note: string | null; created_at: string; updated_at: string;
};

const toHolding = (r: HoldingRow): PortfolioHolding => ({
  id: r.id,
  symbol: r.symbol,
  name: r.name,
  shares: r.shares,
  avgCost: r.avg_cost,
  assetType: (r.asset_type as PortfolioHolding["assetType"]) ?? "stock",
  // Rows written before this column existed read back as undefined, not null.
  manualPrice: r.manual_price ?? null,
  manualPriceAt: r.manual_price_at ?? null,
  amountInvested: r.amount_invested ?? null,
  acquisition: (r.acquisition as PortfolioHolding["acquisition"]) ?? null,
  acquiredAt: r.acquired_at ?? null,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listHoldings(): PortfolioHolding[] {
  return (db().prepare("SELECT * FROM holdings ORDER BY symbol").all() as HoldingRow[]).map(toHolding);
}

export function getHolding(id: string): PortfolioHolding | null {
  const r = db().prepare("SELECT * FROM holdings WHERE id=?").get(id) as HoldingRow | undefined;
  return r ? toHolding(r) : null;
}

export function createHolding(h: {
  symbol: string; name?: string | null; shares: number; avgCost: number;
  assetType?: PortfolioHolding["assetType"]; manualPrice?: number | null;
  amountInvested?: number | null; acquisition?: PortfolioHolding["acquisition"];
  acquiredAt?: string | null; note?: string | null;
}): PortfolioHolding {
  const symbol = h.symbol.trim().toUpperCase();
  // One row per symbol: buying more of something you already hold adds to that position rather
  // than creating a second one, which is how a broker account actually behaves.
  const existing = db().prepare("SELECT * FROM holdings WHERE symbol=?").get(symbol) as HoldingRow | undefined;
  if (existing) {
    const shares = existing.shares + h.shares;
    const avgCost = shares === 0 ? 0 : (existing.shares * existing.avg_cost + h.shares * h.avgCost) / shares;
    // Adding to a hand-valued position is also the moment you looked up what it is worth, so a
    // fresh valuation replaces the old one. Omitting it leaves the previous figure alone.
    const revalue = h.manualPrice === null || h.manualPrice === undefined ? {} : { manualPrice: h.manualPrice };
    // The cached acquisition figures are not merged here: the caller records a transaction straight
    // after this and syncHoldingFromTransactions recomputes all three from the full history, which
    // is the only place that can tell a part-gifted position from a bought one.
    return updateHolding(existing.id, { shares, avgCost, ...revalue })!;
  }

  const id = uid("hld");
  const ts = now();
  db()
    .prepare(
      `INSERT INTO holdings (id,symbol,name,shares,avg_cost,asset_type,manual_price,manual_price_at,
        amount_invested,acquisition,acquired_at,note,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id, symbol, h.name ?? null, h.shares, h.avgCost, h.assetType ?? "stock",
      h.manualPrice ?? null, h.manualPrice === null || h.manualPrice === undefined ? null : ts,
      h.amountInvested ?? null, h.acquisition ?? null, h.acquiredAt ?? null,
      h.note ?? null, ts, ts
    );
  return getHolding(id)!;
}

export function updateHolding(id: string, patch: Partial<Omit<PortfolioHolding, "id" | "createdAt">>): PortfolioHolding | null {
  const current = getHolding(id);
  if (!current) return null;
  const ts = now();
  const next = { ...current, ...patch, symbol: (patch.symbol ?? current.symbol).trim().toUpperCase() };
  // Stamped only when the number actually changes. Re-saving a holding for some unrelated reason
  // must not make a three-week-old valuation look like it was checked today — that timestamp is
  // the only thing telling you whether to trust the figure.
  const repriced = patch.manualPrice !== undefined && patch.manualPrice !== current.manualPrice;
  const manualPriceAt = repriced ? (next.manualPrice === null ? null : ts) : current.manualPriceAt;
  db()
    .prepare(
      `UPDATE holdings SET symbol=?, name=?, shares=?, avg_cost=?, asset_type=?, manual_price=?,
       manual_price_at=?, amount_invested=?, acquisition=?, acquired_at=?, note=?, updated_at=? WHERE id=?`
    )
    .run(
      next.symbol, next.name ?? null, next.shares, next.avgCost, next.assetType,
      next.manualPrice ?? null, manualPriceAt,
      next.amountInvested ?? null, next.acquisition ?? null, next.acquiredAt ?? null,
      next.note ?? null, ts, id
    );
  return getHolding(id);
}

export function deleteHolding(id: string) {
  db().prepare("DELETE FROM holdings WHERE id=?").run(id);
}

type TxRow = {
  id: string; holding_id: string | null; symbol: string; kind: string; shares: number;
  price: number; fees: number; acquisition: string | null; cash_paid: number | null;
  date: string; note: string | null; created_at: string;
};

const toTx = (r: TxRow): PortfolioTransaction => ({
  id: r.id,
  holdingId: r.holding_id,
  symbol: r.symbol,
  kind: r.kind as PortfolioTransaction["kind"],
  shares: r.shares,
  price: r.price,
  fees: r.fees,
  // Rows written before the column existed read back as undefined; every one of them was a buy.
  acquisition: (r.acquisition as PortfolioTransaction["acquisition"]) ?? "purchase",
  cashPaid: r.cash_paid ?? null,
  date: r.date,
  note: r.note,
  createdAt: r.created_at,
});

export function listTransactions(symbol?: string | null): PortfolioTransaction[] {
  const rows = symbol
    ? (db().prepare("SELECT * FROM portfolio_transactions WHERE symbol=? ORDER BY date DESC, created_at DESC").all(symbol.toUpperCase()) as TxRow[])
    : (db().prepare("SELECT * FROM portfolio_transactions ORDER BY date DESC, created_at DESC").all() as TxRow[]);
  return rows.map(toTx);
}

export function createTransaction(t: {
  symbol: string; kind: PortfolioTransaction["kind"]; shares: number; price: number;
  fees?: number; acquisition?: AcquisitionType; cashPaid?: number | null;
  date: string; note?: string | null;
}): PortfolioTransaction {
  const id = uid("ptx");
  const symbol = t.symbol.trim().toUpperCase();
  const holding = db().prepare("SELECT id FROM holdings WHERE symbol=?").get(symbol) as { id: string } | undefined;
  db()
    .prepare(
      `INSERT INTO portfolio_transactions (id,holding_id,symbol,kind,shares,price,fees,acquisition,cash_paid,date,note,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id, holding?.id ?? null, symbol, t.kind, t.shares, t.price, t.fees ?? 0,
      t.acquisition ?? "purchase", t.cashPaid ?? null, t.date, t.note ?? null, now()
    );
  return listTransactions().find((x) => x.id === id)!;
}

export function deleteTransaction(id: string) {
  db().prepare("DELETE FROM portfolio_transactions WHERE id=?").run(id);
}

type SnapshotRow = { ts: number; total: number; cash: number; invested: number; breakdown: string | null };

/**
 * A stored row, with its breakdown parsed.
 *
 * Malformed JSON reads as "no breakdown" rather than throwing: one bad row should cost you a
 * filtered point, not the entire performance chart.
 */
const toSnapshot = (r: SnapshotRow): PortfolioSnapshotRow => {
  let breakdown: Record<string, number> | null = null;
  if (r.breakdown) {
    try {
      const parsed = JSON.parse(r.breakdown);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) breakdown = parsed as Record<string, number>;
    } catch {
      /* unreadable: treat the split as unrecorded */
    }
  }
  return { ts: r.ts, total: r.total, cash: r.cash, invested: r.invested, breakdown };
};

export function listSnapshots(): PortfolioSnapshotRow[] {
  return (db().prepare("SELECT ts,total,cash,invested,breakdown FROM portfolio_snapshots ORDER BY ts").all() as SnapshotRow[]).map(toSnapshot);
}

export function lastSnapshot(): PortfolioSnapshotRow | null {
  const r = db().prepare("SELECT ts,total,cash,invested,breakdown FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1").get() as SnapshotRow | undefined;
  return r ? toSnapshot(r) : null;
}

export function insertSnapshot(s: PortfolioSnapshotRow) {
  db()
    .prepare(
      `INSERT INTO portfolio_snapshots (ts,total,cash,invested,breakdown) VALUES (?,?,?,?,?)
       ON CONFLICT(ts) DO UPDATE SET total=excluded.total, cash=excluded.cash,
         invested=excluded.invested, breakdown=excluded.breakdown`
    )
    .run(s.ts, s.total, s.cash, s.invested, s.breakdown ? JSON.stringify(s.breakdown) : null);
}

export function readPriceCache(): Map<string, { symbol: string; price: number; previousClose: number | null; fetchedAt: number }> {
  const rows = db().prepare("SELECT symbol,price,previous_close,fetched_at FROM price_cache").all() as {
    symbol: string; price: number; previous_close: number | null; fetched_at: number;
  }[];
  return new Map(rows.map((r) => [r.symbol, { symbol: r.symbol, price: r.price, previousClose: r.previous_close, fetchedAt: r.fetched_at }]));
}

export function writePriceCache(quotes: { symbol: string; price: number; previousClose: number | null; fetchedAt: number }[]) {
  const stmt = db().prepare(
    "INSERT INTO price_cache (symbol,price,previous_close,fetched_at) VALUES (?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, previous_close=excluded.previous_close, fetched_at=excluded.fetched_at"
  );
  for (const q of quotes) stmt.run(q.symbol, q.price, q.previousClose, q.fetchedAt);
}

/**
 * Cash, kept in the settings table under its own key.
 *
 * Separate from the app settings blob so a malformed settings row cannot take the portfolio down
 * with it, and so it can be written without rewriting everything else.
 */
export function getPortfolioMeta(): { cash: number } {
  const row = db().prepare("SELECT value FROM settings WHERE key='portfolio'").get() as { value: string } | undefined;
  if (!row) return { cash: 0 };
  try {
    const parsed = JSON.parse(row.value) as { cash?: unknown };
    const cash = Number(parsed.cash);
    return { cash: Number.isFinite(cash) ? cash : 0 };
  } catch {
    return { cash: 0 };
  }
}

export function savePortfolioMeta(meta: { cash: number }): { cash: number } {
  const clean = { cash: Number.isFinite(meta.cash) ? meta.cash : 0 };
  db()
    .prepare("INSERT INTO settings (key,value) VALUES ('portfolio',@v) ON CONFLICT(key) DO UPDATE SET value=@v")
    .run({ v: JSON.stringify(clean) });
  return clean;
}

/* --------------------------------- watchlist --------------------------------- */

type WatchRow = { id: string; symbol: string; name: string | null; note: string | null; created_at: string };

const toWatch = (r: WatchRow): WatchlistItem => ({
  id: r.id,
  symbol: r.symbol,
  name: r.name,
  note: r.note,
  createdAt: r.created_at,
});

export function listWatchlist(): WatchlistItem[] {
  return (db().prepare("SELECT * FROM watchlist ORDER BY symbol").all() as WatchRow[]).map(toWatch);
}

export function addWatch(w: { symbol: string; name?: string | null; note?: string | null }): WatchlistItem {
  const symbol = w.symbol.trim().toUpperCase();
  const existing = db().prepare("SELECT * FROM watchlist WHERE symbol=?").get(symbol) as WatchRow | undefined;
  if (existing) return toWatch(existing);
  const id = uid("wl");
  db()
    .prepare("INSERT INTO watchlist (id,symbol,name,note,created_at) VALUES (?,?,?,?,?)")
    .run(id, symbol, w.name ?? null, w.note ?? null, now());
  return listWatchlist().find((x) => x.id === id)!;
}

export function removeWatch(id: string) {
  db().prepare("DELETE FROM watchlist WHERE id=?").run(id);
}

export function removeWatchBySymbol(symbol: string) {
  db().prepare("DELETE FROM watchlist WHERE symbol=?").run(symbol.trim().toUpperCase());
}


/**
 * Rebuild a holding from its transactions.
 *
 * Once a symbol has any transaction history, that history *is* the position — share count and
 * average cost are derived from it rather than stored independently. That is what makes "I bought
 * more on Tuesday" work without you doing arithmetic, and it means correcting a mistake is a
 * matter of deleting the wrong transaction rather than reverse-engineering an average.
 *
 * A symbol with no transactions is left alone: holdings added before this existed, or entered
 * directly, keep whatever was set.
 */
export function syncHoldingFromTransactions(symbol: string): PortfolioHolding | null {
  const sym = symbol.trim().toUpperCase();
  const txs = listTransactions(sym);
  const row = db().prepare("SELECT * FROM holdings WHERE symbol=?").get(sym) as HoldingRow | undefined;

  if (txs.length === 0) return row ? toHolding(row) : null;

  const lots = txs.map((t) => ({
    kind: t.kind,
    shares: t.shares,
    price: t.price,
    date: t.date,
    acquisition: t.acquisition,
    cashPaid: t.cashPaid,
  }));
  const computed = costFromTransactions(lots);
  // Walked separately from the basis because the two answers diverge on a gift: it adds to the
  // basis and nothing to the cash.
  const acquired = investedFromTransactions(lots);

  // Null means the history cannot produce a position — selling more than was ever held. Refusing
  // to write anything is right: the transactions are wrong, and inventing a share count would hide
  // that rather than surface it.
  if (!computed) return row ? toHolding(row) : null;

  if (computed.shares <= 0) {
    // Sold out entirely. The holding goes, but the transactions are the record of what you did and
    // must outlive it — so they are detached first. Without this the ON DELETE CASCADE on
    // holding_id takes the whole history with the position, which is silent data loss at exactly
    // the moment you would want to look back at it.
    if (row) {
      db().prepare("UPDATE portfolio_transactions SET holding_id=NULL WHERE holding_id=?").run(row.id);
      db().prepare("DELETE FROM holdings WHERE id=?").run(row.id);
    }
    return null;
  }

  if (!row) {
    // The transactions add up to a position but no holding row exists — you sold out and have now
    // bought back in. Recreate it rather than returning null, which is what made a rebuy appear to
    // do nothing at all. The name and type come from the catalogue so the row is not a bare ticker.
    const info = lookup(sym);
    const id = uid("hld");
    const ts = now();
    db()
      .prepare(
        `INSERT INTO holdings (id,symbol,name,shares,avg_cost,asset_type,
          amount_invested,acquisition,acquired_at,note,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id, sym, info?.name ?? null, computed.shares, computed.avgCost, info?.assetType ?? "stock",
        acquired.invested, acquired.acquisition, acquired.acquiredAt, null, ts, ts
      );
    // Re-point the detached transactions at the new row so the position and its history stay linked.
    db().prepare("UPDATE portfolio_transactions SET holding_id=? WHERE symbol=? AND holding_id IS NULL").run(id, sym);
    return getHolding(id);
  }

  db()
    .prepare(
      `UPDATE holdings SET shares=?, avg_cost=?, amount_invested=?, acquisition=?, acquired_at=?,
       updated_at=? WHERE id=?`
    )
    .run(computed.shares, computed.avgCost, acquired.invested, acquired.acquisition, acquired.acquiredAt, now(), row.id);
  return getHolding(row.id);
}

/**
 * Put a deleted position back exactly as it was.
 *
 * Undo has to restore the transactions as well as the holding, because the transactions *are* the
 * position — restoring the row alone would give you back a share count with no history behind it,
 * and the next edit would recompute it away.
 *
 * Ids are reused when they are free so that anything still referring to them lines up; a collision
 * just gets a fresh id rather than failing the restore.
 */
export function restorePortfolio(
  holding: Omit<PortfolioHolding, "createdAt" | "updatedAt"> & { createdAt?: string },
  transactions: Omit<PortfolioTransaction, "createdAt">[]
): PortfolioHolding | null {
  const sym = holding.symbol.trim().toUpperCase();
  const ts = now();

  const clash = db().prepare("SELECT id FROM holdings WHERE id=? OR symbol=?").get(holding.id, sym) as { id: string } | undefined;
  const holdingId = clash ? clash.id : holding.id || uid("hld");

  if (!clash) {
    db()
      .prepare(
        `INSERT INTO holdings (id,symbol,name,shares,avg_cost,asset_type,manual_price,manual_price_at,
          amount_invested,acquisition,acquired_at,note,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        holdingId, sym, holding.name ?? null, holding.shares, holding.avgCost, holding.assetType,
        holding.manualPrice ?? null, holding.manualPriceAt ?? null,
        holding.amountInvested ?? null, holding.acquisition ?? null, holding.acquiredAt ?? null,
        holding.note ?? null, holding.createdAt ?? ts, ts
      );
  }

  const insert = db().prepare(
    `INSERT INTO portfolio_transactions (id,holding_id,symbol,kind,shares,price,fees,date,note,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  for (const t of transactions) {
    // An id that is already present means this exact transaction is already back — restoring twice
    // (a double click, a retry, a second tab) must be a no-op, not a duplicate. Giving the row a
    // fresh id instead would silently double the position, which is the worst possible outcome for
    // a feature whose entire job is putting things back the way they were.
    const exists = db().prepare("SELECT id FROM portfolio_transactions WHERE id=?").get(t.id);
    if (exists) {
      // Re-link it in case the holding was recreated under a new id.
      db().prepare("UPDATE portfolio_transactions SET holding_id=? WHERE id=?").run(holdingId, t.id);
      continue;
    }
    insert.run(t.id || uid("ptx"), holdingId, sym, t.kind, t.shares, t.price, t.fees ?? 0, t.date, t.note ?? null, ts);
  }

  // Recompute, so a restore lands on the same numbers the transactions imply rather than on
  // whatever was stored at the moment of deletion.
  return syncHoldingFromTransactions(sym) ?? getHolding(holdingId);
}

/** A holding plus its transactions, captured before deleting so it can be put back. */
export function snapshotHolding(id: string): { holding: PortfolioHolding; transactions: PortfolioTransaction[] } | null {
  const holding = getHolding(id);
  if (!holding) return null;
  return { holding, transactions: listTransactions(holding.symbol) };
}

/* ----------------------------------- reset ----------------------------------- */

/**
 * Everything the portfolio consists of, in one object.
 *
 * Used for reset: captured before anything is deleted so the whole thing can be put back. A reset
 * you cannot undo is a reset you hesitate over, and hesitating over a clean slate is the wrong
 * failure mode for a tool you are still setting up.
 */
export interface PortfolioBundle {
  holdings: { holding: PortfolioHolding; transactions: PortfolioTransaction[] }[];
  snapshots: PortfolioSnapshotRow[];
  watchlist: WatchlistItem[];
  cash: number;
}

export function snapshotPortfolio(): PortfolioBundle {
  return {
    holdings: listHoldings().map((h) => ({ holding: h, transactions: listTransactions(h.symbol) })),
    snapshots: listSnapshots(),
    watchlist: listWatchlist(),
    cash: getPortfolioMeta().cash,
  };
}

export interface ResetOptions {
  holdings: boolean;
  /** The recorded value history — the line on the chart. */
  history: boolean;
  cash: boolean;
  watchlist: boolean;
}

/** Clear the selected parts. Returns what was there, so it can be restored. */
export function resetPortfolio(opts: ResetOptions): PortfolioBundle {
  const before = snapshotPortfolio();

  if (opts.holdings) {
    // Transactions first and explicitly. They cascade from holdings anyway, but relying on the
    // cascade would leave behind any row whose holding_id was detached by a sell-out.
    db().exec("DELETE FROM portfolio_transactions");
    db().exec("DELETE FROM holdings");
  }
  if (opts.history) db().exec("DELETE FROM portfolio_snapshots");
  if (opts.watchlist) db().exec("DELETE FROM watchlist");
  if (opts.cash) savePortfolioMeta({ cash: 0 });

  return before;
}

/**
 * Put a whole bundle back.
 *
 * Idempotent for the same reason a single restore is: running it twice — a double click, a retry —
 * must land on the same state rather than doubling every position.
 */
export function restoreBundle(bundle: Partial<PortfolioBundle>): void {
  // Restoring value history replaces it rather than merging into it. Undoing "start from today"
  // has to remove the baseline that action wrote, or the old history comes back *around* it and
  // the chart shows both — the staircase you wanted gone, plus the anchor you wanted kept.
  if (bundle.snapshots?.length) db().exec("DELETE FROM portfolio_snapshots");

  for (const entry of bundle.holdings ?? []) {
    restorePortfolio(entry.holding, entry.transactions ?? []);
  }
  for (const s of bundle.snapshots ?? []) {
    if (Number.isFinite(s.ts) && Number.isFinite(s.total)) insertSnapshot(s);
  }
  for (const w of bundle.watchlist ?? []) {
    if (w?.symbol) addWatch({ symbol: w.symbol, name: w.name, note: w.note });
  }
  if (typeof bundle.cash === "number" && Number.isFinite(bundle.cash)) savePortfolioMeta({ cash: bundle.cash });
}

/**
 * Make today the starting point.
 *
 * Clears the recorded value history and writes a single entry at what the portfolio is worth right
 * now. Everything from here is measured against that.
 *
 * This exists because of how the first day actually goes: you spend a while typing in holdings,
 * and every one of them lands in the history as a jump in value. The result is a chart whose first
 * hour is a staircase of you doing data entry, and a starting balance that was true for about ten
 * minutes. Wiping that and anchoring to the finished total is the honest version.
 *
 * The old history comes back for undo. It is not worth much — it is a record of typing — but
 * throwing away data silently is not a habit worth having.
 */
export function rebaselineToNow(
  total: number,
  cash: number,
  invested: number,
  breakdown: Record<string, number> | null = null
): { removed: PortfolioSnapshotRow[]; ts: number } {
  const removed = listSnapshots();
  db().exec("DELETE FROM portfolio_snapshots");
  const ts = Date.now();
  insertSnapshot({ ts, total, cash, invested, breakdown });
  return { removed, ts };
}


/* ------------------------------ replay sessions ------------------------------ */

type ReplayRow = {
  id: string; name: string; symbol: string; tf: string; base_tf: string;
  cursor_ts: number; auto: number; state: string; created_at: string; updated_at: string;
};

const toReplaySession = (r: ReplayRow): ReplaySession => {
  const { trades, position } = parseSessionState(r.state);
  return {
    id: r.id,
    name: r.name,
    symbol: r.symbol,
    tf: r.tf,
    baseTf: r.base_tf,
    cursorTs: r.cursor_ts,
    auto: r.auto === 1,
    trades,
    position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

export function listReplaySessions(symbol?: string): ReplaySession[] {
  const rows = symbol
    ? (db().prepare("SELECT * FROM replay_sessions WHERE symbol=? ORDER BY updated_at DESC").all(symbol.trim().toUpperCase()) as ReplayRow[])
    : (db().prepare("SELECT * FROM replay_sessions ORDER BY updated_at DESC").all() as ReplayRow[]);
  return rows.map(toReplaySession);
};

export function getReplaySession(id: string): ReplaySession | null {
  const r = db().prepare("SELECT * FROM replay_sessions WHERE id=?").get(id) as ReplayRow | undefined;
  return r ? toReplaySession(r) : null;
}

/**
 * Write a session.
 *
 * The auto slot is addressed by symbol rather than by id, so the browser never has to remember
 * which row it is writing to: it says "this is where I am on MNQ" and exactly one row moves. A
 * named save is addressed by id and only ever touched deliberately.
 */
export function saveReplaySession(s: {
  id?: string | null;
  name: string;
  symbol: string;
  tf: string;
  baseTf: string;
  cursorTs: number;
  auto?: boolean;
  state: ReplaySessionState;
}): ReplaySession {
  const symbol = s.symbol.trim().toUpperCase();
  const auto = s.auto ? 1 : 0;
  const ts = now();
  const state = serialiseSessionState(s.state);

  const existing = (s.id
    ? (db().prepare("SELECT id, created_at FROM replay_sessions WHERE id=?").get(s.id) as { id: string; created_at: string } | undefined)
    : auto
      ? (db().prepare("SELECT id, created_at FROM replay_sessions WHERE symbol=? AND auto=1").get(symbol) as { id: string; created_at: string } | undefined)
      : undefined);

  if (existing) {
    db()
      .prepare(
        `UPDATE replay_sessions SET name=?, symbol=?, tf=?, base_tf=?, cursor_ts=?, auto=?, state=?, updated_at=?
         WHERE id=?`
      )
      .run(s.name, symbol, s.tf, s.baseTf, s.cursorTs, auto, state, ts, existing.id);
    return getReplaySession(existing.id)!;
  }

  const id = s.id || uid("rpl");
  db()
    .prepare(
      `INSERT INTO replay_sessions (id,name,symbol,tf,base_tf,cursor_ts,auto,state,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, s.name, symbol, s.tf, s.baseTf, s.cursorTs, auto, state, ts, ts);
  return getReplaySession(id)!;
}

export function deleteReplaySession(id: string) {
  db().prepare("DELETE FROM replay_sessions WHERE id=?").run(id);
}
