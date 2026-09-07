"use client";

import React, { useMemo, useRef, useState } from "react";
import { useApp } from "./app-context";
import { Button, EmptyState, Field, Select, useToast } from "./ui";
import { normalizeDate, normalizeTime, parseCsv } from "@/lib/csv";
import { RESULT_CODES, ResultCode } from "@/lib/types";
import { api } from "@/lib/client";
import { money } from "@/lib/format";

const TARGETS: { key: string; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "time", label: "Time" },
  { key: "instrument", label: "Instrument", required: true },
  { key: "direction", label: "Direction" },
  { key: "session", label: "Session" },
  { key: "strategy", label: "Strategy" },
  { key: "setup", label: "Setup" },
  { key: "entry", label: "Entry" },
  { key: "stop", label: "Stop loss" },
  { key: "target", label: "Take profit" },
  { key: "exit", label: "Exit" },
  { key: "size", label: "Position size" },
  { key: "riskAmount", label: "Risk $" },
  { key: "riskPct", label: "Risk %" },
  { key: "result", label: "Result" },
  { key: "pnl", label: "P&L" },
  { key: "rMultiple", label: "R multiple" },
  { key: "mae", label: "MAE (R)" },
  { key: "mfe", label: "MFE (R)" },
  { key: "fees", label: "Fees" },
  { key: "thesis", label: "Thesis note" },
  { key: "execution", label: "Execution note" },
  { key: "review", label: "Review note" },
  { key: "mistakes", label: "Mistakes note" },
  { key: "emotions", label: "Emotions note" },
];

const AUTO: Record<string, string[]> = {
  date: ["date", "opendate", "entrydate", "tradedate", "day", "openedat", "datetime"],
  time: ["time", "entrytime", "opentime"],
  instrument: ["instrument", "symbol", "ticker", "market", "pair", "asset"],
  direction: ["direction", "side", "type", "longshort", "position"],
  session: ["session", "killzone"],
  strategy: ["strategy", "system", "playbook"],
  setup: ["setup", "pattern", "model"],
  entry: ["entry", "entryprice", "openprice", "priceentry", "avgentry"],
  stop: ["stop", "stoploss", "sl", "stopprice"],
  target: ["target", "takeprofit", "tp", "targetprice"],
  exit: ["exit", "exitprice", "closeprice", "avgexit", "close"],
  size: ["size", "quantity", "qty", "contracts", "lots", "volume"],
  riskAmount: ["risk", "riskamount", "riskdollar", "risk$", "amountrisked"],
  riskPct: ["riskpct", "riskpercent", "risk%"],
  result: ["result", "outcome", "status", "wl"],
  pnl: ["pnl", "profit", "netpnl", "pl", "realizedpnl", "netprofit", "profitloss", "grossp&l", "net"],
  rMultiple: ["r", "rmultiple", "rr", "rvalue", "rmult"],
  mae: ["mae", "maxadverse", "maxadverseexcursion"],
  mfe: ["mfe", "maxfavorable", "maxfavourable", "maxfavorableexcursion"],
  fees: ["fees", "commission", "commissions", "cost"],
  thesis: ["thesis", "plan", "reason", "why"],
  execution: ["execution", "executionnotes"],
  review: ["review", "notes", "note", "comment", "comments", "lesson"],
  mistakes: ["mistakes", "errors"],
  emotions: ["emotions", "psychology", "mindset", "feeling"],
};

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9%$]/g, "");

function autoMap(headers: string[]): Record<string, number | null> {
  const map: Record<string, number | null> = {};
  for (const t of TARGETS) {
    const candidates = AUTO[t.key] ?? [];
    const idx = headers.findIndex((h) => candidates.includes(clean(h)));
    map[t.key] = idx >= 0 ? idx : null;
  }
  // second pass: partial contains
  for (const t of TARGETS) {
    if (map[t.key] !== null) continue;
    const candidates = AUTO[t.key] ?? [];
    const idx = headers.findIndex((h) => candidates.some((c) => clean(h).includes(c)));
    if (idx >= 0 && !Object.values(map).includes(idx)) map[t.key] = idx;
  }
  return map;
}

function parseDirection(v: string): "long" | "short" {
  const s = v.toLowerCase();
  if (["short", "sell", "s", "sold", "-1"].some((x) => s === x || s.includes(x))) return "short";
  return "long";
}

function parseResult(v: string, pnl: number | null, rMultiple: number | null): ResultCode {
  const s = clean(v);
  if (RESULT_CODES.includes(s as ResultCode)) return s as ResultCode;
  if (["win", "won", "w", "tp", "profit", "target"].includes(s)) return "win";
  if (["loss", "lost", "l", "sl", "stopped", "stoploss"].includes(s)) return "loss";
  if (["be", "breakeven", "flat", "scratch"].includes(s)) return "breakeven";
  if (["ep", "earlyprofit", "partial", "partialprofit", "pp"].includes(s)) return s === "pp" || s.startsWith("partial") ? "partial_profit" : "early_profit";
  if (["el", "earlyloss", "partialloss", "pl"].includes(s)) return s === "pl" || s.startsWith("partial") ? "partial_loss" : "early_loss";
  const basis = pnl ?? rMultiple ?? 0;
  if (basis > 0) return "win";
  if (basis < 0) return "loss";
  return "breakeven";
}

const numOrNull = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const t = v.replace(/[$,\s()]/g, "");
  if (!t) return null;
  const negative = /^\(.*\)$/.test(v.trim());
  const n = Number(t);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
};

export function CsvImport() {
  const app = useApp();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ imported: number; skipped: number } | null>(null);

  const onFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      toast("That file does not contain a header row and at least one trade.", "error");
      return;
    }
    const head = parsed[0].map((h) => h.trim());
    setHeaders(head);
    setRows(parsed.slice(1));
    setMap(autoMap(head));
    setReport(null);
  };

  const mapped = useMemo(() => {
    if (!rows) return [];
    const get = (row: string[], key: string) => {
      const idx = map[key];
      return idx === null || idx === undefined ? undefined : row[idx];
    };
    return rows.map((row) => {
      const pnl = numOrNull(get(row, "pnl"));
      const rMultiple = numOrNull(get(row, "rMultiple"));
      const rawDate = get(row, "date") ?? "";
      return {
        date: normalizeDate(rawDate),
        time: normalizeTime(get(row, "time") ?? rawDate) ?? null,
        instrument: (get(row, "instrument") ?? "").trim(),
        direction: parseDirection(get(row, "direction") ?? ""),
        session: get(row, "session")?.trim() || null,
        strategy: get(row, "strategy")?.trim() || null,
        setup: get(row, "setup")?.trim() || null,
        entry: numOrNull(get(row, "entry")),
        stop: numOrNull(get(row, "stop")),
        target: numOrNull(get(row, "target")),
        exit: numOrNull(get(row, "exit")),
        size: numOrNull(get(row, "size")),
        riskAmount: numOrNull(get(row, "riskAmount")),
        riskPct: numOrNull(get(row, "riskPct")),
        result: parseResult(get(row, "result") ?? "", pnl, rMultiple),
        pnl: pnl ?? 0,
        rMultiple,
        mae: numOrNull(get(row, "mae")),
        mfe: numOrNull(get(row, "mfe")),
        fees: numOrNull(get(row, "fees")),
        thesis: get(row, "thesis")?.trim() || null,
        execution: get(row, "execution")?.trim() || null,
        review: get(row, "review")?.trim() || null,
        mistakes: get(row, "mistakes")?.trim() || null,
        emotions: get(row, "emotions")?.trim() || null,
      };
    });
  }, [rows, map]);

  const invalid = mapped.filter((r) => !r.date || !r.instrument).length;

  const runImport = async () => {
    if (!app.accounts.length) return;
    const accountId = app.accountId === "all" ? app.accounts[0].id : app.accountId;
    setBusy(true);
    try {
      const valid = mapped.filter((r) => r.date && r.instrument);
      const res = await api.importTrades(accountId, valid as unknown as Record<string, unknown>[]);
      await app.refresh();
      setReport({ imported: res.imported, skipped: res.skipped + invalid });
      toast(`Imported ${res.imported} trades`, "success");
      setRows(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      toast(e instanceof Error ? e.message : "Import failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <Button onClick={() => fileRef.current?.click()}>Choose CSV file</Button>
        <a href={`/api/trades/export?accountId=${encodeURIComponent(app.accountId || "all")}`} download>
          <Button variant="ghost">Export all trades</Button>
        </a>
        <span className="text-body text-ink-3">
          Imports go to {app.accountId === "all" ? app.accounts[0]?.name ?? "the first account" : app.account?.name}.
        </span>
      </div>

      {report && (
        <div className="border border-line rounded-sm px-3 py-2 text-body">
          Imported <span className="text-pos tnum">{report.imported}</span> trades
          {report.skipped > 0 && (
            <>
              {" "}
              · skipped <span className="text-neg tnum">{report.skipped}</span> rows that were missing a valid date or instrument
            </>
          )}
          .
        </div>
      )}

      {!rows ? (
        <EmptyState
          compact
          title="No file loaded"
          body="Choose a CSV exported from your broker, spreadsheet or backtesting engine. You will be able to map its columns and preview the result before anything is written."
        />
      ) : (
        <>
          <div>
            <div className="text-body font-medium mb-2">Map columns</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TARGETS.map((t) => (
                <Field key={t.key} label={`${t.label}${t.required ? " *" : ""}`}>
                  <Select
                    value={map[t.key] ?? ""}
                    onChange={(e) => setMap((m) => ({ ...m, [t.key]: e.target.value === "" ? null : Number(e.target.value) }))}
                  >
                    <option value="">— not mapped —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-body font-medium">Preview</div>
              <div className="text-caption text-ink-3">
                {mapped.length} rows · {invalid > 0 && <span className="text-neg">{invalid} will be skipped</span>}
              </div>
            </div>
            <div className="border border-line rounded-sm overflow-x-auto">
              <table className="w-full text-body" style={{ minWidth: 700 }}>
                <thead>
                  <tr className="text-ink-3 border-b border-line-soft">
                    {["Date", "Time", "Instrument", "Side", "Result", "R", "P&L"].map((h) => (
                      <th key={h} className="text-left font-normal text-caption uppercase tracking-[0.05em] px-3 py-1.5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mapped.slice(0, 8).map((r, i) => (
                    <tr key={i} className="border-b border-line-soft last:border-0">
                      <td className={`px-3 py-1.5 tnum ${r.date ? "" : "text-neg"}`}>{r.date ?? "invalid"}</td>
                      <td className="px-3 py-1.5 tnum text-ink-3">{r.time ?? "—"}</td>
                      <td className={`px-3 py-1.5 ${r.instrument ? "" : "text-neg"}`}>{r.instrument || "missing"}</td>
                      <td className={`px-3 py-1.5 ${r.direction === "long" ? "text-pos" : "text-neg"}`}>{r.direction}</td>
                      <td className="px-3 py-1.5 text-ink-2">{r.result}</td>
                      <td className="px-3 py-1.5 tnum text-ink-2">{r.rMultiple ?? "—"}</td>
                      <td className={`px-3 py-1.5 tnum ${r.pnl > 0 ? "text-pos" : r.pnl < 0 ? "text-neg" : "text-ink-3"}`}>
                        {money(r.pnl, app.currency, { sign: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={runImport} disabled={busy || mapped.length === invalid}>
              {busy ? "Importing…" : `Import ${mapped.length - invalid} trades`}
            </Button>
            <Button onClick={() => setRows(null)}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  );
}
