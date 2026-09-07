"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/app-context";
import { useFilters } from "@/components/filter-context";
import { Page, PageHeader } from "@/components/shell";
import { Panel, Button, EmptyState, Segmented } from "@/components/ui";
import { Stat, StatRow } from "@/components/stat";
import { TradeTable } from "@/components/trade-table";
import { LineChart } from "@/components/charts";
import { computeMetrics, equitySeries } from "@/lib/stats";
import { fmtDateShort, money, num, pct, r as fmtR, toneOf } from "@/lib/format";
import { useTradeEditor } from "@/components/trade-editor";
import { GuardrailsPanel } from "@/components/guardrails-panel";

export default function DashboardPage() {
  const app = useApp();
  const { apply, filters, activeCount, clear } = useFilters();
  const editor = useTradeEditor();
  const [mode, setMode] = useState<"pnl" | "r">("pnl");

  const filtered = useMemo(() => apply(app.trades), [apply, app.trades]);
  const metrics = useMemo(
    () => computeMetrics(filtered, app.settings, app.startingBalance),
    [filtered, app.settings, app.startingBalance]
  );
  // Balance always reflects every trade on the account, not the filtered subset.
  const allTimeMetrics = useMemo(
    () => computeMetrics(app.trades, app.settings, app.startingBalance),
    [app.trades, app.settings, app.startingBalance]
  );
  const currentBalance = app.startingBalance + allTimeMetrics.netPnl;

  const equity = useMemo(
    () => equitySeries(filtered, app.settings, mode === "pnl" ? app.startingBalance : 0),
    [filtered, app.settings, app.startingBalance, mode]
  );

  const points = useMemo(
    () =>
      equity.map((p) => ({
        x: p.index,
        value: mode === "pnl" ? p.equity : p.equityR,
        label: `${fmtDateShort(p.date)} · trade ${p.index}`,
        delta: mode === "pnl" ? p.pnl : p.r,
        sub: p.drawdown < 0 ? `Drawdown ${mode === "pnl" ? money(p.drawdown, app.currency) : fmtR(p.drawdownR)}` : undefined,
      })),
    [equity, mode, app.currency]
  );

  const periodLabel =
    filters.period === "all"
      ? "All time"
      : filters.period === "custom"
      ? "Custom range"
      : { today: "Today", week: "This week", month: "This month", year: "This year" }[filters.period];

  if (!app.trades.length) {
    return (
      <Page>
        <PageHeader title="Dashboard" meta={app.account?.name ?? "All accounts"} />
        <Panel>
          <EmptyState
            title="No trades yet"
            body="Add your first trade to start building your performance history. Everything on this page — balance, expectancy, drawdown and the equity curve — is calculated from the trades you record."
            action={
              <div className="flex gap-2">
                <Button variant="primary" size="md" onClick={() => editor.open(null)}>
                  Add your first trade
                </Button>
                <Link href="/settings#import">
                  <Button size="md">Import from CSV</Button>
                </Link>
              </div>
            }
          />
        </Panel>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        meta={
          <>
            {app.accountId === "all" ? "All accounts" : app.account?.name} · {periodLabel} · {filtered.length} of {app.trades.length} trades
            {activeCount > 0 && (
              <button onClick={clear} className="ml-2 text-accent hover:underline">
                clear filters
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-3">
        <GuardrailsPanel />

        <Panel title="Account overview" subtitle={undefined}>
          <StatRow cols={6}>
            <Stat
              label="Current balance"
              value={money(currentBalance, app.currency, { compact: true })}
              sub={`Start ${money(app.startingBalance, app.currency, { compact: true })}`}
              size="lg"
              tone={toneOf(currentBalance - app.startingBalance)}
            />
            <Stat label="Net P&L" value={money(metrics.netPnl, app.currency, { sign: true })} tone={toneOf(metrics.netPnl)} size="lg" />
            <Stat label="Net R" value={fmtR(metrics.netR, 2)} tone={toneOf(metrics.netR)} size="lg" />
            <Stat
              label="Win rate"
              value={pct(metrics.winRate)}
              sub={`${metrics.wins}W · ${metrics.losses}L${metrics.breakevens ? ` · ${metrics.breakevens}BE` : ""}`}
              size="lg"
            />
            <Stat
              label="Profit factor"
              value={metrics.profitFactor === null ? "—" : num(metrics.profitFactor, 2)}
              tone={metrics.profitFactor === null ? "flat" : metrics.profitFactor >= 1 ? "pos" : "neg"}
              hint="Gross profit ÷ gross loss"
              size="lg"
            />
            <Stat
              label="Expectancy"
              value={fmtR(metrics.expectancyR, 2)}
              sub={metrics.expectancyPnl !== null ? money(metrics.expectancyPnl, app.currency, { sign: true }) + " / trade" : undefined}
              tone={toneOf(metrics.expectancyR)}
              size="lg"
            />
          </StatRow>
          <div className="h-px bg-line-soft my-4" />
          <StatRow cols={6}>
            <Stat label="Trades" value={metrics.trades} sub={metrics.excluded ? `${metrics.excluded} excluded` : undefined} />
            <Stat
              label="Current streak"
              value={metrics.currentStreak.type === "none" ? "—" : `${metrics.currentStreak.count} ${metrics.currentStreak.type === "win" ? "wins" : "losses"}`}
              tone={metrics.currentStreak.type === "win" ? "pos" : metrics.currentStreak.type === "loss" ? "neg" : "flat"}
            />
            <Stat
              label="Max drawdown"
              value={money(-metrics.maxDrawdown, app.currency)}
              sub={metrics.maxDrawdownPct !== null ? pct(metrics.maxDrawdownPct) + " of peak" : `${fmtR(-metrics.maxDrawdownR)} `}
              tone={metrics.maxDrawdown > 0 ? "neg" : "flat"}
            />
            <Stat label="Avg winner" value={money(metrics.avgWin, app.currency, { sign: true })} sub={fmtR(metrics.avgWinR)} tone="pos" />
            <Stat label="Avg loser" value={money(metrics.avgLoss, app.currency)} sub={fmtR(metrics.avgLossR)} tone="neg" />
            <Stat
              label="Best / worst day"
              value={metrics.bestDay ? money(metrics.bestDay.pnl, app.currency, { sign: true }) : "—"}
              sub={metrics.worstDay ? money(metrics.worstDay.pnl, app.currency) : undefined}
              tone="flat"
            />
          </StatRow>
        </Panel>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Panel
            title="Equity curve"
            actions={
              <Segmented
                value={mode}
                onChange={(v) => setMode(v)}
                options={[
                  { value: "pnl", label: "$" },
                  { value: "r", label: "R" },
                ]}
              />
            }
          >
            {points.length ? (
              <LineChart
                points={points}
                baseline={mode === "pnl" ? app.startingBalance : 0}
                height={268}
                format={(v) => (mode === "pnl" ? money(v, app.currency, { compact: true }) : `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`)}
                formatDelta={(v) => (mode === "pnl" ? money(v, app.currency, { sign: true }) : fmtR(v))}
              />
            ) : (
              <EmptyState compact title="Nothing to plot" body="No trades fall inside the current filters." />
            )}
          </Panel>

          <Panel title="Distribution">
            <div className="grid gap-3">
              <ResultBreakdown />
            </div>
          </Panel>
        </div>

        <Panel
          title="Recent trades"
          flush
          actions={
            <Link href="/journal">
              <Button variant="ghost">View all</Button>
            </Link>
          }
        >
          <TradeTable trades={filtered.slice(0, 12)} />
        </Panel>
      </div>
    </Page>
  );
}

function ResultBreakdown() {
  const app = useApp();
  const { apply } = useFilters();
  const trades = apply(app.trades);
  const counts = new Map<string, { n: number; pnl: number }>();
  for (const t of trades) {
    const cur = counts.get(t.result) ?? { n: 0, pnl: 0 };
    cur.n++;
    cur.pnl += t.pnl;
    counts.set(t.result, cur);
  }
  const total = trades.length;
  const entries = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);

  if (!total) return <p className="text-body text-ink-3">No trades in range.</p>;

  const LABEL: Record<string, string> = {
    win: "Win",
    loss: "Loss",
    breakeven: "Break-even",
    early_profit: "Early profit",
    early_loss: "Early loss",
    partial_profit: "Partial profit",
    partial_loss: "Partial loss",
  };

  return (
    <div className="grid gap-2.5">
      {entries.map(([code, v]) => {
        const cls = app.settings.classification[code as keyof typeof app.settings.classification];
        return (
          <div key={code}>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-body text-ink-2">{LABEL[code] ?? code}</span>
              <span className="text-caption text-ink-3 tnum">
                {v.n} · {pct((v.n / total) * 100, 0)}
              </span>
            </div>
            <div className="h-[4px] bg-line-soft rounded-full overflow-hidden">
              <div
                className={cls === "win" ? "bg-pos" : cls === "loss" ? "bg-neg" : "bg-ink-3"}
                style={{ width: `${(v.n / total) * 100}%`, height: "100%", opacity: 0.8 }}
              />
            </div>
            <div className={`text-caption tnum mt-0.5 ${v.pnl > 0 ? "text-pos" : v.pnl < 0 ? "text-neg" : "text-ink-3"}`}>
              {money(v.pnl, app.currency, { sign: true })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
