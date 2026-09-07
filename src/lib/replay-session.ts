import type { ClosedTrade, Position } from "./replay";

/**
 * Saved replay sessions — leaving a replay and coming back to it.
 *
 * A replay is a piece of work, not a view. You step through three hours of a session, take eight
 * trades, and the moment the tab closes all of it is gone. Keeping only the cursor's timestamp,
 * which is what this used to do, means you come back to the right bar with none of the reasoning
 * that got you there: no trades, no open position, nothing to compare against.
 *
 * So the whole thing is stored, in journal.db rather than in the browser. localStorage is per
 * browser and evaporates when site data is cleared; a session you spent an hour building deserves
 * to sit next to the trades it produced.
 *
 * Everything here is pure and total. Parsing in particular has to be: this reads JSON out of a
 * database that a previous version of the app wrote, and one bad row must cost you that session
 * rather than the whole list.
 */

export interface ReplaySession {
  id: string;
  /** What you called it. The auto-saved slot names itself. */
  name: string;
  symbol: string;
  /** Display timeframe at the moment it was saved. */
  tf: string;
  /** Stepping resolution — the interval fills are checked at. */
  baseTf: string;
  /** The bar you were on. This is the "come back to where I was" part. */
  cursorTs: number;
  /**
   * True for the single rolling slot per symbol that saves itself as you replay.
   *
   * Kept apart from named saves because they answer different questions: the auto slot is "where
   * was I", a named save is "this is the run I want to keep". Overwriting the second with the
   * first would lose deliberate work to an accident of navigation.
   */
  auto: boolean;
  trades: ClosedTrade[];
  position: Position | null;
  createdAt: string;
  updatedAt: string;
}

/** What is worth writing down about a session, beyond where the cursor is. */
export interface ReplaySessionState {
  trades: ClosedTrade[];
  position: Position | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * One closed trade, rebuilt from stored JSON.
 *
 * Returns null rather than a partly-filled object when a required number is missing. A trade with
 * no exit price would sit in a results table contributing a silent zero to your expectancy, which
 * is worse than a trade that is visibly absent.
 */
function parseTrade(v: unknown): ClosedTrade | null {
  if (!isObj(v)) return null;
  const entry = num(v.entry);
  const stop = num(v.stop);
  const exit = num(v.exit);
  const contracts = num(v.contracts);
  const pointValue = num(v.pointValue);
  const entryTs = num(v.entryTs);
  const exitTs = num(v.exitTs);
  if (entry === null || stop === null || exit === null) return null;
  if (contracts === null || pointValue === null || entryTs === null || exitTs === null) return null;
  const direction = v.direction === "short" ? "short" : "long";
  return {
    direction,
    entry,
    stop,
    target: num(v.target),
    contracts,
    pointValue,
    risk: num(v.risk) ?? 0,
    entryTs,
    mae: num(v.mae) ?? 0,
    mfe: num(v.mfe) ?? 0,
    bars: num(v.bars) ?? 0,
    exit,
    exitTs,
    reason: (["stop", "target", "manual", "gap-stop", "gap-target"] as const).includes(v.reason as never)
      ? (v.reason as ClosedTrade["reason"])
      : "manual",
    r: num(v.r) ?? 0,
    pnl: num(v.pnl) ?? 0,
    ambiguous: v.ambiguous === true,
  };
}

/** An open position, rebuilt from stored JSON. Null when it cannot be trusted. */
function parsePosition(v: unknown): Position | null {
  if (!isObj(v)) return null;
  const entry = num(v.entry);
  const stop = num(v.stop);
  const contracts = num(v.contracts);
  const pointValue = num(v.pointValue);
  const entryTs = num(v.entryTs);
  if (entry === null || stop === null || contracts === null || pointValue === null || entryTs === null) return null;
  return {
    direction: v.direction === "short" ? "short" : "long",
    entry,
    stop,
    target: num(v.target),
    contracts,
    pointValue,
    risk: num(v.risk) ?? Math.abs(entry - stop) * pointValue * contracts,
    entryTs,
    mae: num(v.mae) ?? 0,
    mfe: num(v.mfe) ?? 0,
    bars: num(v.bars) ?? 0,
  };
}

/**
 * Read the stored blob.
 *
 * Anything unreadable degrades to an empty session rather than throwing, so a session with one
 * corrupt trade still returns you to the right bar with the rest of your work intact.
 */
export function parseSessionState(raw: unknown): ReplaySessionState {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { trades: [], position: null };
    }
  }
  if (!isObj(value)) return { trades: [], position: null };
  const trades = Array.isArray(value.trades)
    ? value.trades.map(parseTrade).filter((t): t is ClosedTrade => t !== null)
    : [];
  return { trades, position: parsePosition(value.position) };
}

export function serialiseSessionState(state: ReplaySessionState): string {
  return JSON.stringify({ trades: state.trades, position: state.position });
}

/** Net R across the closed trades — the one number that says how the run went. */
export function netR(trades: ClosedTrade[]): number {
  return trades.reduce((sum, t) => sum + (Number.isFinite(t.r) ? t.r : 0), 0);
}

/**
 * A one-line description, for a list you are choosing from.
 *
 * The timestamp is formatted by the caller's locale rather than here, so this stays pure and
 * testable — a function that reads the machine's time zone cannot be asserted against.
 */
export function describeSession(s: Pick<ReplaySession, "symbol" | "tf" | "trades" | "position">): string {
  const parts = [s.symbol, s.tf];
  parts.push(s.trades.length === 1 ? "1 trade" : `${s.trades.length} trades`);
  if (s.trades.length) {
    const r = netR(s.trades);
    parts.push(`${r >= 0 ? "+" : ""}${r.toFixed(2)}R`);
  }
  if (s.position) parts.push("position open");
  return parts.join(" · ");
}

/**
 * Whether a saved session can be resumed onto what is currently loaded.
 *
 * Resuming a MNQ session while looking at ES would drop trades priced in one instrument onto the
 * bars of another. The symbol has to be switched first, and saying so beats silently doing nothing.
 */
export function resumeBlocker(s: Pick<ReplaySession, "symbol">, currentSymbol: string): string | null {
  if (s.symbol !== currentSymbol) return `This session is on ${s.symbol}. Switch the symbol to resume it.`;
  return null;
}
