export function money(v: number | null | undefined, currency = "USD", opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const nf = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: opts.compact && abs >= 10000 ? 0 : 2,
    maximumFractionDigits: opts.compact && abs >= 10000 ? 0 : 2,
  });
  const s = nf.format(abs);
  if (v < 0) return `-${s}`;
  return opts.sign && v > 0 ? `+${s}` : s;
}

export function r(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}R`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function toneOf(v: number | null | undefined): "pos" | "neg" | "flat" {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "flat";
  return v > 0 ? "pos" : "neg";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse YYYY-MM-DD without timezone drift. */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function fmtDate(s: string): string {
  if (!s) return "—";
  const d = parseDate(s);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtDateShort(s: string): string {
  if (!s) return "—";
  const d = parseDate(s);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthLabel(year: number, month: number): string {
  return `${["January","February","March","April","May","June","July","August","September","October","November","December"][month]} ${year}`;
}
