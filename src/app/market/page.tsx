"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Page, PageHeader } from "@/components/shell";
import { Button, EmptyState, Field, Input, Panel, Spinner, Tag, useToast } from "@/components/ui";
import { Stat, StatRow } from "@/components/stat";
import { monthChunks } from "@/lib/chunks";
import { CORE_TIMEFRAMES, TF_LABEL, Timeframe } from "@/lib/aggregate";
import { fmtDate, isoDate } from "@/lib/format";

interface CoverageRow {
  symbol: string;
  timeframe: Timeframe;
  bars: number;
  first: number | null;
  last: number | null;
}

interface ImportRow {
  id: string;
  symbol: string;
  source: string;
  start_date: string | null;
  end_date: string | null;
  bars: number;
  status: string;
  message: string | null;
  created_at: string;
}

interface CoveragePayload {
  symbols: string[];
  coverage: CoverageRow[];
  imports: ImportRow[];
  databento: { configured: boolean; dataset: string };
}

type ChunkState = { label: string; status: "pending" | "running" | "done" | "failed"; bars: number; error?: string };

export default function MarketDataPage() {
  const toast = useToast();
  const [data, setData] = useState<CoveragePayload | null>(null);
  const [symbol, setSymbol] = useState("MNQ");
  const [dbSymbol, setDbSymbol] = useState("MNQ.c.0");
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 5);
    return isoDate(d);
  });
  const [end, setEnd] = useState(() => isoDate(new Date()));
  const [chunks, setChunks] = useState<ChunkState[]>([]);
  const [subStart, setSubStart] = useState("");
  const [subEnd, setSubEnd] = useState("");
  const [subBusy, setSubBusy] = useState(false);
  const [subProgress, setSubProgress] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);
  const csvRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/market/coverage");
      setData(await res.json());
    } catch {
      toast("Could not read market data status", "error");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const planned = useMemo(() => monthChunks(start, end), [start, end]);

  const runImport = async () => {
    if (!planned.length) return toast("That date range is empty", "error");
    cancelled.current = false;
    setRunning(true);
    const state: ChunkState[] = planned.map((c) => ({ label: c.label, status: "pending", bars: 0 }));
    setChunks(state);

    let total = 0;
    for (let i = 0; i < planned.length; i++) {
      if (cancelled.current) break;
      state[i] = { ...state[i], status: "running" };
      setChunks([...state]);
      try {
        const res = await fetch("/api/market/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, databentoSymbol: dbSymbol, start: planned[i].start, end: planned[i].end }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
        total += json.bars;
        state[i] = { ...state[i], status: "done", bars: json.bars };
      } catch (e) {
        state[i] = { ...state[i], status: "failed", bars: 0, error: e instanceof Error ? e.message : "Failed" };
        // A bad key or an auth problem will fail every remaining month — stop rather than hammer it.
        if (state[i].error?.includes("API key") || state[i].error?.includes("401")) {
          setChunks([...state]);
          toast(state[i].error!, "error");
          break;
        }
      }
      setChunks([...state]);
    }

    if (total > 0) {
      try {
        const res = await fetch("/api/market/rebuild", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        toast(`Imported ${total.toLocaleString()} bars and rebuilt every timeframe`, "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Aggregation failed", "error");
      }
    }
    await load();
    setRunning(false);
  };

  const retryFailed = async () => {
    const failed = chunks.filter((c) => c.status === "failed").map((c) => c.label);
    if (!failed.length) return;
    const subset = planned.filter((p) => failed.includes(p.label));
    setRunning(true);
    const next = [...chunks];
    for (const chunk of subset) {
      const i = next.findIndex((c) => c.label === chunk.label);
      next[i] = { ...next[i], status: "running" };
      setChunks([...next]);
      try {
        const res = await fetch("/api/market/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, databentoSymbol: dbSymbol, start: chunk.start, end: chunk.end }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        next[i] = { ...next[i], status: "done", bars: json.bars };
      } catch (e) {
        next[i] = { ...next[i], status: "failed", bars: 0, error: e instanceof Error ? e.message : "Failed" };
      }
      setChunks([...next]);
    }
    setRunning(false);
    await load();
  };

  /** One-second data is ~60× the size of one-minute, so it is imported for short ranges only. */
  const importSubMinute = async () => {
    if (!subStart || !subEnd) return toast("Pick a start and end date", "error");
    const days = (Date.parse(subEnd) - Date.parse(subStart)) / 86400000;
    if (days <= 0) return toast("The end date must be after the start date", "error");
    if (days > 31) return toast("Keep one-second imports to a month or less", "error");

    setSubBusy(true);
    let total = 0;
    try {
      for (let d = 0; d < days; d++) {
        const from = new Date(Date.parse(subStart) + d * 86400000).toISOString().slice(0, 10);
        const to = new Date(Date.parse(subStart) + (d + 1) * 86400000).toISOString().slice(0, 10);
        setSubProgress(`${from} — ${total.toLocaleString()} bars so far`);
        const res = await fetch("/api/market/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, databentoSymbol: dbSymbol, start: from, end: to, schema: "ohlcv-1s" }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Import failed");
        total += json.bars;
      }
      await fetch("/api/market/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      toast(`Imported ${total.toLocaleString()} one-second bars and built 30s`, "success");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "One-second import failed", "error");
    } finally {
      setSubBusy(false);
      setSubProgress(null);
    }
  };

  /** Pull everything between the newest stored bar and today. */
  const updateToToday = async () => {
    setUpdating(true);
    try {
      const res = await fetch("/api/market/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Update failed");
      const total = (json.updated ?? []).reduce((n: number, r: { bars: number }) => n + r.bars, 0);
      const failed = (json.updated ?? []).find((r: { error?: string }) => r.error);
      if (failed?.error) toast(failed.error, "error");
      else toast(total ? `Added ${total.toLocaleString()} bars` : "Already up to date", "success");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Update failed", "error");
    } finally {
      setUpdating(false);
    }
  };

  const uploadCsv = async (file: File) => {
    const fd = new FormData();
    fd.append("symbol", symbol);
    fd.append("file", file);
    try {
      const res = await fetch("/api/market/csv", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await fetch("/api/market/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      toast(`Imported ${json.bars.toLocaleString()} bars from ${file.name}`, "success");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "CSV import failed", "error");
    } finally {
      if (csvRef.current) csvRef.current.value = "";
    }
  };

  const done = chunks.filter((c) => c.status === "done").length;
  const failedCount = chunks.filter((c) => c.status === "failed").length;
  const importedBars = chunks.reduce((s, c) => s + c.bars, 0);
  const symbolCoverage = (data?.coverage ?? []).filter((c) => c.symbol === symbol);
  const base = symbolCoverage.find((c) => c.timeframe === "1m");

  return (
    <Page>
      <PageHeader
        title="Market data"
        meta="Candles are stored once here and read by the chart, the replay and your engine"
      />

      <div className="grid gap-3">
        {data && !data.databento.configured && (
          <Panel title="Databento not configured">
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              Create a file called <span className="mono text-ink">.env.local</span> in the project folder containing:
            </p>
            <pre className="mono text-[12px] text-ink-2 bg-base border border-line rounded-sm px-3 py-2 mt-2">DATABENTO_API_KEY=your_key_here</pre>
            <p className="text-[12px] text-ink-3 mt-2 leading-relaxed">
              Then restart the app. The key stays on your machine — it is never sent to the browser, written to the
              database, or included in an error message. You can also import a CSV below without a key.
            </p>
          </Panel>
        )}

        <Panel title="Import from Databento" subtitle={data ? `Dataset ${data.databento.dataset}` : undefined}>
          <div className="grid sm:grid-cols-4 gap-3">
            <Field label="Store as" hint="Symbol used inside this app">
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} disabled={running} />
            </Field>
            <Field label="Databento symbol" hint="Continuous front month">
              <Input value={dbSymbol} onChange={(e) => setDbSymbol(e.target.value)} disabled={running} />
            </Field>
            <Field label="From">
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={running} />
            </Field>
            <Field label="To">
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={running} />
            </Field>
          </div>

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <Button variant="primary" onClick={runImport} disabled={running || !data?.databento.configured}>
              {running ? "Importing…" : `Import ${planned.length} month${planned.length === 1 ? "" : "s"} of 1m bars`}
            </Button>
            {running && (
              <Button
                onClick={() => {
                  cancelled.current = true;
                }}
              >
                Stop
              </Button>
            )}
            {!running && failedCount > 0 && <Button onClick={retryFailed}>Retry {failedCount} failed</Button>}
            <input
              ref={csvRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])}
            />
            <Button variant="primary" onClick={updateToToday} disabled={updating || running || !data?.databento.configured}>
              {updating ? "Updating…" : "Update to today"}
            </Button>
            <Button onClick={() => csvRef.current?.click()} disabled={running}>
              Import CSV instead
            </Button>
            <span className="text-[11.5px] text-ink-3">
              Fetched one month at a time — a failure costs one month, not the whole range.
            </span>
          </div>

          {chunks.length > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-[12px] text-ink-2">
                  {done} / {chunks.length} months · {importedBars.toLocaleString()} bars
                  {failedCount > 0 && <span className="text-neg"> · {failedCount} failed</span>}
                </span>
                {running && <Spinner />}
              </div>
              <div className="flex flex-wrap gap-[3px]">
                {chunks.map((c) => (
                  <span
                    key={c.label}
                    title={`${c.label}${c.bars ? ` · ${c.bars.toLocaleString()} bars` : ""}${c.error ? ` · ${c.error}` : ""}`}
                    className={`h-[16px] px-1.5 rounded-xs text-[10px] flex items-center tnum ${
                      c.status === "done"
                        ? "bg-pos/15 text-pos"
                        : c.status === "failed"
                        ? "bg-neg/15 text-neg"
                        : c.status === "running"
                        ? "bg-accent/20 text-accent"
                        : "bg-line-soft text-ink-3"
                    }`}
                  >
                    {c.label.slice(2)}
                  </span>
                ))}
              </div>
              {chunks.find((c) => c.error) && (
                <p className="text-[11.5px] text-neg mt-2">{chunks.find((c) => c.error)?.error}</p>
              )}
            </div>
          )}
        </Panel>

        <Panel
          title="Sub-minute data"
          subtitle="1-second bars, and the 30-second bars built from them"
          collapsible
          defaultCollapsed
          storageKey="tj.panel.subMinute"
        >
          <p className="text-[12.5px] text-ink-2 leading-relaxed mb-3">
            Databento&rsquo;s finest OHLCV schema is one second, so 30s bars have to be built from 1s — they cannot come
            from the 1-minute base. One second of data is roughly sixty times the size of one minute, so import it for
            the stretches you actually study rather than for years at a time. It is also what resolves a bar that touched
            both your stop and your target.
          </p>
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <Field label="From">
              <Input type="date" value={subStart} onChange={(e) => setSubStart(e.target.value)} disabled={subBusy} />
            </Field>
            <Field label="To" hint="One month maximum">
              <Input type="date" value={subEnd} onChange={(e) => setSubEnd(e.target.value)} disabled={subBusy} />
            </Field>
            <Button variant="primary" onClick={importSubMinute} disabled={subBusy || !data?.databento.configured}>
              {subBusy ? "Importing…" : "Import 1s bars"}
            </Button>
          </div>
          {subProgress && <p className="text-[11.5px] text-ink-3 mt-2 tnum">{subProgress}</p>}
        </Panel>

        <Panel title="Stored candles" flush>
          {!data ? (
            <div className="p-4">
              <Spinner label="Reading market database…" />
            </div>
          ) : !data.coverage.length ? (
            <EmptyState
              title="No candles stored yet"
              body="Import from Databento above, or load a CSV. Everything from 2m to weekly is built from the 1-minute bars, so you only ever download 1m."
            />
          ) : (
            <div className="p-4 grid gap-4">
              {[...new Set(data.coverage.map((c) => c.symbol))].map((sym) => {
                const rows = data.coverage.filter((c) => c.symbol === sym);
                const oneMin = rows.find((r) => r.timeframe === "1m");
                return (
                  <div key={sym}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[13px] font-medium">{sym}</span>
                      {oneMin?.first && (
                        <span className="text-[11.5px] text-ink-3">
                          {fmtDate(new Date(oneMin.first).toISOString().slice(0, 10))} →{" "}
                          {oneMin.last ? fmtDate(new Date(oneMin.last).toISOString().slice(0, 10)) : "—"}
                        </span>
                      )}
                    </div>
                    <StatRow cols={6}>
                      {rows
                        .filter((r) => CORE_TIMEFRAMES.includes(r.timeframe))
                        .map((r) => (
                          <Stat key={r.timeframe} label={TF_LABEL[r.timeframe]} value={r.bars.toLocaleString()} sub="bars" />
                        ))}
                    </StatRow>
                    <div className="flex flex-wrap gap-1 mt-3">
                      {rows
                        .filter((r) => !CORE_TIMEFRAMES.includes(r.timeframe))
                        .map((r) => (
                          <Tag key={r.timeframe}>
                            {r.timeframe} · {r.bars.toLocaleString()}
                          </Tag>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {base && (
          <Panel title="For your engine" collapsible defaultCollapsed storageKey="tj.panel.engineFeed">
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              Point your Python engine at this endpoint so it reads the same bars the charts do:
            </p>
            <pre className="mono text-[11.5px] text-ink-2 bg-base border border-line rounded-sm px-3 py-2 mt-2 overflow-x-auto">{`GET /api/candles?symbol=${symbol}&tf=1m&from=2026-01-01&to=2026-02-01&limit=50000

→ { "symbol": "${symbol}", "timeframe": "1m", "count": n,
    "candles": [ { "ts": 1767225600000, "open": …, "high": …, "low": …, "close": …, "volume": … } ] }`}</pre>
            <p className="text-[11.5px] text-ink-3 mt-2">
              ts is epoch milliseconds UTC at the bar open. tf accepts any stored timeframe. Daily, weekly and 4H bars
              are anchored to the 18:00 ET CME session open.
            </p>
          </Panel>
        )}

        {data && data.imports.length > 0 && (
          <Panel title="Import history" flush collapsible defaultCollapsed storageKey="tj.panel.importHistory">
            <table className="w-full text-[12.5px]">
              <tbody>
                {data.imports.map((r) => (
                  <tr key={r.id} className="border-b border-line-soft last:border-0 transition-colors hover:bg-hover/45">
                    <td className="px-4 py-2 text-ink-3 tnum whitespace-nowrap">{r.created_at.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-2 py-2">{r.symbol}</td>
                    <td className="px-2 py-2 text-ink-3">{r.source}</td>
                    <td className="px-2 py-2 text-right tnum">{r.bars.toLocaleString()}</td>
                    <td className="px-2 py-2">
                      {r.status === "complete" ? <Tag tone="pos">ok</Tag> : <Tag tone="neg">{r.status}</Tag>}
                    </td>
                    <td className="px-4 py-2 text-ink-3 truncate max-w-[420px]">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </Page>
  );
}
