"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { RESULT_SHORT, Trade } from "@/lib/types";
import { fmtDateShort, money, num, r as fmtR } from "@/lib/format";
import { useApp } from "./app-context";
import { useTradeEditor } from "./trade-editor";
import { classify } from "@/lib/stats";

export function ResultBadge({ trade }: { trade: Trade }) {
  const { settings } = useApp();
  const cls = classify(trade.result, settings);
  const tone =
    cls === "win" ? "text-pos border-pos/30 bg-pos/8" : cls === "loss" ? "text-neg border-neg/30 bg-neg/8" : "text-ink-3 border-line";
  return (
    <span className={`inline-flex items-center justify-center h-[18px] min-w-[24px] px-1 rounded-xs border text-micro font-medium ${tone}`}>
      {RESULT_SHORT[trade.result]}
    </span>
  );
}

export function DirectionMark({ direction }: { direction: "long" | "short" }) {
  return (
    <span className={`text-caption ${direction === "long" ? "text-pos" : "text-neg"}`}>
      {direction === "long" ? "Long" : "Short"}
    </span>
  );
}

const COLS = [
  { key: "date", label: "Date", w: "92px" },
  { key: "time", label: "Time", w: "56px" },
  { key: "instrument", label: "Instrument", w: "92px" },
  { key: "direction", label: "Side", w: "62px" },
  { key: "setup", label: "Setup", w: "auto" },
  { key: "entry", label: "Entry", w: "82px" },
  { key: "stop", label: "Stop", w: "82px" },
  { key: "target", label: "TP", w: "82px" },
  { key: "result", label: "Result", w: "58px" },
  { key: "r", label: "R", w: "68px" },
  { key: "pnl", label: "P&L", w: "94px" },
] as const;

export function TradeTable({
  trades,
  compact = false,
  hideColumns = [],
  emptyMessage = "No trades match the current filters.",
}: {
  trades: Trade[];
  compact?: boolean;
  hideColumns?: string[];
  emptyMessage?: string;
}) {
  const router = useRouter();
  const app = useApp();
  const editor = useTradeEditor();
  const cols = COLS.filter((c) => !hideColumns.includes(c.key));

  if (!trades.length) {
    return <div className="px-4 py-8 text-center text-body text-ink-3">{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body" style={{ minWidth: compact ? 620 : 860 }}>
        <thead>
          <tr className="text-ink-3 border-b border-line-soft">
            {cols.map((c) => (
              <th
                key={c.key}
                className={`font-normal text-caption uppercase tracking-[0.05em] px-3 py-2 ${
                  ["entry", "stop", "target", "r", "pnl"].includes(c.key) ? "text-right" : "text-left"
                }`}
                style={{ width: c.w }}
              >
                {c.label}
              </th>
            ))}
            <th className="w-[64px]" />
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr
              key={t.id}
              onClick={() => router.push(`/journal/${t.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter") router.push(`/journal/${t.id}`);
              }}
              tabIndex={0}
              role="link"
              aria-label={`Open journal entry for ${t.instrument} on ${t.date}`}
              className="border-b border-line-soft last:border-0 hover:bg-hover/60 focus:bg-hover cursor-pointer group outline-none"
            >
              {cols.map((c) => {
                switch (c.key) {
                  case "date":
                    return (
                      <td key={c.key} className="px-3 py-[7px] tnum text-ink-2">
                        {fmtDateShort(t.date)}
                      </td>
                    );
                  case "time":
                    return (
                      <td key={c.key} className="px-3 py-[7px] tnum text-ink-3">
                        {t.time ?? "—"}
                      </td>
                    );
                  case "instrument":
                    return (
                      <td key={c.key} className="px-3 py-[7px] font-medium">
                        {t.instrument}
                      </td>
                    );
                  case "direction":
                    return (
                      <td key={c.key} className="px-3 py-[7px]">
                        <DirectionMark direction={t.direction} />
                      </td>
                    );
                  case "setup":
                    return (
                      <td key={c.key} className="px-3 py-[7px] text-ink-2 truncate max-w-[220px]">
                        {t.setup ?? t.strategy ?? <span className="text-ink-3">—</span>}
                      </td>
                    );
                  case "entry":
                  case "stop":
                  case "target":
                    return (
                      <td key={c.key} className="px-3 py-[7px] text-right tnum text-ink-2">
                        {t[c.key] === null ? "—" : num(t[c.key] as number, 2)}
                      </td>
                    );
                  case "result":
                    return (
                      <td key={c.key} className="px-3 py-[7px]">
                        <ResultBadge trade={t} />
                      </td>
                    );
                  case "r":
                    return (
                      <td
                        key={c.key}
                        className={`px-3 py-[7px] text-right tnum ${
                          (t.rMultiple ?? 0) > 0 ? "text-pos" : (t.rMultiple ?? 0) < 0 ? "text-neg" : "text-ink-3"
                        }`}
                      >
                        {t.rMultiple === null ? "—" : fmtR(t.rMultiple, 2)}
                      </td>
                    );
                  case "pnl":
                    return (
                      <td
                        key={c.key}
                        className={`px-3 py-[7px] text-right tnum ${t.pnl > 0 ? "text-pos" : t.pnl < 0 ? "text-neg" : "text-ink-3"}`}
                      >
                        {money(t.pnl, app.currency, { sign: true })}
                      </td>
                    );
                  default:
                    return null;
                }
              })}
              <td className="px-2 py-[7px] text-right">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    editor.open(t);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-ink text-caption px-1.5 py-0.5 rounded-xs border border-line transition-opacity"
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
