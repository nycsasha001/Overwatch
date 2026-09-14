"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { RESULT_SHORT, Trade } from "@/lib/types";
import { fmtDateShort, money, num, r as fmtR } from "@/lib/format";
import { useApp } from "./app-context";
import { useTradeEditor } from "./trade-editor";
import { ConfirmDialog, useToast } from "./ui";
import { api } from "@/lib/client";
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
  const toast = useToast();
  /**
   * The trade the delete button was pressed on, held until it is confirmed.
   *
   * Never deletes on the click itself. The button sits inches from the row that opens the trade,
   * on rows that all look alike, and a trade carries journal notes that exist nowhere else — so
   * the destructive step is always the second one, on a dialog that names what is about to go.
   */
  const [pendingDelete, setPendingDelete] = useState<Trade | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await api.deleteTrade(pendingDelete.id);
      await app.refresh();
      toast(`Deleted ${pendingDelete.instrument} on ${fmtDateShort(pendingDelete.date)}`, "success");
      setPendingDelete(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete the trade", "error");
    } finally {
      setDeleting(false);
    }
  };
  /**
   * A P&L column with nothing in it is worse than no column, so it goes when every trade on show
   * is from a backtest — which covers both a backtest account on its own and an all-accounts view
   * that happens to hold only backtests. In a mixed list the column stays and those rows read "—",
   * which is the honest answer: the trade has no P&L, rather than a P&L of zero.
   */
  const allROnly = trades.length > 0 && trades.every((t) => app.isRAccount(t.accountId));
  const cols = COLS.filter((c) => !hideColumns.includes(c.key) && !(c.key === "pnl" && allROnly));

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
                        className={`px-3 py-[7px] text-right tnum ${
                          app.isRAccount(t.accountId) ? "text-ink-3" : t.pnl > 0 ? "text-pos" : t.pnl < 0 ? "text-neg" : "text-ink-3"
                        }`}
                        title={app.isRAccount(t.accountId) ? "Backtest — scored in R only" : undefined}
                      >
                        {app.isRAccount(t.accountId) ? "—" : money(t.pnl, app.currency, { sign: true })}
                      </td>
                    );
                  default:
                    return null;
                }
              })}
              <td className="px-2 py-[7px] text-right whitespace-nowrap">
                <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      editor.open(t);
                    }}
                    className="text-ink-3 hover:text-ink text-caption px-1.5 py-0.5 rounded-xs border border-line"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => {
                      // Without this the row's own click handler also fires and opens the trade
                      // behind the dialog.
                      e.stopPropagation();
                      setPendingDelete(t);
                    }}
                    aria-label={`Delete the ${t.instrument} trade on ${fmtDateShort(t.date)}`}
                    title="Delete this trade"
                    className="text-ink-3 hover:text-neg hover:border-neg/40 px-1.5 py-[3px] rounded-xs border border-line"
                  >
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 3.5h9M5.5 3.5V2.25h3V3.5M3.75 3.5l.5 8a1 1 0 0 0 1 1h3.5a1 1 0 0 0 1-1l.5-8M5.9 5.8v4.4M8.1 5.8v4.4"
                        stroke="currentColor"
                        strokeWidth="1.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this trade?"
        /* Names the specific trade: the rows look alike, and the dialog is the last chance to
           notice it is the wrong one. */
        body={
          pendingDelete
            ? `${pendingDelete.direction === "long" ? "Long" : "Short"} ${pendingDelete.instrument} on ` +
              `${fmtDateShort(pendingDelete.date)}${pendingDelete.time ? ` at ${pendingDelete.time}` : ""}` +
              `${pendingDelete.rMultiple !== null ? ` · ${fmtR(pendingDelete.rMultiple)}` : ""}. ` +
              "Its journal notes and any screenshots are deleted with it, and this cannot be undone."
            : ""
        }
        confirmLabel={deleting ? "Deleting…" : "Delete trade"}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
