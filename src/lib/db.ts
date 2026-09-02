import { Db, openDatabase } from "./driver";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS } from "./types";
import type { Account, Backtest, Screenshot, Settings, Setup, Strategy, Trade, TradeInput } from "./types";

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
