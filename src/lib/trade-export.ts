import { RESULT_LABEL, type ResultCode, type Settings, type Trade } from "./types";
import { WEEKDAYS, chronological, classify, computeMetrics, groupBy, hourBucket, weekdayOf } from "./stats";
import { setupParts } from "./obsidian";
import { toCsv } from "./csv";
import { money, pct, r as fmtR } from "./format";

/**
 * Trades packaged for someone else to analyse, most often Claude.
 *
 * A spreadsheet alone is not enough for that. A reader who was not there does not know what R is
 * measured against, that MAE is in R rather than points, how a break-even counts toward the win
 * rate, or that a backtest's P&L column is zero because it does not apply rather than because
 * nothing was made. So the export is three things that travel together:
 *
 *   report.md    the numbers explained, the summary, the breakdowns, and every trade with its notes
 *   trades.csv   the same trades, one row each, for anything that wants to count
 *   screenshots/ the chart picture saved with each trade, named after the trade it belongs to
 *
 * Pure: no filesystem and no clock. The route reads the images and the date and hands them in, so
 * the exact text a reader will see can be tested.
 */

/** Columns of the CSV export, in order. The plain "Export CSV" button uses the same list. */
export const TRADE_CSV_COLUMNS = [
  "date", "time", "instrument", "direction", "session", "strategy", "setup", "entry", "stop", "target", "exit", "size",
  "riskAmount", "riskPct", "result", "pnl", "rMultiple", "plannedRr", "mae", "mfe", "fees", "htfSweep", "sweep4h",
  "sweep1h", "sweep15m", "sessionSweep", "mss", "fvg", "orderBlock", "displacement", "pdArray", "entryModel",
  "liquidityTarget", "tags", "thesis", "execution", "review", "mistakes", "emotions",
] as const;

/** Columns that hold money. Left out of a backtest's CSV, where they are all empty or zero. */
const MONEY_COLUMNS = new Set<string>(["size", "riskAmount", "riskPct", "pnl", "fees"]);

/** One trade field as a CSV cell. Lists are joined with `|` so they stay in one column. */
export function csvCell(t: Trade, column: string): string | number {
  const v = (t as unknown as Record<string, unknown>)[column];
  if (Array.isArray(v)) return v.join("|");
  if (v === null || v === undefined) return "";
  return v as string | number;
}

export interface BundleOptions {
  settings: Settings;
  /** Account name by account id. */
  accountNames: Map<string, string>;
  /** Every trade is on an account that records R and no money: a backtest. */
  rOnly: boolean;
  /** The trades are what the journal's filters left in view, not everything on the account. */
  filtered: boolean;
  /** YYYY-MM-DD. Passed in rather than read from the clock. */
  exportedOn: string;
}

/** A screenshot to copy into the archive: the stored file, and where it goes. */
export interface BundleShot {
  tradeId: string;
  filename: string;
  path: string;
}

export interface Bundle {
  report: string;
  csv: string;
  screenshots: BundleShot[];
}

/** Anything that needs escaping inside a markdown table, and line breaks folded to spaces. */
const cell = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === "" ? "—" : String(v).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

function table(head: string[], rows: (string | number | null | undefined)[][]): string {
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

/** An R value with no sign, for distances rather than results: planned RR, MAE, MFE. */
const rDistance = (v: number | null): string => (v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}R`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const weekdayShort = (date: string) => WEEKDAYS[weekdayOf(date)].slice(0, 3);
const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * The stop sits at or past the entry: it was moved, to break-even or beyond, before the trade
 * closed. The journal keeps the stop where it ended, so the entry-to-stop distance on such a trade
 * is not the risk that was taken, and must not be presented as if it were.
 */
const stopMoved = (t: Trade): boolean =>
  t.entry !== null && t.stop !== null && (t.direction === "long" ? t.stop >= t.entry : t.stop <= t.entry);

/** "01_2023-02-09_0954_MNQ_long": the trade's number first, so the folder sorts the way the report reads. */
function shotBase(t: Trade, number: string): string {
  const time = (t.time ?? "").replace(":", "") || "0000";
  const instrument = t.instrument.replace(/[^A-Za-z0-9.-]/g, "-");
  return `${number}_${t.date}_${time}_${instrument}_${t.direction}`;
}

export function exportBundle(input: Trade[], opts: BundleOptions): Bundle {
  const trades = chronological(input);
  const { settings, rOnly } = opts;
  const currency = settings.currency;
  const width = String(trades.length).length;
  const numberOf = new Map(trades.map((t, i) => [t.id, String(i + 1).padStart(width, "0")]));
  const accountOf = (t: Trade) => opts.accountNames.get(t.accountId) ?? "Unknown account";
  const accounts = [...new Set(trades.map(accountOf))];
  const multiAccount = accounts.length > 1;

  // Screenshots are named after the trade, so a picture is never separated from the row it shows.
  const screenshots: BundleShot[] = [];
  const shotsOf = new Map<string, string[]>();
  for (const t of trades) {
    const base = shotBase(t, numberOf.get(t.id)!);
    const paths = (t.screenshots ?? []).map((s, i) => {
      const ext = /\.[A-Za-z0-9]+$/.exec(s.filename)?.[0].toLowerCase() ?? ".png";
      const path = `screenshots/${base}${i ? `_${i + 1}` : ""}${ext}`;
      screenshots.push({ tradeId: t.id, filename: s.filename, path });
      return path;
    });
    shotsOf.set(t.id, paths);
  }

  const m = computeMetrics(trades, settings);
  const lines: string[] = [];
  const push = (...xs: string[]) => lines.push(...xs);

  /* ---------------------------------- intro ---------------------------------- */

  push(`# ${multiAccount ? "Trades" : accounts[0]} — trade export`, "");
  const first = trades[0]?.date;
  const last = trades[trades.length - 1]?.date;
  push(
    `Exported from Overwatch, a trading journal, on ${opts.exportedOn}. ` +
      `${plural(trades.length, "trade")}${first ? ` from ${first} to ${last}` : ""}, ` +
      (multiAccount
        ? `across ${accounts.length} accounts (${accounts.join(", ")}).`
        : `all on the "${accounts[0] ?? "Unknown"}" account.`),
    ""
  );
  if (rOnly) {
    push(
      "These are backtests. Every result is measured in R, meaning multiples of the amount risked. " +
        "There is no money, position size or P&L, because none of those apply to a backtest.",
      ""
    );
  }
  if (opts.filtered) {
    push(
      "This is a filtered selection, not every trade on the account. It holds only the trades that matched " +
        "the journal's filters and search when it was exported.",
      ""
    );
  }
  push(
    "Alongside this report, `trades.csv` has the same trades, one row each, for anything that needs counting." +
      (screenshots.length
        ? " The `screenshots` folder holds the chart picture saved with each trade. Each trade below names its own file, and the file name starts with the trade's number."
        : ""),
    ""
  );

  /* ------------------------------ field guide ------------------------------ */

  const present = [...new Set(trades.map((t) => t.result))] as ResultCode[];
  const counting = present.map((code) => {
    const cls = classify(code, settings);
    return cls === "excluded"
      ? `${RESULT_LABEL[code]} is left out of the statistics`
      : `${RESULT_LABEL[code]} counts as a ${cls === "breakeven" ? "break-even" : cls}`;
  });

  push(
    "## How to read the numbers",
    "",
    "- **R** is the result as a multiple of the risk taken, which is the distance from entry to stop. −1R is a full stop-out, and +2R made twice what was risked.",
    "- **Stop** is where the stop sat when the trade closed. A stop that was moved before the close, to break-even for example, sits at or past the entry and is marked as moved. For trades taken in Overwatch's replay, R, MAE and MFE are measured against the original stop, not the moved one.",
    "- **Planned RR** is reward to risk as planned at entry: the distance to the target divided by the distance to the stop.",
    "- **MAE / MFE** are the maximum adverse and favourable excursion: how far price went against the trade, and how far in its favour, while it was open. Both are in R. A trade with an MFE of 1.9R that closed at +0.5R gave back 1.4R.",
    `- **Result** is how the trade was classified. ${counting.join("; ")}. Break-evens are ${
      settings.breakevenInWinRate ? "" : "not "
    }counted in the win rate's denominator.`,
    "- **Confluence** lists the checklist boxes ticked on the trade: sweeps, market structure shift (MSS), fair value gap (FVG), order block, displacement.",
    "- **Times** are as written in the journal. Trades taken in Overwatch's replay are in New York time.",
    ""
  );

  /* -------------------------------- summary -------------------------------- */

  const counts = [plural(m.wins, "win"), plural(m.losses, "loss", "losses"), `${m.breakevens} break-even`];
  if (m.excluded) counts.push(`${m.excluded} excluded`);
  const maes = trades.map((t) => t.mae).filter((v): v is number => v !== null);
  const mfes = trades.map((t) => t.mfe).filter((v): v is number => v !== null);
  const summary: [string, string][] = [
    ["Trades", `${trades.length} (${counts.join(", ")})`],
    ["Win rate", pct(m.winRate)],
    ["Net R", fmtR(m.netR)],
    ["Average R per trade (expectancy)", fmtR(m.expectancyR)],
    ["Median R", fmtR(m.medianR)],
    ["Average win / average loss", `${fmtR(m.avgWinR)} / ${fmtR(m.avgLossR)}`],
    ["Largest win / largest loss", `${fmtR(m.largestWinR)} / ${fmtR(m.largestLossR)}`],
    ["Profit factor (R)", m.profitFactorR === null ? "—" : m.profitFactorR.toFixed(2)],
    ["Average planned RR", rDistance(m.avgPlannedRr)],
    ["Win rate needed to break even at that RR", pct(m.breakevenWinRate)],
    [
      "Win rate minus that break-even rate",
      m.winRateEdge === null ? "—" : `${m.winRateEdge > 0 ? "+" : ""}${m.winRateEdge.toFixed(1)} points`,
    ],
    ["Max drawdown", rDistance(m.maxDrawdownR)],
    ["Average MAE / average MFE", `${rDistance(average(maes))} / ${rDistance(average(mfes))}`],
    [
      "Best day / worst day",
      m.bestDayR && m.worstDayR
        ? `${fmtR(m.bestDayR.r)} on ${m.bestDayR.date} / ${fmtR(m.worstDayR.r)} on ${m.worstDayR.date}`
        : "—",
    ],
  ];
  if (!rOnly) {
    summary.push(
      ["Net P&L", money(m.netPnl, currency, { sign: true })],
      ["Max drawdown (money)", money(m.maxDrawdown, currency)]
    );
  }
  push("## Summary", "", table(["", ""], summary), "");

  /* ------------------------------- breakdowns ------------------------------- */

  const dimensions: [string, (t: Trade) => string | null][] = [
    ["Setup", (t) => t.setup],
    ["Session", (t) => t.session],
    ["Strategy", (t) => t.strategy],
    ["Entry model", (t) => t.entryModel],
    ["PD array", (t) => t.pdArray],
    ["Liquidity target", (t) => t.liquidityTarget],
    ["Direction", (t) => t.direction],
    ["Weekday", (t) => WEEKDAYS[weekdayOf(t.date)]],
    ["Hour", hourBucket],
    ...(multiAccount ? ([["Account", accountOf]] as [string, (t: Trade) => string | null][]) : []),
  ];
  const breakdowns: string[] = [];
  for (const [label, key] of dimensions) {
    const buckets = groupBy(trades, settings, key);
    // A field every trade shares tells a reader nothing the summary did not.
    if (buckets.length < 2) continue;
    const head = [label, "Trades", "W / L / BE", "Win rate", "Net R", "Avg R", ...(rOnly ? [] : ["Net P&L"])];
    const rows = buckets.map((b) => [
      b.label,
      b.trades.length,
      `${b.metrics.wins} / ${b.metrics.losses} / ${b.metrics.breakevens}`,
      pct(b.metrics.winRate),
      fmtR(b.metrics.netR),
      fmtR(b.metrics.avgR),
      ...(rOnly ? [] : [money(b.metrics.netPnl, currency, { sign: true })]),
    ]);
    breakdowns.push(`### By ${label.toLowerCase()}`, "", table(head, rows), "");
  }
  if (breakdowns.length) {
    push(
      "## Breakdowns",
      "",
      "Each table groups the trades by one field, best net R first. A field where every trade has the same value is left out. A dash means the field was left blank.",
      "",
      ...breakdowns
    );
  }

  /* ------------------------------- all trades ------------------------------- */

  const listHead = [
    "#", "Date", "Time", "Dir", "Session", "Setup", "Entry", "Stop", "Target", "Exit", "Planned RR", "Result", "R", "MAE", "MFE",
    ...(rOnly ? [] : ["P&L"]),
    ...(multiAccount ? ["Account"] : []),
  ];
  const listRows = trades.map((t) => [
    numberOf.get(t.id),
    `${weekdayShort(t.date)} ${t.date}`,
    t.time,
    t.direction,
    t.session,
    t.setup,
    t.entry,
    stopMoved(t) ? `${t.stop} (moved)` : t.stop,
    t.target,
    t.exit,
    rDistance(t.plannedRr),
    RESULT_LABEL[t.result],
    fmtR(t.rMultiple),
    rDistance(t.mae),
    rDistance(t.mfe),
    ...(rOnly ? [] : [money(t.pnl, currency, { sign: true })]),
    ...(multiAccount ? [accountOf(t)] : []),
  ]);
  push("## All trades", "", table(listHead, listRows), "");

  /* ------------------------------ trade by trade ------------------------------ */

  push("## Trade by trade", "");
  for (const t of trades) {
    const n = numberOf.get(t.id);
    push(
      `### #${n} · ${weekdayShort(t.date)} ${t.date}${t.time ? ` ${t.time}` : ""} · ${
        t.direction === "long" ? "Long" : "Short"
      } ${t.instrument} · ${fmtR(t.rMultiple)} ${RESULT_LABEL[t.result]}`,
      ""
    );
    const moved = stopMoved(t);
    const riskPoints =
      t.entry !== null && t.stop !== null && !moved ? Number(Math.abs(t.entry - t.stop).toFixed(4)) : null;
    const confluence = setupParts(t);
    const shots = shotsOf.get(t.id) ?? [];
    const details: [string, string | number | null][] = [
      ["Account", multiAccount ? accountOf(t) : null],
      ["Session", t.session],
      ["Strategy", t.strategy],
      ["Setup", t.setup],
      ["Entry model", t.entryModel],
      ["PD array", t.pdArray],
      ["Liquidity target", t.liquidityTarget],
      ["Confluence", confluence.length ? confluence.join(", ") : null],
      ["Entry", t.entry],
      [moved ? "Stop (moved to or past entry before the close)" : "Stop", t.stop],
      ["Target", t.target],
      ["Exit", t.exit],
      ["Risk (points, entry to stop)", riskPoints],
      ["Planned RR", t.plannedRr === null ? null : rDistance(t.plannedRr)],
      ["MAE", t.mae === null ? null : rDistance(t.mae)],
      ["MFE", t.mfe === null ? null : rDistance(t.mfe)],
      ["Size", rOnly ? null : t.size],
      ["Risk (money)", rOnly || t.riskAmount === null ? null : money(t.riskAmount, currency)],
      ["P&L", rOnly ? null : money(t.pnl, currency, { sign: true })],
      ["Fees", rOnly || t.fees === null ? null : money(t.fees, currency)],
      ["Tags", t.tags.length ? t.tags.join(", ") : null],
      [shots.length > 1 ? "Screenshots" : "Screenshot", shots.length ? shots.map((p) => `\`${p}\``).join(", ") : null],
    ];
    push(table(["", ""], details.filter(([, v]) => v !== null && v !== "")), "");

    // Only the notes that were written. A heading with nothing under it reads as a note that was lost.
    const notes = (
      [
        ["Thesis", t.thesis],
        ["Execution", t.execution],
        ["Review", t.review],
        ["Mistakes", t.mistakes],
        ["Emotions", t.emotions],
      ] as [string, string | null][]
    ).filter(([, body]) => body && body.trim());
    if (notes.length) for (const [heading, body] of notes) push(`#### ${heading}`, "", body!.trim(), "");
    else push("_No notes written for this trade._", "");
  }

  const report = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

  /* ----------------------------------- csv ----------------------------------- */

  const columns = TRADE_CSV_COLUMNS.filter((c) => !(rOnly && MONEY_COLUMNS.has(c)));
  const csvRows: (string | number)[][] = [["number", "id", "account", "weekday", ...columns, "screenshots"]];
  for (const t of trades) {
    csvRows.push([
      numberOf.get(t.id)!,
      t.id,
      accountOf(t),
      WEEKDAYS[weekdayOf(t.date)],
      ...columns.map((c) => csvCell(t, c)),
      (shotsOf.get(t.id) ?? []).join("|"),
    ]);
  }

  return { report, csv: toCsv(csvRows) + "\n", screenshots };
}
