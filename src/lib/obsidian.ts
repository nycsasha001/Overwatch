import type { Trade } from "./types";

/**
 * Trades as Obsidian notes.
 *
 * A vault is a folder of markdown files, so "connecting" the two is just writing the right file to
 * the right place. The shape of that file is what matters: everything mechanical goes in YAML
 * frontmatter, where Dataview and Bases can query it, and the prose you actually wrote stays in the
 * body where it reads like a note rather than a record.
 *
 * One-way, Overwatch to the vault. Reading notes back would mean deciding which side wins when both
 * changed, and the wrong answer to that question silently destroys writing you cannot get back.
 */

/** Written into every exported note so a re-export can tell its own work from yours. */
export const OVERWATCH_KEY = "overwatch_id";

/** Quote anything YAML would otherwise reinterpret — a bare `MNQ` is fine, `2026-04-04` is a date. */
function yamlValue(v: string | number | boolean | null): string {
  if (v === null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return String(v);
  const s = String(v);
  if (s === "") return '""';
  // Anything with structural characters, or that could be read as another type, gets quoted.
  // `: ` splits a key from a value, and ` #` opens a comment — note the space is *before* the
  // hash, not after it, which is why `ES#1` is safe bare and `ES #1` is not.
  if (/^[-?:,[\]{}#&*!|>'"%@`]|:\s|\s#|\n|^\s|\s$|^(true|false|null|yes|no|on|off)$/i.test(s) || /^[\d.+-]/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * A filename that survives every filesystem and still sorts and reads well in a vault.
 *
 * Date first so the folder sorts chronologically without a Dataview query, and no characters that
 * macOS, Windows or Obsidian's own link parser object to.
 */
export function noteName(t: Pick<Trade, "date" | "instrument" | "direction" | "time">): string {
  const time = (t.time ?? "").replace(":", "") || "0000";
  const safe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();
  return `${t.date} ${safe(t.instrument)} ${t.direction} ${time}`;
}

/**
 * An account name as a folder name.
 *
 * Trades file under the account they were taken on — "Backtests", "25k Pro" — so the vault mirrors
 * how the accounts are actually kept apart, and a Dataview query over one folder is one account.
 * Anything a filesystem or an Obsidian link would choke on is replaced rather than dropped, so two
 * differently-named accounts cannot collapse into the same folder.
 */
export function accountFolder(name: string | null | undefined): string {
  const cleaned = (name ?? "")
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    // Trailing dots and spaces are legal on macOS and not on Windows; a vault often syncs to both.
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();
  return cleaned || "Unassigned";
}

export interface NoteOptions {
  /** Vault-relative path of the embedded image, if the screenshot was copied across. */
  imagePath?: string | null;
  /** Extra tags to add alongside the trade's own. */
  tags?: string[];
  currency?: string;
  /** The account this trade was taken on, written into the frontmatter as well as the path. */
  account?: string | null;
}

const money = (n: number | null, currency = "USD") =>
  n === null || !Number.isFinite(n)
    ? ""
    : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);

/** The setup flags, as a readable list rather than eight separate booleans. */
function setupParts(t: Trade): string[] {
  const parts: string[] = [];
  if (t.htfSweep) parts.push("HTF sweep");
  if (t.sweep4h) parts.push("4H sweep");
  if (t.sweep1h) parts.push("1H sweep");
  if (t.sweep15m) parts.push("15m sweep");
  if (t.sessionSweep) parts.push("Session sweep");
  if (t.mss) parts.push("MSS");
  if (t.displacement) parts.push("Displacement");
  if (t.fvg) parts.push("FVG");
  if (t.orderBlock) parts.push("Order block");
  return parts;
}

/**
 * Render one trade as a complete Obsidian note.
 *
 * Pure on purpose: no filesystem, no database, no clock. The exact bytes that will land in the
 * vault are the return value, which means the format can be tested rather than eyeballed after the
 * fact — and a vault is not somewhere to find out you got it wrong.
 */
export function tradeNote(t: Trade, opts: NoteOptions = {}): string {
  const currency = opts.currency ?? "USD";
  const setup = setupParts(t);
  const tags = ["trade", ...(opts.tags ?? []), ...t.tags].filter((v, i, a) => v && a.indexOf(v) === i);

  const front: [string, string | number | boolean | null][] = [
    [OVERWATCH_KEY, t.id],
    ["date", t.date],
    ["time", t.time],
    ["account", opts.account ?? null],
    ["instrument", t.instrument],
    ["direction", t.direction],
    ["result", t.result],
    ["pnl", Number.isFinite(t.pnl) ? Number(t.pnl.toFixed(2)) : null],
    ["r", t.rMultiple === null ? null : Number(t.rMultiple.toFixed(2))],
    ["planned_rr", t.plannedRr],
    ["entry", t.entry],
    ["stop", t.stop],
    ["target", t.target],
    ["exit", t.exit],
    ["size", t.size],
    ["risk", t.riskAmount],
    ["session", t.session],
    ["strategy", t.strategy],
    ["setup", t.setup],
    ["entry_model", t.entryModel],
    ["pd_array", t.pdArray],
    ["mae", t.mae],
    ["mfe", t.mfe],
  ];

  const lines: string[] = ["---"];
  for (const [k, v] of front) {
    const rendered = yamlValue(v as string | number | boolean | null);
    if (rendered !== "") lines.push(`${k}: ${rendered}`);
  }
  // A YAML list, so Obsidian shows them as real tags rather than one string.
  lines.push("tags:");
  for (const tag of tags) lines.push(`  - ${tag}`);
  lines.push("---", "");

  const dirWord = t.direction === "long" ? "Long" : "Short";
  lines.push(`# ${dirWord} ${t.instrument} — ${t.date}${t.time ? ` ${t.time}` : ""}`, "");

  // The line you read first: what it did, in the two units that matter.
  const headline = [
    t.rMultiple === null ? null : `${t.rMultiple > 0 ? "+" : ""}${t.rMultiple.toFixed(2)}R`,
    money(t.pnl, currency),
    t.result,
  ].filter(Boolean);
  lines.push(`**${headline.join("  ·  ")}**`, "");

  if (opts.imagePath) lines.push(`![[${opts.imagePath}]]`, "");

  const row = (label: string, value: string) => `| ${label} | ${value} |`;
  lines.push("| | |", "|---|---|");
  if (t.entry !== null) lines.push(row("Entry", String(t.entry)));
  if (t.stop !== null) lines.push(row("Stop", String(t.stop)));
  if (t.target !== null) lines.push(row("Target", String(t.target)));
  if (t.exit !== null) lines.push(row("Exit", String(t.exit)));
  if (t.size !== null) lines.push(row("Size", String(t.size)));
  if (t.riskAmount !== null) lines.push(row("Risk", money(t.riskAmount, currency)));
  if (t.plannedRr !== null) lines.push(row("Planned RR", `${t.plannedRr}R`));
  if (t.mae !== null) lines.push(row("MAE", `${t.mae}R`));
  if (t.mfe !== null) lines.push(row("MFE", `${t.mfe}R`));
  lines.push("");

  if (setup.length) lines.push("## Setup", "", setup.map((s) => `- ${s}`).join("\n"), "");

  // Only sections that have something in them. An export full of empty headings is noise, and
  // Obsidian has no way to tell a heading you left blank from one you meant to write under.
  for (const [heading, body] of [
    ["Thesis", t.thesis],
    ["Execution", t.execution],
    ["Review", t.review],
    ["Mistakes", t.mistakes],
    ["Emotions", t.emotions],
  ] as [string, string | null][]) {
    if (body && body.trim()) lines.push(`## ${heading}`, "", body.trim(), "");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Whether an existing note is one of ours, and for which trade.
 *
 * Export refuses to touch a file it did not write. Someone's own note that happens to share a
 * filename is not a collision to resolve — it is writing that must not be lost.
 */
export function ownedTradeId(existing: string): string | null {
  const front = existing.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!front) return null;
  const line = front[1].split(/\r?\n/).find((l) => l.startsWith(`${OVERWATCH_KEY}:`));
  if (!line) return null;
  return line.slice(OVERWATCH_KEY.length + 1).trim().replace(/^["']|["']$/g, "") || null;
}
