"use client";

import React, { useMemo, useState } from "react";
import { useApp } from "@/components/app-context";
import { useFilters } from "@/components/filter-context";
import { Page, PageHeader } from "@/components/shell";
import { Button, EmptyState, Input, Panel, useToast } from "@/components/ui";
import { TradeTable } from "@/components/trade-table";
import { useTradeEditor } from "@/components/trade-editor";
import { computeMetrics } from "@/lib/stats";
import { money, pct, r as fmtR } from "@/lib/format";

type SortKey = "date" | "pnl" | "r" | "instrument";

export default function JournalPage() {
  const app = useApp();
  const { apply, activeCount } = useFilters();
  const editor = useTradeEditor();
  const [query, setQuery] = useState("");
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  /**
   * Send the trades currently in view to the Obsidian vault.
   *
   * The vault path is not sent with the request — the server reads it from settings — so this
   * cannot be pointed at somewhere else by anything reaching the API.
   */
  const exportToObsidian = async () => {
    if (!trades.length) return;
    setExporting(true);
    try {
      const res = await fetch("/api/obsidian/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeIds: trades.map((t) => t.id) }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast(j.error ?? "Could not export", "error");
        return;
      }
      // Say what was skipped as well as what was written. A silent partial success is how you find
      // out days later that half your trades never made it.
      const skipped = (j.skipped ?? []).length;
      toast(
        `${j.written} note${j.written === 1 ? "" : "s"} written to ${j.folder}` +
          (skipped ? ` · ${skipped} skipped, a note of that name was already there` : ""),
        skipped ? "error" : "success"
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not reach the vault", "error");
    } finally {
      setExporting(false);
    }
  };
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const trades = useMemo(() => {
    let list = apply(app.trades);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [t.instrument, t.setup, t.strategy, t.session, t.thesis, t.review, t.mistakes, t.emotions, t.execution, t.tags.join(" ")]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    const mul = dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sort) {
        case "pnl":
          return (a.pnl - b.pnl) * mul;
        case "r":
          return ((a.rMultiple ?? 0) - (b.rMultiple ?? 0)) * mul;
        case "instrument":
          return a.instrument.localeCompare(b.instrument) * mul;
        default:
          return (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time ?? "").localeCompare(b.time ?? "")) * mul;
      }
    });
  }, [apply, app.trades, query, sort, dir]);

  const metrics = useMemo(() => computeMetrics(trades, app.settings), [trades, app.settings]);

  const exportUrl = `/api/trades/export?accountId=${encodeURIComponent(app.accountId || "all")}&ids=${trades.map((t) => t.id).join(",")}`;

  return (
    <Page>
      <PageHeader
        title="Journal"
        meta={
          trades.length
            ? `${trades.length} trades · ${money(metrics.netPnl, app.currency, { sign: true })} · ${fmtR(metrics.netR)} · ${pct(metrics.winRate)} win rate`
            : "No trades in view"
        }
        actions={
          <>
            <Input placeholder="Search notes, setups, tags…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-7! w-[220px] text-[12.5px]!" />
            <a href={exportUrl} download>
              <Button>Export CSV</Button>
            </a>
            <Button
              onClick={exportToObsidian}
              disabled={exporting || !trades.length}
              title="Write these trades into your Obsidian vault as markdown notes"
            >
              {exporting ? "Writing…" : "Send to Obsidian"}
            </Button>
          </>
        }
      />

      <Panel
        flush
        title="All trades"
        actions={
          <div className="flex items-center gap-1.5">
            <select className="field h-6! py-0! text-[11.5px]! w-[104px]" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="date">Date</option>
              <option value="pnl">P&amp;L</option>
              <option value="r">R multiple</option>
              <option value="instrument">Instrument</option>
            </select>
            <Button variant="ghost" onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}>
              {dir === "asc" ? "↑" : "↓"}
            </Button>
          </div>
        }
      >
        {!app.trades.length ? (
          <EmptyState
            title="Your journal is empty"
            body="Record a trade to start the journal. Each entry keeps your thesis, execution notes, mistakes, screenshots and the numbers together."
            action={
              <Button variant="primary" size="md" onClick={() => editor.open(null)}>
                Add your first trade
              </Button>
            }
          />
        ) : !trades.length ? (
          <EmptyState
            compact
            title="Nothing matches"
            body={activeCount > 0 || query ? "Try widening the filters or clearing the search." : "No trades recorded."}
          />
        ) : (
          <TradeTable trades={trades} />
        )}
      </Panel>
    </Page>
  );
}
