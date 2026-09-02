"use client";

import React, { useMemo, useState } from "react";
import { useApp } from "@/components/app-context";
import { useFilters } from "@/components/filter-context";
import { Page, PageHeader } from "@/components/shell";
import { Button, EmptyState, Panel, Segmented } from "@/components/ui";
import { Stat, StatRow } from "@/components/stat";
import { BarChart, DrawdownChart, LineChart, MiniBar } from "@/components/charts";
import {
  Bucket,
  WEEKDAYS,
  computeMetrics,
  equitySeries,
  excursionStats,
  groupBy,
  hourBucket,
  rHistogram,
  weekdayOf,
} from "@/lib/stats";
import { RESULT_LABEL, ResultCode } from "@/lib/types";
import { fmtDateShort, money, num, pct, r as fmtR, toneOf } from "@/lib/format";
import { useTradeEditor } from "@/components/trade-editor";
import { useToast } from "@/components/ui";

export default function AnalyticsPage() {
  const app = useApp();
  const { apply, activeCount } = useFilters();
  const editor = useTradeEditor();
  const [mode, setMode] = useState<"pnl" | "r">("r");
  const toast = useToast();
  const [backfilling, setBackfilling] = useState(false);

  const backfill = async () => {
    setBackfilling(true);
    try {
      const res = await fetch("/api/trades/backfill-excursions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: app.accountId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Backfill failed");
      await app.refresh();
      const s = json.skipped;
      toast(
        json.updated
          ? `Filled MAE/MFE on ${json.updated} trades` +
            (s.noSymbol ? ` · ${s.noSymbol} had no candles for their instrument` : "")
          : "Nothing to fill — trades need an entry, a stop, a time, and stored candles",
        json.updated ? "success" : "info"
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Backfill failed", "error");
    } finally {
      setBackfilling(false);
    }
  };

  const trades = useMemo(() => apply(app.trades), [apply, app.trades]);
  const m = useMemo(() => computeMetrics(trades, app.settings, app.startingBalance), [trades, app.settings, app.startingBalance]);
  const equity = useMemo(() => equitySeries(trades, app.settings, mode === "pnl" ? app.startingBalance : 0), [trades, app.settings, app.startingBalance, mode]);
  const exc = useMemo(() => excursionStats(trades, app.settings), [trades, app.settings]);

  const fmtVal = (v: number) => (mode === "pnl" ? money(v, app.currency, { compact: true }) : `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`);

  const monthly = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of trades) {
      const key = t.date.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + (mode === "pnl" ? t.pnl : t.rMultiple ?? 0));
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => ({ label: `${k.slice(5)}/${k.slice(2, 4)}`, value: v }));
  }, [trades, mode]);

  const daily = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of trades) map.set(t.date, (map.get(t.date) ?? 0) + (mode === "pnl" ? t.pnl : t.rMultiple ?? 0));
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-45)
      .map(([k, v]) => ({ label: k.slice(8), value: v, sub: fmtDateShort(k) }));
  }, [trades, mode]);

  const hist = useMemo(() => rHistogram(trades), [trades]);

  const bySession = useMemo(() => groupBy(trades, app.settings, (t) => t.session ?? "Unspecified"), [trades, app.settings]);
  const byWeekday = useMemo(
    () =>
      groupBy(trades, app.settings, (t) => String(weekdayOf(t.date)), (k) => WEEKDAYS[Number(k)]).sort(
        (a, b) => Number(a.key) - Number(b.key)
      ),
    [trades, app.settings]
  );
  const byDirection = useMemo(() => groupBy(trades, app.settings, (t) => (t.direction === "long" ? "Long" : "Short")), [trades, app.settings]);
  const bySetup = useMemo(() => groupBy(trades, app.settings, (t) => t.setup ?? "Unspecified"), [trades, app.settings]);
  const byInstrument = useMemo(() => groupBy(trades, app.settings, (t) => t.instrument), [trades, app.settings]);
  const byResult = useMemo(
    () => groupBy(trades, app.settings, (t) => t.result, (k) => RESULT_LABEL[k as ResultCode] ?? k),
    [trades, app.settings]
  );
  const byHour = useMemo(
    () => groupBy(trades, app.settings, hourBucket, (k) => (k === "—" ? "No time" : k)).sort((a, b) => a.key.localeCompare(b.key)),
    [trades, app.settings]
  );
  const byStrategy = useMemo(() => groupBy(trades, app.settings, (t) => t.strategy ?? "Unspecified"), [trades, app.settings]);

  if (!app.trades.length) {
    return (
      <Page>
        <PageHeader title="Analytics" />
        <Panel>
          <EmptyState
            title="Nothing to analyse yet"
            body="Analytics are derived entirely from recorded trades. Add trades — or import a CSV — and every breakdown on this page fills in automatically."
            action={
              <Button variant="primary" size="md" onClick={() => editor.open(null)}>
                Add a trade
              </Button>
            }
          />
        </Panel>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Analytics"
        meta={`${trades.length} of ${app.trades.length} trades${activeCount ? " · filtered" : ""}`}
        actions={
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "r", label: "R" },
              { value: "pnl", label: "$" },
            ]}
          />
        }
      />

      {!trades.length ? (
        <Panel>
          <EmptyState compact title="No trades match the filters" body="Widen the date range or clear filters to see analytics." />
        </Panel>
      ) : (
        <div className="grid gap-3">
          <Panel title="Performance">
            <StatRow cols={6}>
              <Stat label="Net P&L" value={money(m.netPnl, app.currency, { sign: true })} tone={toneOf(m.netPnl)} />
              <Stat label="Net R" value={fmtR(m.netR)} tone={toneOf(m.netR)} />
              <Stat
                label="Win rate"
                value={pct(m.winRate)}
                sub={
                  m.breakevenWinRate !== null
                    ? `needs ${pct(m.breakevenWinRate, 0)} at ${num(m.avgPlannedRr, 2)}R`
                    : `${m.wins}W · ${m.losses}L · ${m.breakevens}BE`
                }
                tone={m.winRateEdge === null ? "flat" : m.winRateEdge >= 0 ? "pos" : "neg"}
                hint={
                  m.breakevenWinRate === null
                    ? undefined
                    : `At an average planned ${num(m.avgPlannedRr, 2)}:1, break-even is ${pct(m.breakevenWinRate, 1)}. ` +
                      `You are ${pct(Math.abs(m.winRateEdge ?? 0), 1)} ${((m.winRateEdge ?? 0) >= 0 ? "above" : "below")} it.`
                }
              />
              <Stat label="Profit factor" value={m.profitFactor === null ? "—" : num(m.profitFactor, 2)} tone={m.profitFactor === null ? "flat" : m.profitFactor >= 1 ? "pos" : "neg"} />
              <Stat label="Expectancy" value={fmtR(m.expectancyR)} sub={m.expectancyPnl !== null ? `${money(m.expectancyPnl, app.currency, { sign: true })}/trade` : undefined} tone={toneOf(m.expectancyR)} />
              <Stat label="Total trades" value={m.trades} sub={m.excluded ? `${m.excluded} excluded by settings` : undefined} />
            </StatRow>
            <div className="h-px bg-line-soft my-4" />
            <StatRow cols={6}>
              <Stat label="Average winner" value={money(m.avgWin, app.currency, { sign: true })} sub={fmtR(m.avgWinR)} tone="pos" />
              <Stat label="Average loser" value={money(m.avgLoss, app.currency)} sub={fmtR(m.avgLossR)} tone="neg" />
              <Stat label="Largest winner" value={money(m.largestWin, app.currency, { sign: true })} tone="pos" />
              <Stat label="Largest loser" value={money(m.largestLoss, app.currency)} tone="neg" />
              <Stat label="Average R" value={fmtR(m.avgR)} tone={toneOf(m.avgR)} />
              <Stat label="Median R" value={fmtR(m.medianR)} tone={toneOf(m.medianR)} />
            </StatRow>
            <div className="h-px bg-line-soft my-4" />
            <StatRow cols={6}>
              <Stat label="Max drawdown" value={money(-m.maxDrawdown, app.currency)} sub={m.maxDrawdownPct !== null ? `${pct(m.maxDrawdownPct)} of peak` : undefined} tone={m.maxDrawdown ? "neg" : "flat"} />
              <Stat label="Max drawdown (R)" value={fmtR(-m.maxDrawdownR)} tone={m.maxDrawdownR ? "neg" : "flat"} />
              <Stat label="Gross profit" value={money(m.grossProfit, app.currency)} tone="pos" />
              <Stat label="Gross loss" value={money(-m.grossLoss, app.currency)} tone="neg" />
              <Stat label="Best day" value={m.bestDay ? money(m.bestDay.pnl, app.currency, { sign: true }) : "—"} sub={m.bestDay ? fmtDateShort(m.bestDay.date) : undefined} tone="pos" />
              <Stat label="Worst day" value={m.worstDay ? money(m.worstDay.pnl, app.currency) : "—"} sub={m.worstDay ? fmtDateShort(m.worstDay.date) : undefined} tone="neg" />
            </StatRow>
          </Panel>

          <div className="grid gap-3 xl:grid-cols-2">
            <Panel title={`Equity curve (${mode === "pnl" ? "dollars" : "R"})`}>
              <LineChart
                points={equity.map((p) => ({
                  x: p.index,
                  value: mode === "pnl" ? p.equity : p.equityR,
                  label: `${fmtDateShort(p.date)} · trade ${p.index}`,
                  delta: mode === "pnl" ? p.pnl : p.r,
                }))}
                baseline={mode === "pnl" ? app.startingBalance : 0}
                height={230}
                format={fmtVal}
                formatDelta={(v) => (mode === "pnl" ? money(v, app.currency, { sign: true }) : fmtR(v))}
              />
            </Panel>
            <Panel title="Drawdown" subtitle="Distance below the running peak">
              <DrawdownChart
                points={equity.map((p) => ({
                  x: p.index,
                  value: mode === "pnl" ? p.drawdown : p.drawdownR,
                  label: fmtDateShort(p.date),
                }))}
                height={230}
                format={fmtVal}
              />
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <Panel title="Monthly performance">
              {monthly.length ? <BarChart items={monthly} height={200} format={fmtVal} /> : <EmptyState compact title="No data" body="No trades in range." />}
            </Panel>
            <Panel title="Daily performance" subtitle="Last 45 trading days">
              {daily.length ? <BarChart items={daily} height={200} format={fmtVal} maxLabelEvery={Math.ceil(daily.length / 12)} /> : <EmptyState compact title="No data" body="No trades in range." />}
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <Panel title="R distribution" subtitle="How outcomes are spread, in 0.5R buckets">
              {hist.length ? (
                <BarChart items={hist.map((h) => ({ label: h.label, value: h.count, sub: `${h.count} trades` }))} height={200} format={(v) => String(Math.round(v))} neutralColor />
              ) : (
                <EmptyState compact title="No R data" body="Record entry, stop and exit prices (or an R multiple) to build this distribution." />
              )}
            </Panel>
            <Panel
              title="Excursion (MAE / MFE)"
              subtitle="Measured from stored candles, or entered by hand"
              actions={
                <Button onClick={backfill} disabled={backfilling}>
                  {backfilling ? "Measuring…" : "Fill from candles"}
                </Button>
              }
            >
              {exc.sample === 0 ? (
                <EmptyState
                  compact
                  title="No excursion data"
                  body="Import candles on the Market data page and press Fill from candles — every trade with an entry, a stop and a time gets measured automatically. You can also type MAE and MFE by hand on a trade."
                />
              ) : (
                <div className="grid gap-3">
                  <StatRow cols={4}>
                    <Stat label="Avg MAE — winners" value={exc.avgMaeWinners === null ? "—" : `${num(exc.avgMaeWinners)}R`} />
                    <Stat label="Avg MFE — winners" value={exc.avgMfeWinners === null ? "—" : `${num(exc.avgMfeWinners)}R`} />
                    <Stat label="Avg MAE — losers" value={exc.avgMaeLosers === null ? "—" : `${num(exc.avgMaeLosers)}R`} />
                    <Stat label="Worst MAE on a winner" value={exc.maxMaeWinner === null ? "—" : `${num(exc.maxMaeWinner)}R`} />
                  </StatRow>
                  <div className="h-px bg-line-soft" />
                  <div className="text-[12.5px] text-ink-2 leading-relaxed grid gap-1.5">
                    {exc.maxMaeWinner !== null && exc.maxMaeWinner >= 0.9 && (
                      <p>
                        A winning trade drew down {num(exc.maxMaeWinner)}R before working. Stops sitting inside that distance would have
                        turned winners into losers.
                      </p>
                    )}
                    {exc.avgCapturedRatio !== null && (
                      <p>
                        Winners captured {pct(exc.avgCapturedRatio * 100, 0)} of their best unrealised move on average
                        {exc.avgCapturedRatio < 0.6 ? " — worth reviewing whether you are exiting too early." : "."}
                      </p>
                    )}
                    <p className="text-ink-3">Based on {exc.sample} trades with excursion data.</p>
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <Breakdown title="By session" buckets={bySession} mode={mode} />
            <Breakdown title="By day of week" buckets={byWeekday} mode={mode} />
            <Breakdown title="By direction" buckets={byDirection} mode={mode} />
            <Breakdown title="By setup" buckets={bySetup} mode={mode} />
            <Breakdown title="By strategy" buckets={byStrategy} mode={mode} />
            <Breakdown title="By instrument" buckets={byInstrument} mode={mode} />
            <Breakdown title="By result classification" buckets={byResult} mode={mode} />
            <Breakdown title="By hour of day" buckets={byHour} mode={mode} />
          </div>
        </div>
      )}
    </Page>
  );
}

function Breakdown({ title, buckets, mode }: { title: string; buckets: Bucket[]; mode: "pnl" | "r" }) {
  const app = useApp();
  if (!buckets.length) {
    return (
      <Panel title={title}>
        <EmptyState compact title="No data" body="No trades in this breakdown." />
      </Panel>
    );
  }
  const max = Math.max(...buckets.map((b) => Math.abs(mode === "pnl" ? b.metrics.netPnl : b.metrics.netR)), 0.0001);
  return (
    <Panel title={title} flush>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-ink-3 border-b border-line-soft">
            <th className="text-left font-medium text-[10.5px] uppercase tracking-[0.09em] px-4 py-2">Group</th>
            <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-2 py-2 w-[52px]">N</th>
            <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-2 py-2 w-[64px]">Win %</th>
            <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-2 py-2 w-[68px]">Exp.</th>
            <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-4 py-2 w-[110px]">{mode === "pnl" ? "Net P&L" : "Net R"}</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => {
            const v = mode === "pnl" ? b.metrics.netPnl : b.metrics.netR;
            return (
              <tr key={b.key} className="border-b border-line-soft last:border-0 transition-colors hover:bg-hover/45">
                <td className="px-4 py-2">
                  <div className="truncate max-w-[180px]">{b.label}</div>
                  <div className="mt-1.5 w-[120px]">
                    <MiniBar value={v} max={max} />
                  </div>
                </td>
                <td className="px-2 py-2 text-right tnum text-ink-2 align-top">{b.metrics.trades}</td>
                <td className="px-2 py-2 text-right tnum text-ink-2 align-top">{pct(b.metrics.winRate, 0)}</td>
                <td className={`px-2 py-2 text-right tnum align-top ${toneOf(b.metrics.expectancyR) === "pos" ? "text-pos" : toneOf(b.metrics.expectancyR) === "neg" ? "text-neg" : "text-ink-3"}`}>
                  {b.metrics.expectancyR === null ? "—" : `${b.metrics.expectancyR > 0 ? "+" : ""}${b.metrics.expectancyR.toFixed(2)}`}
                </td>
                <td className={`px-4 py-2 text-right tnum align-top ${v > 0 ? "text-pos" : v < 0 ? "text-neg" : "text-ink-3"}`}>
                  {mode === "pnl" ? money(v, app.currency, { sign: true, compact: true }) : fmtR(v)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
