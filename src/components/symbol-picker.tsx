"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "./ui";
import { GROUPS, searchSymbols, type SymbolInfo } from "@/lib/symbols";
import { money } from "@/lib/format";
import { api } from "@/lib/client";
import type { Quote } from "@/lib/portfolio";

/**
 * Pick a symbol by name instead of remembering a ticker.
 *
 * The catalogue is bundled rather than fetched, so the list appears instantly and works with no
 * network at all. Anything not in it can still be typed — the list is a shortcut, not a fence, and
 * a picker that refuses an unlisted ticker would be worse than the plain text box it replaced.
 */

export function SymbolPicker({
  value,
  onChange,
  autoFocus,
  placeholder = "Search — AAPL, Apple, S&P 500…",
}: {
  value: string;
  onChange: (symbol: string, info: SymbolInfo | null) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchSymbols(query, 60), [query]);

  // Group the results, but only while browsing. Once you are searching, ranked order is the whole
  // point — regrouping would bury the best match under a heading.
  const grouped = useMemo(() => {
    if (query.trim()) return null;
    return GROUPS.map((g) => ({ group: g, items: results.filter((r) => r.group === g) })).filter((g) => g.items.length);
  }, [results, query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => setHighlight(0), [query]);

  const choose = (info: SymbolInfo) => {
    onChange(info.symbol, info);
    setQuery("");
    setOpen(false);
  };

  const commitTyped = () => {
    const typed = query.trim().toUpperCase();
    if (!typed) return;
    // An exact catalogue hit wins; otherwise take it at face value so unlisted tickers still work.
    const exact = results.find((r) => r.symbol === typed);
    onChange(typed, exact ?? null);
    setQuery("");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && results[highlight]) choose(results[highlight]);
      else commitTyped();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const Row = ({ info, index }: { info: SymbolInfo; index: number }) => (
    <button
      type="button"
      onMouseEnter={() => setHighlight(index)}
      onClick={() => choose(info)}
      className={`w-full text-left px-2.5 py-[7px] flex items-baseline gap-2.5 transition-colors ${
        index === highlight ? "bg-raised" : "hover:bg-raised"
      }`}
    >
      <span className="font-medium text-body w-[62px] shrink-0">{info.symbol}</span>
      <span className="text-body text-ink-3 truncate flex-1">{info.name}</span>
    </button>
  );

  let flat = -1;

  return (
    <div ref={boxRef} className="relative">
      {value ? (
        <div className="field flex items-center justify-between gap-2 !py-0 h-[30px]">
          <span className="font-medium text-body">{value}</span>
          <button
            type="button"
            className="text-ink-3 hover:text-ink text-caption shrink-0"
            onClick={() => {
              onChange("", null);
              setOpen(true);
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
        />
      )}

      {open && !value && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-[280px] overflow-y-auto bg-surface border border-line rounded-sm elev-2">
          {results.length === 0 ? (
            <div className="px-2.5 py-3 text-body text-ink-3">
              Nothing in the list matches. Press return to use{" "}
              <span className="text-ink font-medium">{query.trim().toUpperCase()}</span> anyway.
            </div>
          ) : grouped ? (
            grouped.map((g) => (
              <div key={g.group}>
                <div className="px-2.5 pt-2 pb-1 eyebrow text-ink-4 sticky top-0 bg-surface">
                  {g.group}
                </div>
                {g.items.map((info) => {
                  flat++;
                  return <Row key={info.symbol} info={info} index={flat} />;
                })}
              </div>
            ))
          ) : (
            results.map((info, i) => <Row key={info.symbol} info={info} index={i} />)
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The live price for a chosen symbol, shown next to the cost field.
 *
 * Read-only by default. The button copies it into the cost basis only when you say so, because
 * today's price is your cost only if you are buying today — silently filling it would make an old
 * position report roughly zero return and understate everything above it.
 */
export function LivePrice({ symbol, onUse }: { symbol: string; onUse?: (price: number) => void }) {
  const [state, setState] = useState<{ quote: Quote | null; pricingEnabled: boolean } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!symbol) return setState(null);
    let live = true;
    setState(null);
    setError(false);
    api
      .quote(symbol)
      .then((r) => live && setState({ quote: r.quote, pricingEnabled: r.pricingEnabled }))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [symbol]);

  if (!symbol) return null;
  if (error) return <div className="text-caption text-ink-3">Could not reach the price feed.</div>;
  if (!state) return <div className="text-caption text-ink-3">Checking price…</div>;

  if (!state.pricingEnabled) {
    return <div className="text-caption text-warn">Live prices are off — set FINNHUB_API_KEY to see the current price here.</div>;
  }
  if (!state.quote) {
    return <div className="text-caption text-warn">No price found for {symbol}. Check the ticker.</div>;
  }

  return (
    <div className="flex items-baseline gap-2 text-caption">
      <span className="text-ink-3">
        Trading at <span className="text-ink tnum">{money(state.quote.price)}</span>
      </span>
      {onUse && (
        <button type="button" className="text-accent hover:underline" onClick={() => onUse(state.quote!.price)}>
          use as my cost
        </button>
      )}
    </div>
  );
}
