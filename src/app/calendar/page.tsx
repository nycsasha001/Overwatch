"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/app-context";
import { useFilters } from "@/components/filter-context";
import { Page, PageHeader } from "@/components/shell";
import { Button, EmptyState, Panel } from "@/components/ui";
import { Stat, StatRow } from "@/components/stat";
import { dailySummaries } from "@/lib/stats";
import { fmtDate, isoDate, money, monthLabel, pct, r as fmtR } from "@/lib/format";
import { ResultBadge } from "@/components/trade-table";
import { useTradeEditor } from "@/components/trade-editor";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const app = useApp();
  const { applyNonDate } = useFilters();
  const editor = useTradeEditor();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState<string | null>(null);

  // The calendar owns its own date range, so only non-date filters apply here.
  const trades = useMemo(() => applyNonDate(app.trades), [applyNonDate, app.trades]);
  const days = useMemo(() => dailySummaries(trades, app.settings), [trades, app.settings]);

  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const weeks: { date: Date; iso: string; inMonth: boolean }[][] = [];
    const cur = new Date(start);
    for (let w = 0; w < 6; w++) {
      const row: { date: Date; iso: string; inMonth: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        row.push({ date: new Date(cur), iso: isoDate(cur), inMonth: cur.getMonth() === cursor.m });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(row);
      if (cur.getMonth() !== cursor.m && w >= 4) break;
    }
    return weeks;
  }, [cursor]);

  const monthStats = useMemo(() => {
    const prefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
    let pnl = 0,
      rTotal = 0,
      n = 0,
      green = 0,
      red = 0,
      wins = 0,
      losses = 0;
    for (const [date, d] of days) {
      if (!date.startsWith(prefix)) continue;
      pnl += d.pnl;
      rTotal += d.r;
      n += d.trades;
      wins += d.wins;
      losses += d.losses;
      if (d.pnl > 0) green++;
      else if (d.pnl < 0) red++;
    }
    return { pnl, r: rTotal, n, green, red, winRate: wins + losses ? (wins / (wins + losses)) * 100 : null };
  }, [days, cursor]);

  const step = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  const day = selected ? days.get(selected) : undefined;

  return (
    <Page>
      <PageHeader
        title="Calendar"
        meta={`${app.accountId === "all" ? "All accounts" : app.account?.name} · daily performance`}
        actions={
          <div className="flex items-center gap-1.5">
            <Button onClick={() => step(-1)} aria-label="Previous month">
              ←
            </Button>
            <span className="text-ui w-[124px] text-center tabular-nums">{monthLabel(cursor.y, cursor.m)}</span>
            <Button onClick={() => step(1)} aria-label="Next month">
              →
            </Button>
            <Button onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>Today</Button>
          </div>
        }
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_330px] items-start">
        <div className="grid gap-3">
          <Panel title={`${monthLabel(cursor.y, cursor.m)} summary`}>
            <StatRow cols={6}>
              <Stat label="Net P&L" value={money(monthStats.pnl, app.currency, { sign: true })} tone={monthStats.pnl > 0 ? "pos" : monthStats.pnl < 0 ? "neg" : "flat"} />
              <Stat label="Net R" value={fmtR(monthStats.r)} tone={monthStats.r > 0 ? "pos" : monthStats.r < 0 ? "neg" : "flat"} />
              <Stat label="Trades" value={monthStats.n} />
              <Stat label="Win rate" value={pct(monthStats.winRate)} />
              <Stat label="Green days" value={monthStats.green} tone={monthStats.green ? "pos" : "flat"} />
              <Stat label="Red days" value={monthStats.red} tone={monthStats.red ? "neg" : "flat"} />
            </StatRow>
          </Panel>

          <Panel flush>
            <div className="grid grid-cols-7 border-b border-line-soft">
              {DOW.map((d) => (
                <div key={d} className="px-2 py-1.5 eyebrow text-center">
                  {d}
                </div>
              ))}
            </div>
            <div>
              {grid.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 border-b border-line-soft last:border-0">
                  {week.map((cell) => {
                    const d = days.get(cell.iso);
                    const isToday = cell.iso === isoDate(today);
                    const tone = !d || d.trades === 0 ? "none" : d.pnl > 0 ? "pos" : d.pnl < 0 ? "neg" : "flat";
                    return (
                      <button
                        key={cell.iso}
                        onClick={() => setSelected(cell.iso)}
                        className={`relative text-left h-[92px] p-2 border-r border-line-soft last:border-r-0 transition-colors ${
                          cell.inMonth ? "" : "opacity-35"
                        } ${selected === cell.iso ? "bg-hover" : "hover:bg-hover/50"} ${
                          tone === "pos" ? "bg-pos/[0.055]" : tone === "neg" ? "bg-neg/[0.055]" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-caption tnum ${isToday ? "text-accent font-medium" : cell.inMonth ? "text-ink-2" : "text-ink-3"}`}>
                            {cell.date.getDate()}
                          </span>
                          {tone !== "none" && (
                            <span className={`w-[5px] h-[5px] rounded-full ${tone === "pos" ? "bg-pos" : tone === "neg" ? "bg-neg" : "bg-ink-3"}`} />
                          )}
                        </div>
                        {d && d.trades > 0 && (
                          <div className="mt-2">
                            <div className={`text-ui tnum font-medium ${d.pnl > 0 ? "text-pos" : d.pnl < 0 ? "text-neg" : "text-ink-2"}`}>
                              {money(d.pnl, app.currency, { sign: true, compact: true })}
                            </div>
                            <div className="text-caption tnum text-ink-3">{fmtR(d.r, 1)}</div>
                            <div className="text-caption text-ink-3">
                              {d.trades} trade{d.trades > 1 ? "s" : ""}
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <Panel title={day ? fmtDate(day.date) : selected ? fmtDate(selected) : "Select a day"} className="sticky top-4">
          {!selected ? (
            <p className="text-body text-ink-3 leading-relaxed">
              Click any day in the calendar to see its summary and every trade taken that session.
            </p>
          ) : !day || !day.trades ? (
            <EmptyState
              compact
              title="No trades on this day"
              body="Nothing was recorded for this date."
              action={
                <Button onClick={() => editor.open(null, { date: selected })}>Log a trade for this day</Button>
              }
            />
          ) : (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Stat label="Net P&L" value={money(day.pnl, app.currency, { sign: true })} tone={day.pnl > 0 ? "pos" : day.pnl < 0 ? "neg" : "flat"} />
                <Stat label="Net R" value={fmtR(day.r)} tone={day.r > 0 ? "pos" : day.r < 0 ? "neg" : "flat"} />
                <Stat label="Trades" value={day.trades} sub={`${day.wins}W · ${day.losses}L${day.breakevens ? ` · ${day.breakevens}BE` : ""}`} />
                <Stat label="Win rate" value={pct(day.winRate)} />
                <Stat label="Average R" value={fmtR(day.avgR)} tone={(day.avgR ?? 0) > 0 ? "pos" : (day.avgR ?? 0) < 0 ? "neg" : "flat"} />
                <Stat
                  label="Best / worst"
                  value={day.best ? money(day.best.pnl, app.currency, { sign: true }) : "—"}
                  sub={day.worst ? money(day.worst.pnl, app.currency) : undefined}
                />
              </div>

              <div className="h-px bg-line-soft" />

              <div className="grid gap-1">
                {day.list.map((t, i) => (
                  <Link
                    key={t.id}
                    href={`/journal/${t.id}`}
                    className="flex items-center gap-2 px-2 py-1.5 -mx-2 rounded-sm hover:bg-hover transition-colors"
                  >
                    <span className="text-caption text-ink-3 tnum w-4">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-body truncate">
                        {t.instrument} <span className={t.direction === "long" ? "text-pos" : "text-neg"}>{t.direction === "long" ? "Long" : "Short"}</span>
                      </div>
                      <div className="text-caption text-ink-3 truncate">
                        {t.time ?? "—"} {t.setup ? `· ${t.setup}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-body tnum ${t.pnl > 0 ? "text-pos" : t.pnl < 0 ? "text-neg" : "text-ink-3"}`}>{fmtR(t.rMultiple, 1)}</div>
                      <div className="text-caption tnum text-ink-3">{money(t.pnl, app.currency, { sign: true, compact: true })}</div>
                    </div>
                    <ResultBadge trade={t} />
                  </Link>
                ))}
              </div>

              <Button onClick={() => editor.open(null, { date: selected })}>Add trade on this day</Button>
            </div>
          )}
        </Panel>
      </div>
    </Page>
  );
}
