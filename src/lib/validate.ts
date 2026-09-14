import { RESULT_CODES } from "./types";
import type { Account, ResultCode, TradeInput } from "./types";
import { deriveR } from "./stats";
import { isROnly } from "./account-groups";

export class ValidationError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const strOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

const bool = (v: unknown): 0 | 1 => (v === true || v === 1 || v === "1" || v === "true" || v === "yes" ? 1 : 0);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeTrade(raw: Record<string, unknown>, id: string, accountId: string): TradeInput {
  const date = strOrNull(raw.date);
  if (!date || !DATE_RE.test(date)) throw new ValidationError("A valid date (YYYY-MM-DD) is required", "date");

  const instrumentRaw = strOrNull(raw.instrument);
  if (!instrumentRaw) throw new ValidationError("Instrument is required", "instrument");
  // Normalised so that grouping and filtering never split on casing.
  const instrument = instrumentRaw.toUpperCase();

  const direction = String(raw.direction ?? "long").toLowerCase();
  if (direction !== "long" && direction !== "short") throw new ValidationError("Direction must be long or short", "direction");

  const result = String(raw.result ?? "").toLowerCase() as ResultCode;
  if (!RESULT_CODES.includes(result)) throw new ValidationError("Unknown result classification", "result");

  const time = strOrNull(raw.time);
  if (time && !TIME_RE.test(time)) throw new ValidationError("Time must be HH:MM (24h)", "time");

  const entry = numOrNull(raw.entry);
  const stop = numOrNull(raw.stop);
  const exit = numOrNull(raw.exit);
  let rMultiple = numOrNull(raw.rMultiple);
  if (rMultiple === null) rMultiple = deriveR(entry, stop, exit, direction);

  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : [];

  return {
    id,
    accountId,
    date,
    time,
    instrument,
    direction,
    session: strOrNull(raw.session),
    strategy: strOrNull(raw.strategy),
    setup: strOrNull(raw.setup),
    entry,
    stop,
    target: numOrNull(raw.target),
    exit,
    size: numOrNull(raw.size),
    riskAmount: numOrNull(raw.riskAmount),
    riskPct: numOrNull(raw.riskPct),
    result,
    pnl: numOrNull(raw.pnl) ?? 0,
    rMultiple,
    plannedRr: numOrNull(raw.plannedRr),
    mae: numOrNull(raw.mae),
    mfe: numOrNull(raw.mfe),
    fees: numOrNull(raw.fees),
    htfSweep: bool(raw.htfSweep),
    sweep4h: bool(raw.sweep4h),
    sweep1h: bool(raw.sweep1h),
    sweep15m: bool(raw.sweep15m),
    sessionSweep: bool(raw.sessionSweep),
    mss: bool(raw.mss),
    fvg: bool(raw.fvg),
    orderBlock: bool(raw.orderBlock),
    displacement: bool(raw.displacement),
    pdArray: strOrNull(raw.pdArray),
    entryModel: strOrNull(raw.entryModel),
    liquidityTarget: strOrNull(raw.liquidityTarget),
    tags,
    thesis: strOrNull(raw.thesis),
    execution: strOrNull(raw.execution),
    review: strOrNull(raw.review),
    mistakes: strOrNull(raw.mistakes),
    emotions: strOrNull(raw.emotions),
  };
}

/**
 * Strip everything monetary from a trade bound for a backtest account.
 *
 * Enforced here rather than in the form, because the form is not the only way in: the CSV importer,
 * the replay logger, the Notion script and any engine posting to the API all land on this function.
 * A backtest that stores a contract count and a dollar risk is storing a guess — nothing about the
 * test produced them — and every statistic built on top would inherit it.
 *
 * Prices, R and the whole setup context survive untouched; those are what the test actually
 * measured. Trades already in the database keep what they have until they are next saved.
 */
export function forAccount(t: TradeInput, account: Account | null | undefined): TradeInput {
  if (!isROnly(account)) return t;
  return { ...t, size: null, riskAmount: null, riskPct: null, pnl: 0, fees: null };
}

export function jsonError(e: unknown, fallback = "Request failed") {
  if (e instanceof ValidationError) return { error: e.message, field: e.field, status: 400 };
  const msg = e instanceof Error ? e.message : fallback;
  return { error: msg, status: 500 };
}
