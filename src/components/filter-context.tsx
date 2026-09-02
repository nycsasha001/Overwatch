"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ResultCode, Trade } from "@/lib/types";
import { isoDate } from "@/lib/format";
import { weekdayOf } from "@/lib/stats";

export type PeriodPreset = "today" | "week" | "month" | "year" | "all" | "custom";

export interface FilterState {
  period: PeriodPreset;
  from: string | null;
  to: string | null;
  instruments: string[];
  directions: string[];
  sessions: string[];
  strategies: string[];
  setups: string[];
  results: ResultCode[];
  weekdays: number[];
  hourFrom: number | null;
  hourTo: number | null;
}

export const EMPTY_FILTERS: FilterState = {
  period: "all",
  from: null,
  to: null,
  instruments: [],
  directions: [],
  sessions: [],
  strategies: [],
  setups: [],
  results: [],
  weekdays: [],
  hourFrom: null,
  hourTo: null,
};

interface FilterValue {
  filters: FilterState;
  set: (patch: Partial<FilterState>) => void;
  clear: () => void;
  activeCount: number;
  range: { from: string | null; to: string | null };
  apply: (trades: Trade[]) => Trade[];
  /** Applies everything except the date period — useful for "all time" context. */
  applyNonDate: (trades: Trade[]) => Trade[];
}

const Ctx = createContext<FilterValue | null>(null);

export function useFilters() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFilters must be used inside FilterProvider");
  return v;
}

export function periodRange(period: PeriodPreset, from: string | null, to: string | null, weekStartsOn = 0) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "today":
      return { from: isoDate(startOfDay), to: isoDate(startOfDay) };
    case "week": {
      const d = new Date(startOfDay);
      const diff = (d.getDay() - weekStartsOn + 7) % 7;
      d.setDate(d.getDate() - diff);
      return { from: isoDate(d), to: isoDate(startOfDay) };
    }
    case "month":
      return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(startOfDay) };
    case "year":
      return { from: isoDate(new Date(now.getFullYear(), 0, 1)), to: isoDate(startOfDay) };
    case "custom":
      return { from, to };
    default:
      return { from: null, to: null };
  }
}

const STORAGE_KEY = "tj.filters";

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setFilters({ ...EMPTY_FILTERS, ...JSON.parse(raw) });
    } catch {
      /* ignore malformed preference */
    }
  }, []);

  const set = useCallback((patch: Partial<FilterState>) => {
    setFilters((f) => {
      const next = { ...f, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — filters simply will not persist */
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<FilterValue>(() => {
    const range = periodRange(filters.period, filters.from, filters.to);

    const matchNonDate = (t: Trade) => {
      if (filters.instruments.length && !filters.instruments.includes(t.instrument)) return false;
      if (filters.directions.length && !filters.directions.includes(t.direction)) return false;
      if (filters.sessions.length && !filters.sessions.includes(t.session ?? "—")) return false;
      if (filters.strategies.length && !filters.strategies.includes(t.strategy ?? "—")) return false;
      if (filters.setups.length && !filters.setups.includes(t.setup ?? "—")) return false;
      if (filters.results.length && !filters.results.includes(t.result)) return false;
      if (filters.weekdays.length && !filters.weekdays.includes(weekdayOf(t.date))) return false;
      if (filters.hourFrom !== null || filters.hourTo !== null) {
        if (!t.time) return false;
        const h = Number(t.time.slice(0, 2));
        if (filters.hourFrom !== null && h < filters.hourFrom) return false;
        if (filters.hourTo !== null && h > filters.hourTo) return false;
      }
      return true;
    };

    const matchDate = (t: Trade) => {
      if (range.from && t.date < range.from) return false;
      if (range.to && t.date > range.to) return false;
      return true;
    };

    const activeCount =
      (filters.period !== "all" ? 1 : 0) +
      filters.instruments.length +
      filters.directions.length +
      filters.sessions.length +
      filters.strategies.length +
      filters.setups.length +
      filters.results.length +
      filters.weekdays.length +
      (filters.hourFrom !== null || filters.hourTo !== null ? 1 : 0);

    return {
      filters,
      set,
      clear,
      activeCount,
      range,
      apply: (trades: Trade[]) => trades.filter((t) => matchDate(t) && matchNonDate(t)),
      applyNonDate: (trades: Trade[]) => trades.filter(matchNonDate),
    };
  }, [filters, set, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
