"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-context";
import { Page, PageHeader } from "@/components/shell";
import { Button, ConfirmDialog, EmptyState, Field, Input, Modal, Panel, Select, Spinner, Tag, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { Backtest, BacktestTest } from "@/lib/types";
import { fmtDateShort, money, num, pct, r as fmtR } from "@/lib/format";
import { LineChart } from "@/components/charts";
import { Stat } from "@/components/stat";

export default function BacktestingPage() {
  const app = useApp();
  const toast = useToast();
  // Read from settings rather than asserted in the copy — this panel used to claim no engine was
  // connected even when one was configured and running.
  const engineScript = app.settings.engine?.script?.trim() || "";
  const engineInterpreter = app.settings.engine?.interpreter?.trim() || "python3";
  const engineArgs = app.settings.engine?.args?.trim() || "";
  const [runs, setRuns] = useState<Backtest[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<Backtest | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<Backtest | null>(null);
  const [logText, setLogText] = useState<string>("");
  const [detail, setDetail] = useState<Backtest | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await api.listBacktests());
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load backtests", "error");
      setRuns([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const runEngine = async (bt: Backtest, background = false) => {
    setRunning(bt.id);
    try {
      const res = await fetch("/api/backtests/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backtestId: bt.id, background }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The engine failed");
      if (background) {
        toast(`Started in the background — output at ${json.log}`, "success");
        await load();
        return;
      }
      toast(
        json.ingested
          ? `Finished in ${json.seconds}s — results stored`
          : `Finished in ${json.seconds}s — check the journal for posted trades`,
        "success"
      );
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "The engine failed", "error");
      await load();
    } finally {
      setRunning(null);
    }
  };

  // Poll while a run is live, so the row stops lying about what is happening.
  useEffect(() => {
    if (!(runs ?? []).some((r) => r.status === "awaiting_engine")) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [runs, load]);

  useEffect(() => {
    if (!logFor) return;
    let stop = false;
    const pull = () =>
      fetch(`/api/backtests/${logFor.id}/log`)
        .then((r) => r.json())
        .then((j) => {
          if (!stop) setLogText(j.log || j.note || "No output yet.");
        })
        .catch(() => setLogText("Could not read the log."));
    void pull();
    const id = setInterval(pull, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [logFor]);

  const remove = async () => {
    if (!confirm) return;
    await api.deleteBacktest(confirm.id);
    setConfirm(null);
    await load();
  };

  const complete = (runs ?? []).filter((r) => r.status === "complete" && r.result);
  const compared = complete.filter((r) => selected.includes(r.id));

  return (
    <Page>
      <PageHeader
        title="Backtesting journal"
        meta="Recorded backtest runs and their per-test write-ups"
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const payload = JSON.parse(await file.text());
                  const res = await api.importBacktests(payload);
                  await load();
                  const parts = [`Imported ${res.imported} run${res.imported === 1 ? "" : "s"}`];
                  if (res.skipped.length) parts.push(`${res.skipped.length} already present`);
                  if (res.errors.length) parts.push(`${res.errors.length} rejected`);
                  toast(parts.join(" · "), res.imported ? "success" : "info");
                } catch (err) {
                  toast(err instanceof Error ? err.message : "Could not read that file", "error");
                } finally {
                  if (fileRef.current) fileRef.current.value = "";
                }
              }}
            />
            <Button onClick={() => fileRef.current?.click()} title="Import runs exported from an engine or another journal">
              Import JSON
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              New run
            </Button>
          </>
        }
      />

      <div className="grid gap-3">
        <Panel
          title="Engine status"
          subtitle={
            engineScript
              ? `Connected — ${engineScript.split("/").pop()}`
              : "No engine connected — runs are stored for an external engine to execute"
          }
          collapsible
          defaultCollapsed
          storageKey="tj.panel.engineStatus"
        >
          <div className="flex items-start gap-3">
            <span className={`mt-[3px] w-[7px] h-[7px] rounded-full shrink-0 ${engineScript ? "bg-pos" : "bg-warn"}`} />
            <div className="text-[12.5px] text-ink-2 leading-relaxed">
              {engineScript ? (
                <>
                  <p className="text-ink">An engine is configured and the Run buttons will start it.</p>
                  <p className="mt-1 font-mono text-[11.5px] text-ink-3 break-all">
                    {engineInterpreter} {engineScript} {engineArgs}
                  </p>
                  <p className="mt-2">
                    Trades it reports are journalled to their own backtest account, and a summary of each run is
                    stored on this page. Change any of it in <span className="text-ink">Settings → Backtesting engine</span>.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-ink">No backtesting engine is connected to this instance.</p>
                  <p className="mt-1">
                    Overwatch stores run configurations and results but does not simulate strategies itself — that keeps the numbers on this page
                    honest. Point your Python engine at the endpoints below and completed runs will appear here with real results.
                  </p>
                  <p className="mt-2">
                    With a script configured in <span className="text-ink">Settings → Backtesting engine</span>, the
                    Run button on each row starts it directly. Otherwise the endpoints below still work for an
                    engine running anywhere.
                  </p>
                </>
              )}
              <div className="mt-3 grid gap-1.5 font-mono text-[11.5px] text-ink-3">
                <div>
                  <span className="text-pos">GET</span> /api/backtests <span className="text-ink-3">— list queued runs and their parameters</span>
                </div>
                <div>
                  <span className="text-accent">POST</span> /api/backtests/&#123;id&#125;/result
                </div>
                <div className="pl-4 whitespace-pre-wrap">
                  {`{ "trades": 128, "netR": 41.2, "netPnl": 8240, "winRate": 46.1,
  "profitFactor": 1.84, "maxDrawdownR": 7.5, "equityR": [0.5, 1.2, ...] }`}
                </div>
                <div className="pl-4">or {`{ "status": "failed", "error": "…" }`}</div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Runs" flush>
          {runs === null ? (
            <div className="p-4">
              <Spinner label="Loading runs…" />
            </div>
          ) : !runs.length ? (
            <EmptyState
              title="No backtest runs configured"
              body="Create a run to describe the strategy, instrument, date range and parameters you want tested. The configuration is stored so an external engine can pick it up."
              action={<Button variant="primary" size="md" onClick={() => setCreating(true)}>Configure a run</Button>}
            />
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-ink-3 border-b border-line-soft">
                  <th className="w-[36px]" />
                  <th className="text-left font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Run</th>
                  <th className="text-left font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Instrument</th>
                  <th className="text-left font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Range</th>
                  <th className="text-left font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Status</th>
                  <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Net R</th>
                  <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Win %</th>
                  <th className="w-[110px]" />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line-soft last:border-0 transition-colors hover:bg-hover/45">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={r.status !== "complete"}
                        checked={selected.includes(r.id)}
                        onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div>{r.name}</div>
                      <div className="text-[11px] text-ink-3">{r.strategy ?? "No strategy set"}</div>
                    </td>
                    <td className="px-3 py-2 text-ink-2">{r.instrument ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-3 tnum">
                      {r.startDate ? fmtDateShort(r.startDate) : "—"} → {r.endDate ? fmtDateShort(r.endDate) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "complete" ? (
                        <Tag tone="pos">Complete</Tag>
                      ) : r.status === "failed" ? (
                        <span title={r.engineNote ?? undefined}>
                          <Tag tone="neg">Failed</Tag>
                        </span>
                      ) : (
                        <Tag>Awaiting engine</Tag>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right tnum ${(r.result?.netR ?? 0) > 0 ? "text-pos" : (r.result?.netR ?? 0) < 0 ? "text-neg" : "text-ink-3"}`}>
                      {r.result ? fmtR(r.result.netR) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{r.result ? pct(r.result.winRate) : "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => runEngine(r)}
                        disabled={running !== null}
                        className="text-[11.5px] text-accent hover:underline disabled:opacity-40 mr-2"
                        title="Run now and wait — for quick backtests"
                      >
                        {running === r.id ? "Running…" : "Run"}
                      </button>
                      <button
                        onClick={() => runEngine(r, true)}
                        disabled={running !== null}
                        className="text-[11.5px] text-ink-3 hover:text-ink disabled:opacity-40 mr-2"
                        title="Start it detached — survives closing the tab, no time limit"
                      >
                        Run overnight
                      </button>
                      {r.result?.raw?.tests?.length ? (
                        <button onClick={() => setDetail(r)} className="text-[11.5px] text-ink-3 hover:text-ink mr-2">
                          View
                        </button>
                      ) : null}
                      <button onClick={() => setLogFor(r)} className="text-[11.5px] text-ink-3 hover:text-ink mr-2">
                        Log
                      </button>
                      <button onClick={() => setConfirm(r)} className="text-[11.5px] text-ink-3 hover:text-neg">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {complete.length > 0 && (
          <Panel title="Compare runs" subtitle={compared.length ? `${compared.length} selected` : "Select completed runs above to compare"}>
            {!compared.length ? (
              <p className="text-[12.5px] text-ink-3">Tick two or more completed runs to compare their results side by side.</p>
            ) : (
              <div className="grid gap-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-ink-3 border-b border-line-soft">
                        <th className="text-left font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Run</th>
                        <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Trades</th>
                        <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Net R</th>
                        <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Net P&L</th>
                        <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Win %</th>
                        <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">PF</th>
                        <th className="text-right font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2">Max DD (R)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compared.map((r) => (
                        <tr key={r.id} className="border-b border-line-soft last:border-0 transition-colors hover:bg-hover/45">
                          <td className="px-3 py-2">{r.name}</td>
                          <td className="px-3 py-2 text-right tnum">{r.result!.trades}</td>
                          <td className={`px-3 py-2 text-right tnum ${r.result!.netR > 0 ? "text-pos" : "text-neg"}`}>{fmtR(r.result!.netR)}</td>
                          <td className={`px-3 py-2 text-right tnum ${r.result!.netPnl > 0 ? "text-pos" : "text-neg"}`}>
                            {money(r.result!.netPnl, app.currency, { sign: true })}
                          </td>
                          <td className="px-3 py-2 text-right tnum">{pct(r.result!.winRate)}</td>
                          <td className="px-3 py-2 text-right tnum">{r.result!.profitFactor === null ? "—" : num(r.result!.profitFactor, 2)}</td>
                          <td className="px-3 py-2 text-right tnum text-neg">{fmtR(-Math.abs(r.result!.maxDrawdownR))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {compared.some((r) => r.result?.equityR?.length) && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {compared
                      .filter((r) => r.result?.equityR?.length)
                      .map((r) => {
                        const detailTests = r.result?.raw?.tests ?? [];
                        const withCash = detailTests.some((t) => t.risk !== null && t.risk !== undefined);
                        let cum = 0;
                        let cash = 0;
                        const pts = (r.result!.equityR ?? []).map((v, i) => {
                          cum += v;
                          const t = detailTests[i];
                          const step = withCash && t ? (t.r ?? 0) * (t.risk ?? 0) : 0;
                          cash += step;
                          return {
                            x: i,
                            value: cum,
                            label: t ? `Test ${t.ref}${t.date ? ` · ${fmtDateShort(t.date)}` : ""}` : `Trade ${i + 1}`,
                            delta: v,
                            ...(withCash ? { subValue: cash, subDelta: step } : {}),
                          };
                        });
                        return (
                          <div key={r.id}>
                            <div className="text-[12px] text-ink-2 mb-1">{r.name}</div>
                            <LineChart
                              points={pts}
                              baseline={0}
                              height={160}
                              format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
                              formatDelta={(v) => fmtR(v)}
                              formatSub={withCash ? (v) => money(v, app.currency) : undefined}
                              subLabel={withCash ? "P&L" : undefined}
                            />
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </Panel>
        )}
      </div>

      <RunDetail run={detail} onClose={() => setDetail(null)} />

      <Modal
        open={!!logFor}
        onClose={() => setLogFor(null)}
        width={780}
        title={logFor ? `${logFor.name} — output` : ""}
        subtitle={logFor?.status === "awaiting_engine" ? "Running — refreshing every few seconds" : undefined}
        footer={<Button variant="primary" onClick={() => setLogFor(null)}>Close</Button>}
      >
        <pre className="mono text-[11.5px] text-ink-2 leading-relaxed whitespace-pre-wrap max-h-[55vh] overflow-y-auto">
          {logText}
        </pre>
      </Modal>

      <NewRunModal open={creating} onClose={() => setCreating(false)} onCreated={load} />

      <ConfirmDialog
        open={!!confirm}
        title={`Delete ${confirm?.name ?? "run"}?`}
        body="The run configuration and any stored results will be removed."
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </Page>
  );
}

function NewRunModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => Promise<void> }) {
  const app = useApp();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", strategy: "", instrument: "", startDate: "", endDate: "", params: "{}" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Prefill from stored candles so a run cannot be configured over a range with no data.
  useEffect(() => {
    if (!open) return;
    fetch("/api/market/coverage")
      .then((r) => r.json())
      .then((j) => {
        const base = (j.coverage ?? []).find((c: { timeframe: string }) => c.timeframe === "1m");
        if (!base?.first) return;
        setForm((f) => ({
          ...f,
          instrument: f.instrument || base.symbol,
          startDate: f.startDate || new Date(base.first).toISOString().slice(0, 10),
          endDate: f.endDate || new Date(base.last).toISOString().slice(0, 10),
        }));
      })
      .catch(() => undefined);
  }, [open]);

  const submit = async () => {
    setErr(null);
    if (!form.name.trim()) return setErr("Give the run a name.");
    let params: Record<string, unknown> = {};
    if (form.params.trim()) {
      try {
        params = JSON.parse(form.params);
      } catch {
        return setErr("Parameters must be valid JSON.");
      }
    }
    setBusy(true);
    try {
      await api.createBacktest({
        name: form.name.trim(),
        strategy: form.strategy || null,
        instrument: form.instrument || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        params,
      });
      await onCreated();
      toast("Run queued — waiting for an engine to pick it up", "success");
      setForm({ name: "", strategy: "", instrument: "", startDate: "", endDate: "", params: "{}" });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the run");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={520}
      title="New backtest run"
      subtitle="Stored for an external engine to execute"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Queue run"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {err && <div className="border border-neg/40 bg-neg-dim/40 text-neg text-[12.5px] rounded-sm px-3 py-2">{err}</div>}
        <Field label="Run name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="MNQ 4H sweep — 2024" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Strategy">
            <Select value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })}>
              <option value="">—</option>
              {app.strategies.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Instrument">
            <Input list="bt-instruments" value={form.instrument} onChange={(e) => setForm({ ...form, instrument: e.target.value })} />
            <datalist id="bt-instruments">
              {app.settings.instruments.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="End date">
            <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Parameters (JSON)" hint="Passed through to your engine untouched">
          <Textarea rows={4} className="mono" value={form.params} onChange={(e) => setForm({ ...form, params: e.target.value })} />
        </Field>
        {!app.strategies.length && (
          <p className="text-[11.5px] text-ink-3">Tip: add strategies in Settings so they appear in this list.</p>
        )}
      </div>
    </Modal>
  );
}

function RunDetail({ run, onClose }: { run: Backtest | null; onClose: () => void }) {
  const app = useApp();
  const [openTest, setOpenTest] = useState<string | null>(null);
  const tests: BacktestTest[] = run?.result?.raw?.tests ?? [];

  if (!run || !run.result) return null;

  let cum = 0;
  let cumCash = 0;
  const equity = tests.length
    ? tests.map((t, i) => {
        const cash = (t.r ?? 0) * (t.risk ?? 0);
        cum += t.r ?? 0;
        cumCash += cash;
        return {
          x: i,
          value: cum,
          label: `Test ${t.ref}${t.date ? ` · ${fmtDateShort(t.date)}` : ""}`,
          delta: t.r ?? 0,
          subValue: cumCash,
          subDelta: cash,
        };
      })
    : (run.result.equityR ?? []).map((v, i) => {
        cum += v;
        return { x: i, value: cum, label: `Trade ${i + 1}`, delta: v };
      });
  const hasCash = tests.some((t) => t.risk !== null && t.risk !== undefined);

  const tone = (v: number | null) => (v === null ? "text-ink-3" : v > 0 ? "text-pos" : v < 0 ? "text-neg" : "text-ink-3");

  return (
    <Modal open onClose={onClose} width={900} title={run.name} subtitle={`${run.strategy ?? "No strategy set"}${run.instrument ? ` · ${run.instrument}` : ""}`}>
      <div className="grid gap-4">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-5 gap-y-4">
          <Stat label="Tests" value={run.result.trades} />
          <Stat label="Net R" value={fmtR(run.result.netR)} tone={run.result.netR > 0 ? "pos" : run.result.netR < 0 ? "neg" : "flat"} />
          <Stat label="Net P&L" value={money(run.result.netPnl, app.currency, { sign: true })} tone={run.result.netPnl > 0 ? "pos" : run.result.netPnl < 0 ? "neg" : "flat"} />
          <Stat label="Win rate" value={pct(run.result.winRate)} />
          <Stat label="Profit factor" value={run.result.profitFactor === null ? "—" : num(run.result.profitFactor, 2)} tone={(run.result.profitFactor ?? 0) >= 1 ? "pos" : "neg"} />
          <Stat label="Max drawdown" value={fmtR(-Math.abs(run.result.maxDrawdownR))} tone="neg" />
        </div>

        {equity.length > 0 && (
          <div className="border border-line rounded-sm p-3">
            <div className="label mb-1">Cumulative R{hasCash ? " and P&L" : ""}</div>
            <LineChart
              points={equity}
              baseline={0}
              height={180}
              format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}R`}
              formatDelta={(v) => fmtR(v)}
              formatSub={hasCash ? (v) => money(v, app.currency) : undefined}
              subLabel={hasCash ? "P&L" : undefined}
            />
          </div>
        )}

        {tests.length > 0 && (
          <div>
            <div className="label mb-2">Individual tests — click a row to read the write-up</div>
            <div className="border border-line rounded-sm overflow-x-auto">
              <table className="w-full text-[12.5px]" style={{ minWidth: 700 }}>
                <thead>
                  <tr className="text-ink-3 border-b border-line-soft">
                    {["#", "Date", "Side", "Result", "R", "Planned", "Risk", "Duration", "TFs"].map((h, i) => (
                      <th key={h} className={`font-medium text-[10.5px] uppercase tracking-[0.09em] px-3 py-2 ${i >= 4 && i <= 6 ? "text-right" : "text-left"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => (
                    <React.Fragment key={t.ref}>
                      <tr
                        onClick={() => setOpenTest(openTest === t.ref ? null : t.ref)}
                        className="border-b border-line-soft hover:bg-hover/60 cursor-pointer"
                      >
                        <td className="px-3 py-2 text-ink-3 tnum">{t.ref}</td>
                        <td className="px-3 py-2 tnum text-ink-2">{t.date ? fmtDateShort(t.date) : "—"}</td>
                        <td className={`px-3 py-2 ${t.direction === "long" ? "text-pos" : "text-neg"}`}>{t.direction === "long" ? "Long" : "Short"}</td>
                        <td className="px-3 py-2 text-ink-2">{t.result ?? "—"}</td>
                        <td className={`px-3 py-2 text-right tnum ${tone(t.r)}`}>{t.r === null ? "—" : fmtR(t.r)}</td>
                        <td className="px-3 py-2 text-right tnum text-ink-3">{t.plannedRr === null ? "—" : `${num(t.plannedRr, 2)}R`}</td>
                        <td className="px-3 py-2 text-right tnum text-ink-3">{t.risk === null ? "—" : money(t.risk, app.currency)}</td>
                        <td className="px-3 py-2 text-ink-3 whitespace-nowrap">{t.duration ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-3">{t.timeframes ?? "—"}</td>
                      </tr>
                      {openTest === t.ref && (
                        <tr className="border-b border-line-soft bg-base/40">
                          <td colSpan={9} className="px-3 py-3">
                            <p className="text-[13px] text-ink-2 leading-[1.65] whitespace-pre-wrap max-w-[76ch]">{t.notes ?? "No write-up recorded."}</p>
                            <div className="flex items-center gap-2 mt-2">
                              {t.verdict && <Tag tone={t.verdict === "Valid" ? "pos" : t.verdict === "Invalid" ? "neg" : "neutral"}>{t.verdict}</Tag>}
                              {t.size !== null && <Tag>{t.size} contracts</Tag>}
                              {t.balance !== null && <Tag>Balance {money(t.balance, app.currency, { compact: true })}</Tag>}
                              {t.sourceUrl && (
                                <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="text-[11.5px] text-accent hover:underline">
                                  Open in Notion ↗
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {run.engineNote && <p className="text-[11.5px] text-ink-3">{run.engineNote}</p>}
      </div>
    </Modal>
  );
}
