"use client";

import React, { useMemo } from "react";
import { useApp } from "./app-context";
import { PeriodPreset, useFilters } from "./filter-context";
import { Button, Input, Popover, Select } from "./ui";
import { RESULT_CODES, RESULT_LABEL, ResultCode } from "@/lib/types";
import { WEEKDAYS } from "@/lib/stats";
import { fmtDateShort } from "@/lib/format";

const PERIODS: { value: PeriodPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  if (!options.length) return null;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={`h-[22px] px-2 rounded-xs border text-[11.5px] transition-colors ${
              selected.includes(o) ? "border-accent/60 bg-accent/12 text-ink" : "border-line text-ink-3 hover:text-ink-2"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FilterBar() {
  const app = useApp();
  const { filters, set, clear, activeCount, range } = useFilters();

  const options = useMemo(() => {
    const uniq = (xs: (string | null)[]) => [...new Set(xs.map((x) => x ?? "—"))].sort();
    return {
      instruments: uniq(app.trades.map((t) => t.instrument)),
      sessions: uniq(app.trades.map((t) => t.session)),
      strategies: uniq(app.trades.map((t) => t.strategy)),
      setups: uniq(app.trades.map((t) => t.setup)),
    };
  }, [app.trades]);

  const rangeLabel =
    filters.period === "custom" && (range.from || range.to)
      ? `${range.from ? fmtDateShort(range.from) : "…"} → ${range.to ? fmtDateShort(range.to) : "…"}`
      : null;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="hidden sm:inline-flex items-center bg-base border border-line rounded-sm p-[2px] h-7">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => set({ period: p.value })}
            className={`px-2 h-full rounded-xs text-[12px] transition-colors duration-100 ${
              filters.period === p.value ? "bg-raised text-ink" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <Select className="sm:hidden h-7! py-0! w-[92px]" value={filters.period} onChange={(e) => set({ period: e.target.value as PeriodPreset })}>
        {PERIODS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>

      {filters.period === "custom" && (
        <div className="hidden md:flex items-center gap-1.5">
          <Input
            type="date"
            className="h-7! py-0! w-[132px] text-[12px]!"
            value={filters.from ?? ""}
            onChange={(e) => set({ from: e.target.value || null })}
          />
          <span className="text-ink-3 text-[12px]">→</span>
          <Input
            type="date"
            className="h-7! py-0! w-[132px] text-[12px]!"
            value={filters.to ?? ""}
            onChange={(e) => set({ to: e.target.value || null })}
          />
        </div>
      )}

      <Popover
        width={320}
        trigger={({ toggle, open }) => (
          <Button onClick={toggle} className={open ? "border-accent/60" : ""}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1.5 2.5h9L7 6.8V10L5 9V6.8z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
            </svg>
            Filters
            {activeCount > 0 && (
              <span className="ml-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-accent/20 text-accent text-[10.5px] flex items-center justify-center tnum">
                {activeCount}
              </span>
            )}
          </Button>
        )}
      >
        {() => (
          <div className="p-3 grid gap-3.5 max-h-[70vh] overflow-y-auto">
            <MultiSelect label="Instrument" options={options.instruments} selected={filters.instruments} onChange={(v) => set({ instruments: v })} />
            <MultiSelect label="Direction" options={["long", "short"]} selected={filters.directions} onChange={(v) => set({ directions: v })} />
            <MultiSelect label="Session" options={options.sessions} selected={filters.sessions} onChange={(v) => set({ sessions: v })} />
            <MultiSelect label="Strategy" options={options.strategies} selected={filters.strategies} onChange={(v) => set({ strategies: v })} />
            <MultiSelect label="Setup" options={options.setups} selected={filters.setups} onChange={(v) => set({ setups: v })} />
            <div>
              <div className="label mb-1.5">Result</div>
              <div className="flex flex-wrap gap-1">
                {RESULT_CODES.map((rc) => (
                  <button
                    key={rc}
                    onClick={() =>
                      set({ results: filters.results.includes(rc) ? filters.results.filter((x) => x !== rc) : [...filters.results, rc as ResultCode] })
                    }
                    className={`h-[22px] px-2 rounded-xs border text-[11.5px] transition-colors ${
                      filters.results.includes(rc) ? "border-accent/60 bg-accent/12 text-ink" : "border-line text-ink-3 hover:text-ink-2"
                    }`}
                  >
                    {RESULT_LABEL[rc]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-1.5">Day of week</div>
              <div className="flex flex-wrap gap-1">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <button
                    key={d}
                    onClick={() => set({ weekdays: filters.weekdays.includes(d) ? filters.weekdays.filter((x) => x !== d) : [...filters.weekdays, d] })}
                    className={`h-[22px] px-2 rounded-xs border text-[11.5px] transition-colors ${
                      filters.weekdays.includes(d) ? "border-accent/60 bg-accent/12 text-ink" : "border-line text-ink-3 hover:text-ink-2"
                    }`}
                  >
                    {WEEKDAYS[d].slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-1.5">Time of day (hour)</div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  placeholder="From"
                  className="h-7! py-0! text-[12px]!"
                  value={filters.hourFrom ?? ""}
                  onChange={(e) => set({ hourFrom: e.target.value === "" ? null : Number(e.target.value) })}
                />
                <span className="text-ink-3">→</span>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  placeholder="To"
                  className="h-7! py-0! text-[12px]!"
                  value={filters.hourTo ?? ""}
                  onChange={(e) => set({ hourTo: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </div>
            </div>
            {filters.period === "custom" && (
              <div className="md:hidden grid grid-cols-2 gap-2">
                <Input type="date" className="h-7! py-0! text-[12px]!" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || null })} />
                <Input type="date" className="h-7! py-0! text-[12px]!" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || null })} />
              </div>
            )}
          </div>
        )}
      </Popover>

      {rangeLabel && <span className="hidden xl:inline text-[11.5px] text-ink-3 tnum">{rangeLabel}</span>}

      {activeCount > 0 && (
        <Button variant="ghost" onClick={clear} title="Clear all filters">
          Clear
        </Button>
      )}
    </div>
  );
}
