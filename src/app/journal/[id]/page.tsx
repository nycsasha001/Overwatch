"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/components/app-context";
import { Page } from "@/components/shell";
import { Button, ConfirmDialog, EmptyState, Panel, Spinner, Tag, useToast } from "@/components/ui";
import { KeyValue } from "@/components/stat";
import { ResultBadge } from "@/components/trade-table";
import { useTradeEditor } from "@/components/trade-editor";
import { api } from "@/lib/client";
import { RESULT_LABEL } from "@/lib/types";
import { chronological } from "@/lib/stats";
import { tradeInstant } from "@/lib/session";
import { CHART, PriceChart, useAvailableTimeframes } from "@/components/price-chart";
import { TimeframeSelect } from "@/components/timeframe-select";
import { Resizable } from "@/components/resizable";
import type { Timeframe } from "@/lib/aggregate";
import { fmtDate, money, pct, r as fmtR } from "@/lib/format";
import { pdArrayLabel, pdArrayStacked } from "@/lib/setup";

export default function TradeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const app = useApp();
  const editor = useTradeEditor();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [tf, setTf] = useState<Timeframe>("15m");
  const [chartReset, setChartReset] = useState(0);

  const ordered = useMemo(() => chronological(app.trades), [app.trades]);
  const trade = app.trades.find((t) => t.id === params.id);
  const chartTimeframes = useAvailableTimeframes(trade?.instrument ?? "");
  const idx = ordered.findIndex((t) => t.id === params.id);
  const prev = idx > 0 ? ordered[idx - 1] : null;
  const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;

  if (app.loading) {
    return (
      <Page>
        <Spinner label="Loading trade…" />
      </Page>
    );
  }

  if (!trade) {
    return (
      <Page>
        <Panel>
          <EmptyState
            title="Trade not found"
            body="This entry may have been deleted, or it belongs to a different account. Switch account or return to the journal."
            action={
              <Link href="/journal">
                <Button>Back to journal</Button>
              </Link>
            }
          />
        </Panel>
      </Page>
    );
  }

  const remove = async () => {
    try {
      await api.deleteTrade(trade.id);
      await app.refresh();
      toast("Trade deleted");
      router.push("/journal");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
    }
  };

  const duplicate = async () => {
    try {
      const copy = await api.duplicateTrade(trade.id);
      await app.refresh();
      toast("Trade duplicated");
      router.push(`/journal/${copy.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not duplicate", "error");
    }
  };

  const flags = [
    trade.htfSweep && "HTF sweep",
    trade.sweep4h && "4H sweep",
    trade.sweep1h && "1H sweep",
    trade.sweep15m && "15m sweep",
    trade.sessionSweep && "Session high/low sweep",
    trade.mss && "Market structure shift",
    trade.displacement && "Displacement",
    trade.fvg && "FVG",
    trade.orderBlock && "Order block",
  ].filter(Boolean) as string[];

  const notes: { label: string; hint: string; value: string | null }[] = [
    { label: "Pre-trade thesis", hint: "Why did I take this trade?", value: trade.thesis },
    { label: "Execution", hint: "What happened during execution?", value: trade.execution },
    { label: "Post-trade review", hint: "What did I learn?", value: trade.review },
    { label: "Mistakes", hint: "What did I do incorrectly?", value: trade.mistakes },
    { label: "Emotions", hint: "How was my mindset?", value: trade.emotions },
  ];
  const written = notes.filter((n) => n.value);


  return (
    <Page>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/journal" className="text-ink-3 hover:text-ink text-body">
            ← Journal
          </Link>
          <div className="h-4 w-px bg-line" />
          <h1 className="text-section font-medium tracking-tight truncate">
            {trade.instrument} <span className={trade.direction === "long" ? "text-pos" : "text-neg"}>{trade.direction === "long" ? "Long" : "Short"}</span>
          </h1>
          <ResultBadge trade={trade} />
          <span className="text-body text-ink-3 truncate">
            {fmtDate(trade.date)}
            {trade.time ? ` · ${trade.time}` : ""}
            {trade.session ? ` · ${trade.session}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {prev && (
            <Link href={`/journal/${prev.id}`}>
              <Button variant="ghost" title="Previous trade">
                ←
              </Button>
            </Link>
          )}
          {next && (
            <Link href={`/journal/${next.id}`}>
              <Button variant="ghost" title="Next trade">
                →
              </Button>
            </Link>
          )}
          <Button onClick={duplicate}>Duplicate</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Delete
          </Button>
          <Button variant="primary" onClick={() => editor.open(trade)}>
            Edit
          </Button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="grid gap-3">
          <Panel title="Result">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <div className="eyebrow">P&amp;L</div>
                <div className={`text-figure tnum font-medium mt-1 ${trade.pnl > 0 ? "text-pos" : trade.pnl < 0 ? "text-neg" : "text-ink"}`}>
                  {money(trade.pnl, app.currency, { sign: true })}
                </div>
              </div>
              <div>
                <div className="eyebrow">R multiple</div>
                <div className={`text-figure tnum font-medium mt-1 ${(trade.rMultiple ?? 0) > 0 ? "text-pos" : (trade.rMultiple ?? 0) < 0 ? "text-neg" : "text-ink"}`}>
                  {fmtR(trade.rMultiple)}
                </div>
              </div>
              <div>
                <div className="eyebrow">Classification</div>
                <div className="text-section mt-2">{RESULT_LABEL[trade.result]}</div>
              </div>
              <div>
                <div className="eyebrow">Risk</div>
                <div className="text-section mt-2 tnum">
                  {trade.riskAmount !== null ? money(trade.riskAmount, app.currency) : "—"}
                  {trade.riskPct !== null && <span className="text-ink-3 text-body"> · {pct(trade.riskPct)}</span>}
                </div>
              </div>
            </div>
          </Panel>

          {written.length > 0 ? (
            <Panel title="Journal">
              <div className="grid gap-4">
                {written.map((n) => (
                  <div key={n.label}>
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <h3 className="text-body font-medium">{n.label}</h3>
                      <span className="text-caption text-ink-3">{n.hint}</span>
                    </div>
                    <p className="text-ui text-ink-2 leading-[1.65] whitespace-pre-wrap">{n.value}</p>
                  </div>
                ))}
              </div>
            </Panel>
          ) : (
            <Panel title="Journal">
              <EmptyState
                compact
                title="No notes on this trade"
                body="Add your thesis, execution notes and review to make this entry useful when you look back at it."
                action={<Button onClick={() => editor.open(trade)}>Write the journal</Button>}
              />
            </Panel>
          )}

          {(trade.screenshots ?? []).length > 0 && (
            <Panel
              title={(trade.screenshots ?? []).length === 1 ? "Screenshot" : "Screenshots"}
              subtitle="What the trade actually looked like"
            >
              {/* The screenshot leads. It is the record of what was in front of you at the time,
                  which the redrawn chart below cannot reproduce — that one shows the same candles
                  without your markup, so it sits collapsed until asked for.
                  Images captured under the old before/during/after scheme still appear here. */}
              <div className={`grid gap-2 ${(trade.screenshots ?? []).length > 1 ? "sm:grid-cols-2" : ""}`}>
                {(trade.screenshots ?? []).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setZoom(`/api/screenshots/file/${s.filename}`)}
                    className="border border-line rounded-sm overflow-hidden hover:border-accent/50 transition-colors"
                    title="Click to enlarge"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/screenshots/file/${s.filename}`}
                      alt={s.caption ?? "Trade screenshot"}
                      className="w-full object-contain max-h-[560px] bg-black"
                    />
                  </button>
                ))}
              </div>
            </Panel>
          )}
          <Panel
            title="Chart"
            subtitle={`${trade.instrument} · drawn from stored candles, times in New York`}
            flush
            collapsible
            defaultCollapsed
            storageKey="tj.panel.tradeChart"
            actions={
              <>
                <Button onClick={() => setChartReset((v) => v + 1)} title="Recentre the chart">
                  Reset
                </Button>
                <TimeframeSelect value={tf} options={chartTimeframes} onChange={setTf} />
              </>
            }
          >
            <Resizable storageKey="tj.height.tradeChart" defaultHeight={380} min={240} max={1200}>
              {(h) => (
                <div className="px-3 pt-1">
                  <PriceChart
                    symbol={trade.instrument}
                    timeframe={tf}
                    centerTs={tradeInstant(trade.date, trade.time)}
                    resetSignal={chartReset}
                    height={h}
                    levels={[
                      trade.entry !== null && { price: trade.entry, label: "Entry", color: CHART.entry },
                      trade.stop !== null && { price: trade.stop, label: "Stop", color: CHART.stop, dashed: true },
                      trade.target !== null && { price: trade.target, label: "Target", color: CHART.target, dashed: true },
                      trade.exit !== null && { price: trade.exit, label: "Exit", color: CHART.exit, dashed: true },
                    ].filter(Boolean) as { price: number; label: string; color: string; dashed?: boolean }[]}
                  />
                </div>
              )}
            </Resizable>
          </Panel>

        </div>

        <div className="grid gap-3">

          <Panel title="Setup">
            <KeyValue label="Strategy" value={trade.strategy ?? "—"} />
            <KeyValue label="Setup" value={trade.setup ?? "—"} />
            <KeyValue label="Session" value={trade.session ?? "—"} />
            <KeyValue label="Entry model" value={trade.entryModel ?? "—"} />
            <KeyValue
              label="PD array"
              value={
                pdArrayStacked(trade) ? (
                  <span className="inline-flex items-center gap-1.5" title={pdArrayLabel(trade)}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M2 6.4l2.6 2.6L10 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {pdArrayLabel(trade)}
                  </span>
                ) : (
                  "—"
                )
              }
              tone={pdArrayStacked(trade) ? "pos" : "flat"}
            />
            {flags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-3">
                {flags.map((f) => (
                  <Tag key={f} tone="accent">
                    {f}
                  </Tag>
                ))}
              </div>
            )}
            {trade.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-2">
                {trade.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 anim-fade" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Screenshot" className="max-w-full max-h-full object-contain border border-line rounded-sm" />
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        title="Delete this trade?"
        body="The trade, its notes and screenshots will be permanently removed."
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </Page>
  );
}
