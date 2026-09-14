import type { Candle } from "./aggregate";
export { monthChunks } from "./chunks";

/**
 * Databento historical client — only the one call this app needs.
 *
 * The API key is read from the DATABENTO_API_KEY environment variable (put it in .env.local).
 * It is never logged, never returned to the browser, and never stored in the database.
 */

export const DEFAULT_DATASET = "GLBX.MDP3";
export const DEFAULT_STYPE = "continuous";

const ENDPOINT = "https://hist.databento.com/v0/timeseries.get_range";

export class DatabentoError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env.DATABENTO_API_KEY?.trim());
}

/** Redacts anything that looks like a key before an error reaches a browser or a log. */
function scrub(text: string): string {
  const key = process.env.DATABENTO_API_KEY?.trim();
  let out = text;
  if (key) out = out.split(key).join("[redacted]");
  return out.replace(/db-[A-Za-z0-9]{8,}/g, "[redacted]");
}

const toNumber = (v: unknown): number => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return Number.NaN;
  return Number(s);
};

/**
 * Databento can return prices either as decimals (pretty_px) or as int64 fixed-point scaled by
 * 1e-9. Detect rather than assume, so a change in response format cannot silently produce
 * prices that are a billion times too large.
 */
const price = (v: unknown): number => {
  const raw = String(v ?? "");
  const n = toNumber(v);
  if (!Number.isFinite(n)) return Number.NaN;
  if (raw.includes(".")) return n; // already decimal
  return Math.abs(n) > 1e7 ? n / 1e9 : n; // fixed-point
};

/** Timestamps arrive as ISO strings (pretty_ts) or nanoseconds since epoch. */
const timestamp = (v: unknown): number => {
  const raw = String(v ?? "");
  if (!raw) return Number.NaN;
  if (raw.includes("T") || raw.includes("-")) return Date.parse(raw);
  const n = Number(raw);
  if (!Number.isFinite(n)) return Number.NaN;
  if (n > 1e17) return Math.floor(n / 1e6); // nanoseconds
  if (n > 1e14) return Math.floor(n / 1e3); // microseconds
  return n; // already milliseconds
};

function parseRecord(line: string): Candle | null {
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  const hd = (rec.hd ?? {}) as Record<string, unknown>;
  const ts = timestamp(rec.ts_event ?? hd.ts_event);
  const open = price(rec.open);
  const high = price(rec.high);
  const low = price(rec.low);
  const close = price(rec.close);
  if (![ts, open, high, low, close].every(Number.isFinite)) return null;
  return { ts, open, high, low, close, volume: toNumber(rec.volume) || 0 };
}

export interface FetchParams {
  symbol: string; // e.g. "MNQ.c.0"
  dataset?: string;
  stypeIn?: string;
  start: string; // ISO date or datetime, inclusive
  end: string; // ISO date or datetime, exclusive
  schema?: "ohlcv-1m" | "ohlcv-1s" | "ohlcv-1h" | "ohlcv-1d";
  signal?: AbortSignal;
}

/**
 * Pull the readable parts out of an error body.
 *
 * `detail` is sometimes a string and sometimes an object carrying the useful text one level down.
 * Stringifying it blindly rendered every structured error as "[object Object]", which is how a
 * plain "you asked for a date past the end of the data" arrived as something undiagnosable.
 */
function parseError(text: string): { message: string; availableEnd?: string } {
  const fallback = text.slice(0, 400);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return { message: fallback };
  }
  const detail = body.detail;
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    const payload = (d.payload ?? {}) as Record<string, unknown>;
    return {
      message: String(d.message ?? d.case ?? fallback),
      availableEnd: typeof payload.available_end === "string" ? payload.available_end : undefined,
    };
  }
  return { message: String(detail ?? body.message ?? fallback) };
}

/** How many times a window may be narrowed to the end Databento reports before giving up. */
const MAX_CLAMPS = 3;

/** Fetch one window of bars. Callers chunk by month so a failure never costs the whole import. */
export async function fetchBars(params: FetchParams, attempt = 0): Promise<Candle[]> {
  const key = process.env.DATABENTO_API_KEY?.trim();
  if (!key) {
    throw new DatabentoError(
      "DATABENTO_API_KEY is not set. Create a .env.local file in the project folder containing DATABENTO_API_KEY=your_key and restart the app."
    );
  }

  const body = new URLSearchParams({
    dataset: params.dataset ?? DEFAULT_DATASET,
    symbols: params.symbol,
    schema: params.schema ?? "ohlcv-1m",
    stype_in: params.stypeIn ?? DEFAULT_STYPE,
    start: params.start,
    end: params.end,
    encoding: "json",
    pretty_px: "true",
    pretty_ts: "true",
  });

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        // Basic auth: API key as the username, empty password.
        Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: params.signal,
    });
  } catch (e) {
    throw new DatabentoError(`Could not reach Databento: ${scrub((e as Error).message)}`);
  }

  const text = await res.text();
  if (!res.ok) {
    const err = parseError(text);
    if (res.status === 401 || res.status === 403) {
      throw new DatabentoError(`Databento rejected the API key (${res.status}). Check DATABENTO_API_KEY in .env.local.`, res.status);
    }
    /**
     * Asking for data past the end of the dataset is a rejection, not an empty result.
     *
     * The window is built from calendar dates and `end` is exclusive, so "import up to today" —
     * the Market data page's default — asks for tomorrow and is refused. Every bar in that final
     * month is then lost over a boundary nobody chose.
     *
     * Two different 422s say this: `data_end_after_available_end` when the range runs past the
     * data, and `dataset_unavailable_range` when it runs past what the subscription covers. Both
     * report how far the dataset can actually serve, so the rule is the reported bound rather than
     * the error name.
     *
     * More than one attempt because that bound tracks real time: the two errors quoted instants
     * seconds apart, so a window clipped to the first was still too late for the second. Capped,
     * and only ever narrowing, so this converges instead of looping.
     */
    const bound = err.availableEnd ? Date.parse(err.availableEnd) : NaN;
    if (Number.isFinite(bound) && bound < Date.parse(params.end) && attempt < MAX_CLAMPS) {
      return fetchBars({ ...params, end: err.availableEnd! }, attempt + 1);
    }
    throw new DatabentoError(`Databento returned ${res.status}: ${scrub(err.message)}`, res.status);
  }

  const bars: Candle[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bar = parseRecord(trimmed);
    if (bar) bars.push(bar);
  }
  bars.sort((a, b) => a.ts - b.ts);
  return bars;
}
