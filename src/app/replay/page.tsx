"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Page, PageHeader } from "@/components/shell";
import { Button, EmptyState, Field, Input, Modal, Panel, Popover, Segmented, Select, Spinner, Switch, useToast } from "@/components/ui";
import { Stat } from "@/components/stat";
import { CHART, PriceChart, type ChartLevel } from "@/components/price-chart";
import { TimeframeSelect } from "@/components/timeframe-select";
import { IndicatorsMenu, defaultIndicators, type IndicatorState } from "@/components/indicators-menu";
import { fairValueGaps, po3Candles, sessionLevels } from "@/lib/indicators";
import { DrawingSettingsDialog, DrawingToolbar, FloatingDrawingBar, type DrawingTemplate, type SettingsTab } from "@/components/drawing-toolbar";
import { seedPosition, styleFor, type Anchor, type Drawing, type DrawingKind, type DrawingStyle, type MagnetMode } from "@/lib/drawings";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app-context";
import { aggregate, bucketStart, ensureAscending, type Candle, type Timeframe } from "@/lib/aggregate";
import { riskFor, specFor } from "@/lib/contracts";
import {
  closeAtMarket,
  fillAtMarket,
  rOf,
  sessionStats,
  step as stepPosition,
  tryFill,
  validateOrder,
  type ClosedTrade,
  type Direction,
  type EntryType,
  type OrderDraft,
  type Position,
} from "@/lib/replay";
import { etDateTime, tradeInstant, tradingDay } from "@/lib/session";
import { describeSession, resumeBlocker, type ReplaySession } from "@/lib/replay-session";
import { api } from "@/lib/client";
import { fmtDate, money, num, pct, r as fmtR } from "@/lib/format";

const REPLAY_TIMEFRAMES: Timeframe[] = ["30s", "1m", "2m", "3m", "4m", "5m", "15m", "1h", "4h", "1d"];
const SESSION_KEY = "tj.replay.session";
/** Every quarter hour of the day, New York time — what the jump menu offers. */
const QUARTER_HOURS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

/**
 * How much completed history sits behind the replay cursor.
 *
 * Everything stored, up to what the candles endpoint will serve in one request. It used to be 600
 * bars, which is a few hours on a 1m chart — not enough to see a weekly high, a prior month's
 * range, or any level far enough back to matter. You cannot backtest against structure you cannot
 * see.
 *
 * 50,000 bars of 1m is about four months of continuous session; on a 1h chart it is years.
 * lightweight-charts handles that without complaint, and the read is from local SQLite.
 */
const HISTORY_BARS = 50_000;

/**
 * A preview before a session starts, purely so the chart is not blank while you pick a date.
 * Smaller because nothing is being analysed yet — the full history loads when replay begins.
 */
const PREVIEW_BARS = 5_000;

/**
 * A memory backstop, not a display limit.
 *
 * The old ceiling was 4,000 and it trimmed back to 600 — so a long session would quietly throw
 * away almost all of its history mid-run, and the levels you had been watching would vanish. This
 * one exists only so an unattended overnight run cannot grow without bound, and when it does fire
 * it keeps a window still far larger than anything you would be reading.
 */
const MAX_HISTORY_BARS = 150_000;
const TRIM_TO_BARS = 120_000;
const REFILL_AT = 120; // fetch more when this close to the end of the buffer

interface CoverageRow {
  symbol: string;
  timeframe: Timeframe;
  bars: number;
  first: number | null;
  last: number | null;
}

/**
 * The replay bar's clock, and the entry time in the trade list.
 *
 * Carries the year for the same reason the crosshair does: replay runs over historical data, and a
 * date without a year is ambiguous the moment you have more than one year of bars stored.
 */
const etClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export default function ReplayPage() {
  const app = useApp();
  const router = useRouter();
  const toast = useToast();

  const [coverage, setCoverage] = useState<CoverageRow[] | null>(null);
  const [symbol, setSymbol] = useState("MNQ");
  const [startDate, setStartDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [replayMode, setReplayMode] = useState(false);

  const [buffer, setBuffer] = useState<Candle[]>([]);
  const [cursor, setCursor] = useState(0);
  const [tf, setTf] = useState<Timeframe>("5m");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [exhausted, setExhausted] = useState(false);
  /** Stepping resolution. 30s halves how often a bar can touch both stop and target. */
  const [baseTf, setBaseTf] = useState<Timeframe>("1m");

  const [order, setOrder] = useState<OrderDraft | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [trades, setTrades] = useState<ClosedTrade[]>([]);
  const [selectingBar, setSelectingBar] = useState(false);

  // Mirrors, so a multi-bar jump can simulate synchronously instead of relying on batched state.
  const orderRef = useRef<OrderDraft | null>(null);
  const posRef = useRef<Position | null>(null);
  // Autosave reads the trade list from a timer, long after the render that scheduled it. Reading
  // state there would capture whichever array existed when the timer was set.
  const tradesRef = useRef<ClosedTrade[]>([]);
  orderRef.current = order;
  posRef.current = position;
  tradesRef.current = trades;

  // Order ticket
  const [direction, setDirection] = useState<Direction>("long");
  const [entryType, setEntryType] = useState<EntryType>("market");
  const [entryPrice, setEntryPrice] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [contracts, setContracts] = useState("2");
  const [ticketError, setTicketError] = useState<string | null>(null);

  const [showTrades, setShowTrades] = useState(false);
  const [stepTf, setStepTf] = useState<Timeframe | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [magnet, setMagnet] = useState<MagnetMode>("off");
  const [indicators, setIndicators] = useState<IndicatorState>(defaultIndicators);
  const [jumpDate, setJumpDate] = useState("");
  /** New York wall-clock time to land on, in quarter hours. 09:30 is the New York open. */
  const [jumpTime, setJumpTime] = useState("09:30");
  const [resetSignal, setResetSignal] = useState(0);
  const captureRef = useRef<(() => Promise<Blob | null>) | null>(null);
  const positionDrawingId = useRef<string | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [tool, setTool] = useState<DrawingKind | null>(null);
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<Record<string, string>>({});
  const [contextMenu, setContextMenu] = useState<{ price: number; x: number; y: number } | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("style");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(120);
  const [hoverBar, setHoverBar] = useState<{ ts: number; open?: number; high?: number; low?: number; close?: number } | null>(null);
  const [history, setHistory] = useState<{ bucket: number; symbol: string; tf: Timeframe; bars: Candle[] } | null>(null);
  /**
   * Bumped whenever the chart's frame of reference changes — a session started, or a jump to
   * somewhere the bars behind the cursor are no longer continuous with what is drawn. History is
   * fetched once per epoch and grown by appending after that, so the window never slides.
   */
  const [epoch, setEpoch] = useState(0);
  const [liveBars, setLiveBars] = useState<Candle[] | null>(null);
  const [autoLog, setAutoLog] = useState(true);
  const [logAccountId, setLogAccountId] = useState("");
  const [strategy, setStrategy] = useState("");
  const [setup, setSetup] = useState("");

  /* --------------------------- saved replay sessions ------------------------ */

  const [sessions, setSessions] = useState<ReplaySession[] | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  /** The named save being worked in, so "Save" updates it rather than piling up copies. */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  const restored = useRef(false);
  const currentBarRef = useRef<Candle | null>(null);
  const jumpToTimeRef = useRef<((ts: number, exclusive?: boolean) => Promise<void>) | null>(null);

  /* ------------------------------- loading -------------------------------- */

  useEffect(() => {
    fetch("/api/market/coverage")
      .then((r) => r.json())
      .then((j) => {
        setCoverage(j.coverage ?? []);
        const first = (j.coverage ?? []).find((c: CoverageRow) => c.timeframe === "1m");
        if (first) setSymbol(first.symbol);
      })
      .catch(() => setCoverage([]));
  }, []);

  useEffect(() => {
    if (app.settings.defaultContracts) setContracts(String(app.settings.defaultContracts));
  }, [app.settings.defaultContracts]);

  useEffect(() => {
    const saved = app.settings.indicators;
    if (!saved) return;
    setIndicators((prev) => ({
      ...prev,
      fvg: !!saved.fvg,
      sessions: !!saved.sessions,
      po3: !!saved.po3,
      fvgHidden: !!(saved as Record<string, unknown>).fvgHidden,
      sessionsHidden: !!(saved as Record<string, unknown>).sessionsHidden,
      po3Hidden: !!(saved as Record<string, unknown>).po3Hidden,
      fvgOptions: { ...prev.fvgOptions, ...((saved.fvgOptions ?? {}) as object) },
      sessionOptions: { ...prev.sessionOptions, ...((saved.sessionOptions ?? {}) as object) },
      po3Options: { ...prev.po3Options, ...((saved.po3Options ?? {}) as object) },
    }));
    // only on first load; afterwards the menu is the source of truth
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateIndicators = useCallback(
    (next: IndicatorState) => {
      setIndicators(next);
      void app.patchSettings({
        indicators: {
          fvg: next.fvg,
          sessions: next.sessions,
          po3: next.po3,
          fvgHidden: next.fvgHidden,
          sessionsHidden: next.sessionsHidden,
          po3Hidden: next.po3Hidden,
          fvgOptions: next.fvgOptions as unknown as Record<string, unknown>,
          sessionOptions: next.sessionOptions as unknown as Record<string, unknown>,
          po3Options: next.po3Options as unknown as Record<string, unknown>,
        },
      });
    },
    [app]
  );

  useEffect(() => {
    try {
      setPanelOpen(window.localStorage.getItem("tj.replay.panel") === "1");
      const h = Number(window.localStorage.getItem("tj.replay.panelHeight"));
      if (Number.isFinite(h) && h > 0) setPanelHeight(Math.min(Math.max(h, 56), 420));
    } catch {
      /* preference unavailable */
    }
  }, []);

  /** Drag the panel's top edge: upwards makes it taller. */
  const startPanelResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = panelHeight;
      const move = (ev: PointerEvent) => {
        setPanelHeight(Math.min(Math.max(startH + (startY - ev.clientY), 56), 420));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setPanelHeight((h) => {
          try {
            window.localStorage.setItem("tj.replay.panelHeight", String(h));
          } catch {
            /* ignore */
          }
          return h;
        });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [panelHeight]
  );

  const togglePanel = useCallback(() => {
    setPanelOpen((v) => {
      try {
        window.localStorage.setItem("tj.replay.panel", v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  }, []);

  useEffect(() => {
    const preferred =
      app.accounts.find((a) => /replay|backtest|paper|sim/i.test(a.name))?.id ??
      app.accounts.find((a) => a.type === "paper")?.id ??
      "";
    setLogAccountId(preferred);
  }, [app.accounts]);

  const base = useMemo(
    () => (coverage ?? []).find((c) => c.symbol === symbol && c.timeframe === "1m") ?? null,
    [coverage, symbol]
  );

  // Prefer the finest stored resolution for stepping and fills.
  const finest = useMemo<Timeframe>(() => {
    const has = (tf: Timeframe) => (coverage ?? []).some((c) => c.symbol === symbol && c.timeframe === tf && c.bars > 0);
    return has("30s") ? "30s" : "1m";
  }, [coverage, symbol]);

  useEffect(() => setBaseTf(finest), [finest]);

  const fetchBars = useCallback(
    async (from: number, to: number): Promise<Candle[]> => {
      const q = new URLSearchParams({ symbol, tf: baseTf, from: String(from), to: String(to), limit: "20000" });
      const res = await fetch(`/api/candles?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load candles");
      return json.candles as Candle[];
    },
    [symbol, baseTf]
  );

  /**
   * Load a replay session around a date. Returns whether it actually started.
   *
   * Every failure path used to return quietly, and the caller announced success regardless — so a
   * jump that never happened still said "Replaying from …" while the chart sat on the live candles.
   * Each one now reports what went wrong, and the caller waits for the answer.
   */
  /**
   * Begin a session at a date, optionally at an exact instant within it.
   *
   * `atTs` matters because a jump outside the loaded buffer comes through here rather than
   * seeking. Without it the time of day was thrown away and the cursor landed wherever the start
   * of the day happened to be — asking for 09:30 put you hours from it.
   */
  const start = async (fromDate: string, atTs?: number): Promise<boolean> => {
    if (!base?.first) {
      toast(`No 1-minute data stored for ${symbol} — import it from Market data first`, "error");
      return false;
    }
    setLoading(true);
    try {
      // New York, not UTC. Parsing the date as `T00:00:00Z` put the cursor at 19:00 or 20:00 ET
      // on the previous day, depending on daylight saving.
      const startTs = atTs ?? tradeInstant(fromDate, "00:00");
      if (startTs === null || !Number.isFinite(startTs)) {
        toast(`Could not read "${fromDate}" as a date`, "error");
        return false;
      }
      const bars = await fetchBars(startTs - 5 * 86400000, startTs + 5 * 86400000);
      if (!bars.length) {
        toast(`No ${symbol} candles stored around ${fromDate}`, "error");
        return false;
      }
      const idx = bars.findIndex((b) => b.ts >= startTs);
      setBuffer(bars);
      setCursor(idx <= 0 ? Math.min(200, bars.length - 1) : idx);
      setTrades([]);
      posRef.current = null;
      orderRef.current = null;
      setPosition(null);
      setOrder(null);
      setExhausted(false);
      setStarted(true);
      // Drop the old window rather than growing it: a jump has no continuity with what was drawn.
      setHistory(null);
      reanchoredAt.current = null;
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start", "error");
      return false;
    } finally {
      setLoading(false);
    }
  };

  /* ---------------------------- session recovery --------------------------- */

  /**
   * A replay session lives entirely in React state, so any reload — a refresh, a hot reload while
   * the app is being worked on, a stray navigation — silently threw it away and dropped the chart
   * back to live candles with no explanation. That is indistinguishable from the feature being
   * broken.
   *
   * The cursor's timestamp is enough to rebuild it: the bars come back from the server anyway.
   * Only the position in time is kept, never simulated trades or an open position — reopening a
   * fill that was never really taken would be worse than losing it.
   */

  useEffect(() => {
    if (!started || !currentBarRef.current) return;
    try {
      window.localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ symbol, tf, baseTf, ts: currentBarRef.current.ts })
      );
    } catch {
      /* storage unavailable — the session simply will not survive a reload */
    }
  }, [started, symbol, tf, baseTf, cursor]);

  /**
   * The same session, kept in journal.db rather than in this browser.
   *
   * localStorage above is the fast path: it survives a refresh with no round trip and is what the
   * silent auto-resume reads. This is the durable one — it survives clearing site data, and it
   * carries the part that actually took work, which the localStorage copy deliberately never did:
   * the trades you took and the position you are holding.
   *
   * Debounced, because stepping a bar at a time would otherwise post on every keystroke of the
   * arrow key. Two seconds of stillness is the signal that you have stopped moving.
   */
  useEffect(() => {
    if (!started || !replayMode || !currentBarRef.current) return;
    const ts = currentBarRef.current.ts;
    const timer = window.setTimeout(() => {
      void api
        .saveReplaySession({
          auto: true,
          name: "Where you left off",
          symbol,
          tf,
          baseTf,
          cursorTs: ts,
          state: { trades: tradesRef.current, position: posRef.current },
        })
        .catch(() => {
          /* an autosave that fails is not worth interrupting a replay for */
        });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [started, replayMode, symbol, tf, baseTf, cursor, trades, position]);

  /**
   * Put a saved session back on the chart.
   *
   * Order matters: `start` clears the trade list and any open position by design, so the saved
   * ones are restored after it rather than before, or they would be wiped by the very call that
   * loads their bars.
   */
  const resumeSession = useCallback(
    async (session: ReplaySession) => {
      const blocked = resumeBlocker(session, symbol);
      if (blocked) {
        toast(blocked, "error");
        return;
      }
      setResuming(true);
      try {
        setPlaying(false);
        setTf(session.tf as Timeframe);
        setBaseTf(session.baseTf as Timeframe);
        setReplayMode(true);
        const day = new Date(session.cursorTs).toISOString().slice(0, 10);
        // Through the ref, never directly. `start` is rebuilt every render, and a memoised copy
        // captures the very first one — built before the coverage request came back, closing over
        // `base === null` and refusing every load with "no 1-minute data". The same trap
        // jumpToTime documents a few hundred lines below.
        if (!(await startRef.current(day, session.cursorTs))) return;
        await jumpToTimeRef.current?.(session.cursorTs);

        setTrades(session.trades);
        tradesRef.current = session.trades;
        setPosition(session.position);
        posRef.current = session.position;
        setActiveSessionId(session.auto ? null : session.id);
        setSessionsOpen(false);
        toast(`Resumed — ${describeSession(session)}`, "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not resume that session", "error");
      } finally {
        setResuming(false);
      }
    },
    [symbol, toast]
  );

  const loadSessions = useCallback(async () => {
    try {
      const { sessions: list } = await api.listReplaySessions();
      setSessions(list);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    if (sessionsOpen) void loadSessions();
  }, [sessionsOpen, loadSessions]);

  /** Keep or update a named save. Distinct from the rolling autosave, which never gets a name. */
  const saveNamedSession = useCallback(async () => {
    if (!currentBarRef.current) return;
    setSavingSession(true);
    try {
      const { session } = await api.saveReplaySession({
        id: activeSessionId,
        auto: false,
        name: sessionName.trim() || `${symbol} ${etDateTime(currentBarRef.current.ts).date}`,
        symbol,
        tf,
        baseTf,
        cursorTs: currentBarRef.current.ts,
        state: { trades: tradesRef.current, position: posRef.current },
      });
      setActiveSessionId(session.id);
      setSessionName("");
      await loadSessions();
      toast(`Saved “${session.name}”`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the session", "error");
    } finally {
      setSavingSession(false);
    }
  }, [activeSessionId, sessionName, symbol, tf, baseTf, loadSessions, toast]);

  const removeSession = useCallback(
    async (session: ReplaySession) => {
      try {
        await api.deleteReplaySession(session.id);
        if (activeSessionId === session.id) setActiveSessionId(null);
        await loadSessions();
        toast(`Deleted “${session.name}”`, "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not delete it", "error");
      }
    },
    [activeSessionId, loadSessions, toast]
  );

  useEffect(() => {
    if (restored.current || started || !base?.first) return;
    restored.current = true;
    let saved: { symbol?: string; tf?: Timeframe; ts?: number } | null = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "null");
    } catch {
      saved = null;
    }
    if (!saved?.ts || saved.symbol !== symbol) return;
    if (saved.tf) setTf(saved.tf);
    setReplayMode(true);
    void (async () => {
      const day = new Date(saved!.ts!).toISOString().slice(0, 10);
      if (await start(day)) {
        // Land on the exact bar rather than the start of that day.
        void jumpToTimeRef.current?.(saved!.ts!);
      }
    })();
    // Runs once, as soon as coverage tells us the symbol has data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, started, symbol]);

  const clearSession = useCallback(() => {
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  /**
   * `start` is rebuilt on every render, so anything memoised must reach it through this ref.
   *
   * jumpToTime is a useCallback keyed on the buffer, and the buffer stays empty until a session
   * exists — so it captured the very first `start`, built before the coverage request had come
   * back. That copy closed over `base === null` and refused every jump for the life of the page,
   * insisting there was no 1-minute data while 1.76 million bars sat on disk.
   */
  const startRef = useRef(start);
  startRef.current = start;

  /** Picking the day at random is the cheapest defence against only testing days you remember. */
  const randomDay = () => {
    if (!base?.first || !base.last) return;
    const span = base.last - base.first;
    for (let attempt = 0; attempt < 20; attempt++) {
      const ts = base.first + Math.random() * span;
      const day = tradingDay(ts);
      const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
      if (dow >= 1 && dow <= 5) return day;
    }
    return tradingDay(base.first);
  };

  /* ------------------------------- stepping ------------------------------- */

  const extend = useCallback(async () => {
    const last = buffer[buffer.length - 1];
    if (!last) return;
    try {
      const more = await fetchBars(last.ts + (baseTf === "30s" ? 30000 : 60000), last.ts + 5 * 86400000);
      if (!more.length) {
        setExhausted(true);
        setPlaying(false);
        return;
      }
      setBuffer((b) => [...b, ...more]);
    } catch {
      setExhausted(true);
      setPlaying(false);
    }
  }, [buffer, fetchBars, baseTf]);

  const logTrade = useCallback(
    async (t: ClosedTrade) => {
      if (!autoLog || !logAccountId) return;
      const { date, time } = etDateTime(t.entryTs);
      const result = t.r > 0.05 ? "win" : t.r < -0.05 ? "loss" : "breakeven";
      const reason =
        t.reason === "stop" ? "stopped out" :
        t.reason === "target" ? "target hit" :
        t.reason === "manual" ? "closed manually" :
        t.reason === "gap-stop" ? "gapped through the stop" : "gapped through the target";
      let saved;
      try {
        saved = await api.createTrade({
          accountId: logAccountId,
          date,
          time,
          instrument: symbol,
          direction: t.direction,
          strategy: strategy || null,
          setup: setup || null,
          entry: t.entry,
          stop: t.stop,
          target: t.target,
          exit: t.exit,
          size: t.contracts,
          riskAmount: t.risk,
          result,
          pnl: t.pnl,
          rMultiple: t.r,
          mae: Number(t.mae.toFixed(3)),
          mfe: Number(t.mfe.toFixed(3)),
          tags: ["replay", ...(t.ambiguous ? ["ambiguous-fill"] : [])],
          execution: `Replay on ${symbol}: ${reason} after ${t.bars} one-minute bars.${
            t.ambiguous ? " The closing bar touched both stop and target — the stop was assumed, so this result is the pessimistic reading." : ""
          }`,
        } as unknown as Record<string, unknown>);
        await app.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not log the trade", "error");
        return;
      }

      // A picture of the chart as it stood at the exit, filed against the entry.
      if (!app.settings.replayOptions?.screenshotOnExit || !saved?.id) return;
      try {
        const blob = await captureRef.current?.();
        if (!blob) return;
        const file = new File([blob], `replay-${saved.id}.png`, { type: "image/png" });
        await api.uploadScreenshot(saved.id, "trade", file);
        await app.refresh();
      } catch {
        // A failed capture must never cost the trade record itself.
      }
    },
    [autoLog, logAccountId, symbol, strategy, setup, app, toast]
  );

  /** How many base bars one press of "next candle" advances. */
  const TF_MINUTES: Record<Timeframe, number> = useMemo(
    () => ({ "1s": 1 / 60, "30s": 0.5, "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080 }),
    []
  );
  const effectiveStepTf = stepTf ?? tf;
  const stepBars = Math.max(1, Math.round(TF_MINUTES[effectiveStepTf] / TF_MINUTES[baseTf]));

  /** Run one bar through the simulator. Returns the closed trade, if the bar produced one. */
  const simulateBar = useCallback(
    (bar: Candle): ClosedTrade | null => {
      let closed: ClosedTrade | null = null;
      if (posRef.current) {
        const res = stepPosition(posRef.current, bar);
        posRef.current = res.closed ? null : res.position;
        closed = res.closed;
        if (closed) finishPositionDrawing(closed);
      } else if (orderRef.current) {
        const filled = tryFill(orderRef.current, bar);
        if (filled) {
          posRef.current = filled;
          orderRef.current = null;
          drawPosition(filled);
        }
      }
      return closed;
    },
    []
  );

  const commit = useCallback((nextCursor: number, closedTrades: ClosedTrade[]) => {
    setCursor(nextCursor);
    setPosition(posRef.current);
    setOrder(orderRef.current);
    if (closedTrades.length) {
      setTrades((list) => [...closedTrades.reverse(), ...list]);
      for (const t of closedTrades) void logTrade(t);
    }
  }, [logTrade]);

  const advance = useCallback(() => {
    const next = cursor + 1;
    const bar = buffer[next];
    if (!bar) {
      setPlaying(false);
      void extend();
      return;
    }
    if (buffer.length - next < REFILL_AT && !exhausted) void extend();
    const closed = simulateBar(bar);
    commit(next, closed ? [closed] : []);
  }, [buffer, cursor, extend, exhausted, simulateBar, commit]);

  /** Fast-forward or rewind to a bar. Forward runs every bar through the simulator. */
  const jumpTo = useCallback(
    (index: number) => {
      const target = Math.max(0, Math.min(index, buffer.length - 1));
      if (target === cursor) return;

      if (target < cursor) {
        if (posRef.current || orderRef.current) {
          toast("Close the open position before stepping back", "error");
          return;
        }
        setCursor(target);
        return;
      }

      const closedTrades: ClosedTrade[] = [];
      for (let i = cursor + 1; i <= target; i++) {
        const closed = simulateBar(buffer[i]);
        if (closed) closedTrades.push(closed);
      }
      commit(target, closedTrades);
    },
    [buffer, cursor, simulateBar, commit, toast]
  );

  /**
   * Index of the base bar that completes `count` candles of the stepping timeframe.
   *
   * Walking bucket by bucket keeps every jump landing on a candle boundary. It also has to be a
   * single calculation rather than repeated single steps — calling the stepper N times in one
   * handler would read the same stale cursor each time and only move once.
   */
  const advanceCandles = useCallback(
    (from: number, count: number): number => {
      if (stepBars <= 1) return Math.min(from + count, buffer.length - 1);
      let idx = from;
      for (let n = 0; n < count; n++) {
        const here = buffer[idx];
        if (!here) break;
        const bucket = bucketStart(here.ts, effectiveStepTf);
        let i = idx + 1;
        while (i < buffer.length && bucketStart(buffer[i].ts, effectiveStepTf) === bucket) i++;
        if (i - 1 > idx) {
          idx = i - 1; // finish the candle currently forming
          continue;
        }
        if (i >= buffer.length) break;
        const next = bucketStart(buffer[i].ts, effectiveStepTf);
        let j = i + 1;
        while (j < buffer.length && bucketStart(buffer[j].ts, effectiveStepTf) === next) j++;
        idx = Math.min(j - 1, buffer.length - 1);
      }
      return idx;
    },
    [buffer, effectiveStepTf, stepBars]
  );

  const stepOneCandle = useCallback(() => {
    const target = advanceCandles(cursor, 1);
    if (target <= cursor) {
      advance(); // at the end of the buffer — advance() fetches more
      return;
    }
    jumpTo(target);
  }, [advanceCandles, cursor, advance, jumpTo]);

  const skipCandles = useCallback(
    (count: number) => {
      const target = advanceCandles(cursor, count);
      if (target > cursor) jumpTo(target);
      else advance();
    },
    [advanceCandles, cursor, jumpTo, advance]
  );

  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const jumpRef = useRef(jumpTo);
  jumpRef.current = jumpTo;
  const stepRef = useRef(stepOneCandle);
  stepRef.current = stepOneCandle;
  const skipRef = useRef(skipCandles);
  skipRef.current = skipCandles;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => stepRef.current(), Math.max(1000 / speed, 16));
    return () => clearInterval(id);
  }, [playing, speed]);

  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        stepRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started]);

  /* -------------------------------- derived ------------------------------- */

  const currentBar = buffer[cursor] ?? null;
  currentBarRef.current = currentBar;

  /**
   * The bucket the cursor is inside. Everything before it is settled history and can be read
   * straight from the database; the bucket itself has to be built from base bars up to the
   * cursor, because the stored aggregate for it contains the rest of the candle — which has not
   * happened yet.
   */
  const currentBucket = useMemo(
    () => (currentBar ? bucketStart(currentBar.ts, tf) : null),
    [currentBar, tf]
  );

  /**
   * When the cursor crosses into a new candle, close off the old one locally straight away.
   *
   * Without this the chart is left holding only the newly-forming bar until the refetch lands,
   * and autoscaling a single candle makes it fill the entire pane for a frame.
   */
  useEffect(() => {
    if (currentBucket === null) return;
    setHistory((h) => {
      if (!h || h.symbol !== symbol || h.tf !== tf) return h;
      if (h.bucket >= currentBucket) return h; // jumped backwards — wait for the real fetch
      const completed = buffer.filter((b) => b.ts >= h.bucket && b.ts < currentBucket);
      const rolled = completed.length ? aggregate(completed, tf, baseTf) : [];
      // Trimming moves the front of the window, which forces a full redraw — so the ceiling is set
      // high enough that a long session hits it rarely rather than a little every step.
      const grown = ensureAscending([...h.bars, ...rolled]);
      return {
        ...h,
        bucket: currentBucket,
        bars: grown.length > MAX_HISTORY_BARS ? grown.slice(-TRIM_TO_BARS) : grown,
      };
    });
    // buffer is read fresh rather than tracked, to avoid rerunning on every step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBucket, symbol, tf, baseTf]);

  /**
   * The bars behind the cursor, fetched once per epoch rather than once per candle.
   *
   * This used to run on every bucket change — every single press at 1m — and each run replaced the
   * whole window with a freshly fetched one shifted forward by exactly one bar. Nothing looked
   * wrong in the result, but because the first bar was never the same twice, the chart could not
   * append: it rebuilt all six hundred candles, recomputed the price scale and repainted the pane
   * on every step, and every indicator drawn over it went with it. That is the glitch.
   *
   * Stepping forward now needs no fetch at all. The effect above has already rolled the completed
   * candle onto the end of the window it is holding, which is what TradingView does: history is
   * anchored, and a step appends to it.
   */
  const bucketRef = useRef(currentBucket);
  bucketRef.current = currentBucket;
  const historyRef = useRef(history);
  historyRef.current = history;
  /** The position the window was last anchored at, so a failed fetch cannot loop. */
  const reanchoredAt = useRef<number | null>(null);

  /**
   * Fetch history only when the window no longer sits behind the cursor.
   *
   * Stepping — forwards or back — stays inside a window that already covers hundreds of bars, and
   * the roll-forward above keeps its far end current, so neither needs anything from the server.
   * Only a genuine relocation does: a new session, a change of instrument or timeframe, or a jump
   * back past the point the window begins.
   */
  useEffect(() => {
    if (!started || currentBucket === null) return;
    const h = historyRef.current;
    const covers =
      h && h.symbol === symbol && h.tf === tf && h.bars.length > 0 && h.bars[0].ts < currentBucket;
    if (covers || reanchoredAt.current === currentBucket) return;
    reanchoredAt.current = currentBucket;
    setEpoch((e) => e + 1);
  }, [started, symbol, tf, currentBucket]);

  useEffect(() => {
    const currentBucket = bucketRef.current;
    if (!symbol || currentBucket === null) return;
    let cancelled = false;
    const q = new URLSearchParams({
      symbol,
      tf,
      to: String(currentBucket - 1),
      limit: String(HISTORY_BARS),
    });
    fetch(`/api/candles?${q}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setHistory({ bucket: currentBucket, symbol, tf, bars: (j.candles ?? []) as Candle[] });
      })
      .catch(() => setHistory({ bucket: currentBucket, symbol, tf, bars: [] }));
    return () => {
      cancelled = true;
    };
  }, [symbol, tf, epoch]);

  // Outside a replay session the chart shows the most recent candles, so it is never empty.
  useEffect(() => {
    if (started || !symbol) return;
    let cancelled = false;
    fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=${PREVIEW_BARS}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setLiveBars((j.candles ?? []) as Candle[]);
      })
      .catch(() => setLiveBars([]));
    return () => {
      cancelled = true;
    };
  }, [started, symbol, tf]);

  /**
   * The bars behind the cursor, rebuilt from the base bars already in hand.
   *
   * Switching the timeframe leaves the fetched window belonging to the old one, and there is a
   * round trip before its replacement arrives. Rendering only what is left — the candle currently
   * forming — puts a single bar on the chart, and autoscaling gives that one bar the whole pane:
   * the flash you see for a moment every time you change timeframe.
   *
   * The replay buffer already holds the base bars either side of the cursor, so the window can be
   * rebuilt locally and instantly at the new timeframe. It is the same arithmetic the server does
   * on the same data, so the fetch that follows extends this rather than contradicting it. It
   * reaches back only as far as the buffer does, which is why it is a stopgap and not the source.
   */
  const localHistory = useMemo(() => {
    if (!buffer.length || currentBucket === null) return [];
    let end = buffer.length;
    while (end > 0 && buffer[end - 1].ts >= currentBucket) end--;
    return end > 0 ? aggregate(buffer.slice(0, end), tf, baseTf) : [];
    // Recomputed once per candle rather than once per step: currentBucket only moves on a
    // boundary, and the forming candle is added separately below.
  }, [buffer, currentBucket, tf, baseTf]);

  const visible = useMemo(() => {
    if (!buffer.length || currentBucket === null) return [];
    // Base bars from the start of the current bucket up to the cursor form the live candle.
    let from = cursor;
    while (from > 0 && buffer[from - 1].ts >= currentBucket) from--;
    const forming = aggregate(buffer.slice(from, cursor + 1), tf, baseTf);

    // Only use history that was fetched for this exact position; a jump makes the previous
    // response stale, and stitching it on would put the chart out of order.
    // Usable when it belongs to this symbol and timeframe and sits entirely behind the cursor —
    // which covers the moment between stepping into a new candle and its refetch landing.
    const fetched =
      history && history.symbol === symbol && history.tf === tf
        ? history.bars.filter((b) => b.ts < currentBucket)
        : [];

    // Nothing fetched applies to where the chart now is — a timeframe change, or the first paint
    // of a session. Draw the locally rebuilt window until the real one lands.
    const fresh = fetched.length ? fetched : localHistory;

    return ensureAscending([...fresh, ...forming]);
  }, [history, localHistory, buffer, cursor, currentBucket, tf, baseTf, symbol]);

  const chartBars = started ? visible : liveBars;

  const indicatorShapes = useMemo(() => {
    const bars = chartBars ?? [];
    if (!bars.length) return { boxes: [], levels: [], po3: [] };
    return {
      boxes: indicators.fvg && !indicators.fvgHidden ? fairValueGaps(bars, indicators.fvgOptions).boxes : [],
      levels: indicators.sessions && !indicators.sessionsHidden ? sessionLevels(bars, indicators.sessionOptions).levels : [],
      po3: indicators.po3 && !indicators.po3Hidden ? po3Candles(bars, tf, indicators.po3Options) : [],
    };
  }, [chartBars, indicators, tf]);

  const stats = useMemo(() => sessionStats(trades), [trades]);
  const spec = useMemo(() => specFor(symbol, app.settings.contractSpecs), [symbol, app.settings.contractSpecs]);

  /**
   * How far a stop starts from an entry when nothing has said otherwise.
   *
   * Read off what the chart is actually doing — two average bar ranges — rather than a percentage
   * of price. A tenth of a percent is a different trade on a 1-minute chart than on a daily one,
   * and on a quiet instrument it puts the stop and the target somewhere off the top and bottom of
   * the pane, where the one thing you want to do with them — drag them to where they belong —
   * cannot be done at all. Two bar ranges lands them beside the entry on any timeframe.
   *
   * Floored at eight ticks so a dead patch of the tape cannot seed a stop of nothing.
   */
  const seedDistance = useMemo(() => {
    const recent = (chartBars ?? []).slice(-20);
    const avgRange = recent.length
      ? recent.reduce((sum, b) => sum + (b.high - b.low), 0) / recent.length
      : 0;
    const raw = avgRange > 0 ? avgRange * 2 : (currentBar?.close ?? 0) * 0.001;
    return Math.max(8, Math.round(raw / spec.tickSize)) * spec.tickSize;
  }, [chartBars, currentBar, spec.tickSize]);

  const templates = (app.settings.drawingTemplates ?? {}) as Record<string, DrawingTemplate[]>;
  const templateFor = useCallback(
    (kind: DrawingKind): Partial<DrawingStyle> | undefined => {
      const chosen = activeTemplate[kind];
      if (!chosen) return undefined;
      return (templates[kind] ?? []).find((t) => t.name === chosen)?.style as Partial<DrawingStyle> | undefined;
    },
    [activeTemplate, templates]
  );

  /**
   * Which symbol's drawings have actually come back from the server.
   *
   * The list starts empty and is filled asynchronously, so anything that saves before the load
   * lands — a stray edit during a remount, a failed fetch, a symbol switch mid-flight — would
   * write that empty list back and destroy every drawing on the symbol. Saving is gated on this
   * instead: the client only ever overwrites a list it was actually handed.
   */
  const loadedSymbol = useRef<string | null>(null);
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    loadedSymbol.current = null;
    fetch(`/api/drawings?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setDrawings((j.drawings ?? []) as Drawing[]);
        loadedSymbol.current = symbol;
      })
      .catch(() => {
        // Leave the gate shut: a load that failed is not licence to overwrite what is stored.
        if (!cancelled) setDrawings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Persist after edits settle, so dragging does not write on every frame.
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitDrawings = useCallback(
    (next: Drawing[]) => {
      setDrawings(next);
      if (loadedSymbol.current !== symbol) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (loadedSymbol.current !== symbol) return;
        void fetch("/api/drawings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, drawings: next }),
        }).catch(() => toast("Could not save drawings", "error"));
      }, 600);
    },
    [symbol, toast]
  );

  /**
   * Undo history for drawings — Ctrl/Cmd+Z, Shift for redo.
   *
   * A drag fires this on every pointermove, dozens of times, so pushing a snapshot on every call
   * would make one undo only take back a pixel of movement. Coalescing by time instead — no new
   * snapshot within UNDO_COALESCE_MS of the last one — groups a whole drag, or a burst of style
   * edits, into a single step, the way a text editor groups keystrokes typed close together.
   */
  const UNDO_COALESCE_MS = 500;
  const undoStack = useRef<Drawing[][]>([]);
  const redoStack = useRef<Drawing[][]>([]);
  const lastPushRef = useRef(0);
  const persistDrawings = useCallback(
    (next: Drawing[]) => {
      const now = Date.now();
      if (now - lastPushRef.current > UNDO_COALESCE_MS) {
        undoStack.current.push(drawingsRef.current);
        if (undoStack.current.length > 50) undoStack.current.shift();
      }
      lastPushRef.current = now;
      redoStack.current = [];
      commitDrawings(next);
    },
    [commitDrawings]
  );
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(drawingsRef.current);
    lastPushRef.current = 0;
    commitDrawings(prev);
  }, [commitDrawings]);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(drawingsRef.current);
    lastPushRef.current = 0;
    commitDrawings(next);
  }, [commitDrawings]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
  // A new symbol loads an unrelated set of drawings — history from the last one no longer applies.
  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
  }, [symbol]);

  /** Mark the trade on the chart the moment it fills, so the entry is visible in context. */
  const drawPosition = useCallback(
    (pos: Position) => {
      if (!app.settings.replayOptions?.drawPositions) return;
      const id = `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const kind: DrawingKind = pos.direction === "long" ? "long" : "short";
      const a: Anchor = { t: pos.entryTs, price: pos.entry };
      const b: Anchor = { t: pos.entryTs + 60 * 60000, price: pos.stop };
      const c: Anchor =
        pos.target !== null ? { t: b.t, price: pos.target } : seedPosition(kind as "long" | "short", a, b);
      positionDrawingId.current = id;
      persistDrawings([
        ...drawingsRef.current,
        { id, kind, a, b, c, style: { ...styleFor(kind), label: `${pos.contracts} ${symbol}` } },
      ]);
    },
    [app.settings.replayOptions?.drawPositions, persistDrawings, symbol]
  );

  /** On exit, label the drawing with the result and attach a screenshot to the journal entry. */
  const finishPositionDrawing = useCallback(
    (closed: ClosedTrade) => {
      const id = positionDrawingId.current;
      positionDrawingId.current = null;
      if (!id) return;
      persistDrawings(
        drawingsRef.current.map((d) =>
          d.id === id
            ? {
                ...d,
                c: d.c ? { ...d.c, t: closed.exitTs } : d.c,
                b: { ...d.b, t: closed.exitTs },
                style: { ...d.style, label: `${closed.r > 0 ? "+" : ""}${closed.r.toFixed(2)}R · ${closed.reason}` },
              }
            : d
        )
      );
    },
    [persistDrawings]
  );

  const saveTemplate = useCallback(
    async (kind: DrawingKind, name: string, style: DrawingStyle) => {
      const existing = (templates[kind] ?? []).filter((t) => t.name !== name);
      const next = { ...templates, [kind]: [...existing, { name, style: style as unknown as Record<string, unknown> }] };
      await app.patchSettings({ drawingTemplates: next });
      setActiveTemplate((a) => ({ ...a, [kind]: name }));
      toast(`Saved “${name}” for ${kind}`, "success");
    },
    [templates, app, toast]
  );

  const deleteTemplate = useCallback(
    async (kind: DrawingKind, name: string) => {
      const next = { ...templates, [kind]: (templates[kind] ?? []).filter((t) => t.name !== name) };
      await app.patchSettings({ drawingTemplates: next });
    },
    [templates, app]
  );

  /** Dollar risk the ticket is about to take, from the stop distance and the size. */
  const plannedRisk = useMemo(() => {
    const entry = entryType === "limit" ? Number(entryPrice) : currentBar?.close;
    const s = Number(stop);
    const n = Number(contracts);
    if (!entry || !Number.isFinite(s) || !Number.isFinite(n) || n <= 0) return null;
    return riskFor(entry, s, n, spec.pointValue);
  }, [entryType, entryPrice, stop, contracts, currentBar, spec.pointValue]);
  const settingsDrawing = useMemo(() => drawings.find((d) => d.id === settingsFor) ?? null, [drawings, settingsFor]);
  const selectedDrawingObj = useMemo(() => drawings.find((d) => d.id === selectedDrawing) ?? null, [drawings, selectedDrawing]);

  const displayTimeframes = useMemo(
    () => REPLAY_TIMEFRAMES.filter((t) => (baseTf === "30s" ? true : t !== "30s")),
    [baseTf]
  );
  const openR = position && currentBar ? rOf(position, currentBar.close) : null;

  const levels = useMemo<ChartLevel[]>(() => {
    const out: ChartLevel[] = [];
    const TICK = spec.tickSize;

    if (position) {
      const long = position.direction === "long";
      const rAt = (p: number) => fmtR(rOf(position, p), 1);
      const unrealised = currentBar ? rOf(position, currentBar.close) : null;
      // Ticks alongside the money and the R. On a step-by-step replay the tick count is the thing
      // that actually moves each press — the dollar figure on a two-lot rounds too coarsely to
      // show that price went your way at all.
      const ticks =
        currentBar === null
          ? null
          : Math.round((long ? currentBar.close - position.entry : position.entry - currentBar.close) / TICK);
      out.push({
        id: "entry",
        price: position.entry,
        label: long ? "Long" : "Short",
        qty: position.contracts,
        // The running result, in ticks first. Money is the number that matters at the end; ticks
        // are the one that moves on every press, which is what a replay is for watching.
        tag:
          ticks === null
            ? long
              ? "Long"
              : "Short"
            : `${ticks > 0 ? "+" : ""}${ticks} ticks`,
        tagTone: ticks === null || ticks === 0 ? undefined : ticks > 0 ? "pos" : "neg",
        // Blue long, red short — the side is readable before the label is.
        color: long ? CHART.buy : CHART.sell,
        removable: true,
        note:
          unrealised === null
            ? undefined
            : `${money(unrealised * position.risk, app.currency, { sign: true })}  ${fmtR(unrealised, 1)}`,
      });
      out.push({
        id: "stop",
        price: position.stop,
        label: "Stop",
        tag: "STP",
        qty: position.contracts,
        color: CHART.stop,
        dashed: true,
        draggable: true,
        note: rAt(position.stop),
        zoneTo: position.entry,
        zoneColor: "rgba(242,54,69,0.13)",
        // A stop may be trailed past the entry, but never through it onto the wrong side.
        max: long ? position.entry - TICK : undefined,
        min: long ? undefined : position.entry + TICK,
      });
      if (position.target !== null) {
        out.push({
          id: "target",
          price: position.target,
          label: "Target",
          tag: "TP",
          qty: position.contracts,
          color: CHART.target,
          dashed: true,
          draggable: true,
          note: rAt(position.target),
          removable: true,
          zoneTo: position.entry,
          zoneColor: "rgba(8,153,129,0.13)",
          min: long ? position.entry + TICK : undefined,
          max: long ? undefined : position.entry - TICK,
        });
      }
    } else if (order) {
      const long = order.direction === "long";
      const entry = order.entryType === "limit" && order.entryPrice !== null ? order.entryPrice : currentBar?.close ?? null;
      const rAt = (p: number) =>
        entry === null ? undefined : fmtR(rOf({ direction: order.direction, entry, stop: order.stop }, p), 1);

      if (order.entryType === "limit" && order.entryPrice !== null) {
        // The size is on the line itself. A resting order that does not say how much it is for
        // tells you where you get in but not what you are getting into.
        out.push({
          id: "entry",
          price: order.entryPrice,
          label: long ? "Buy limit" : "Sell limit",
          // Spelled out on the chip, as it is on a broker's line. "LMT" saves four characters and
          // costs you the side, which is the half of it that matters at a glance.
          tag: long ? "Buy Limit" : "Sell Limit",
          qty: order.contracts,
          qtyEditable: true,
          color: long ? CHART.buy : CHART.sell,
          dashed: true,
          draggable: true,
          removable: true,
          // No risk figure on the chip. The status bar under the chart already carries it, and a
          // resting order's label is something you read at a glance across a chart — every extra
          // word on it is width taken out of the candles behind it.
        });
      }
      out.push({
        id: "stop",
        price: order.stop,
        label: "Stop",
        tag: "STP",
        qty: order.contracts,
        qtyEditable: true,
        color: CHART.stop,
        dashed: true,
        draggable: true,
        note: entry === null ? undefined : rAt(order.stop),
        zoneTo: entry ?? undefined,
        zoneColor: "rgba(242,54,69,0.13)",
        max: long && entry !== null ? entry - TICK : undefined,
        min: !long && entry !== null ? entry + TICK : undefined,
      });
      if (order.target !== null) {
        out.push({
          id: "target",
          price: order.target,
          label: "Target",
          tag: "TP",
          qty: order.contracts,
          qtyEditable: true,
          color: CHART.target,
          dashed: true,
          draggable: true,
          note: entry === null ? undefined : rAt(order.target),
          removable: true,
          zoneTo: entry ?? undefined,
          zoneColor: "rgba(8,153,129,0.13)",
          min: long && entry !== null ? entry + TICK : undefined,
          max: !long && entry !== null ? entry - TICK : undefined,
        });
      }
    }
    return out;
  }, [position, order, currentBar, spec.tickSize, app.currency]);

  /**
   * Move the cursor to an instant. Inside the loaded buffer it seeks; outside it — which is now
   * common, because the chart shows months of history behind the cursor — it reloads the session
   * from that date instead of silently snapping to the start of the buffer.
   */
  const jumpToTime = useCallback(
    async (ts: number, exclusive = false) => {
      const first = buffer[0]?.ts;
      const last = buffer[buffer.length - 1]?.ts;
      if (first !== undefined && last !== undefined && ts >= first && ts <= last) {
        const found = buffer.findIndex((b) => b.ts >= ts);
        // Picking a bar starts the replay *before* it: that candle has not happened yet.
        const idx = exclusive ? found - 1 : found;
        if (idx >= 0) {
          jumpRef.current(idx);
          return;
        }
      }
      if (posRef.current || orderRef.current) {
        toast("Close the open position before moving to another date", "error");
        return;
      }
      setPlaying(false);
      // etDateTime, not toISOString: a New York evening is already the next day in UTC, so the
      // session would restart a day late for anything after 20:00.
      const { date: day, time } = etDateTime(ts);
      if (!(await startRef.current(day, ts))) return;
      setJumpDate(day);
      toast(`Replaying from ${day} ${time} ET`, "success");
    },
    // start is reached through startRef, so it never needs to be a dependency here.
    [buffer, toast]
  );

  jumpToTimeRef.current = jumpToTime;

  /**
   * Jump to a date and a time of day, both read as New York wall clock.
   *
   * This used to parse the date as `T00:00:00Z` — UTC midnight, which is 19:00 or 20:00 ET on the
   * *previous* day depending on daylight saving. Asking for the 4th put you on the evening of the
   * 3rd, several hours from anything you meant to look at. The chart labels every time in ET, so
   * the jump reads its input the same way.
   */
  const goToDate = useCallback(
    async (day: string, time = "09:30") => {
      if (!day) return;
      const ts = tradeInstant(day, time);
      if (ts === null) {
        toast(`Could not read "${day} ${time}" as a date and time`, "error");
        return;
      }
      await jumpToTime(ts);
    },
    [jumpToTime, toast]
  );

  /** Buy/Sell straight from the chart, using the ticket's size and stop. */
  const marketOrder = useCallback(
    (dir: Direction) => {
      if (!currentBar) return;
      const price = currentBar.close;
      const typed = Number(stop);
      const onCorrectSide = Number.isFinite(typed) && (dir === "long" ? typed < price : typed > price);
      // Without a usable stop, start one a sensible distance away — it is draggable immediately.
      const stopPrice = onCorrectSide ? typed : dir === "long" ? price - seedDistance : price + seedDistance;
      const draft: OrderDraft = {
        direction: dir,
        entryType: "market",
        entryPrice: null,
        stop: stopPrice,
        target: target.trim() === "" ? null : Number(target),
        contracts: Number(contracts) || 1,
        pointValue: spec.pointValue,
      };
      const error = validateOrder(draft, price);
      if (error) {
        toast(error, "error");
        return;
      }
      const filled = fillAtMarket(draft, currentBar);
      posRef.current = filled;
      setPosition(filled);
      orderRef.current = null;
      setOrder(null);
      setDirection(dir);
      setStop(String(stopPrice));
      drawPosition(filled);
    },
    [currentBar, stop, target, contracts, spec, seedDistance, toast]
  );

  /**
   * A stop and a target a readable distance either side of an entry, aligned to the tick.
   *
   * One rule for both ways of starting an order — the ticket and the chart — so a limit placed by
   * right-clicking and a limit typed into the panel begin the same shape.
   */
  /** The nearest price the instrument actually trades at. */
  const toTick = useCallback(
    (p: number) => Number((Math.round(p / spec.tickSize) * spec.tickSize).toFixed(4)),
    [spec.tickSize]
  );

  const seedBracket = useCallback(
    (entry: number, dir: Direction) => ({
      stop: toTick(dir === "long" ? entry - seedDistance : entry + seedDistance),
      target: toTick(dir === "long" ? entry + seedDistance * 2 : entry - seedDistance * 2),
    }),
    [seedDistance, toTick]
  );

  /**
   * Whether a stop already in the ticket still belongs to the entry being placed.
   *
   * On the right side of it, and near enough to be a stop for this trade rather than a number left
   * behind by the last one.
   */
  const stopStillFits = useCallback(
    (entry: number, dir: Direction, typed: number) =>
      Number.isFinite(typed) &&
      typed > 0 &&
      (dir === "long" ? typed < entry : typed > entry) &&
      Math.abs(entry - typed) <= seedDistance * 4,
    [seedDistance]
  );

  /** Place a resting limit at the price that was right-clicked. */
  const limitAt = useCallback(
    (price: number, dir: Direction) => {
      const n = Number(contracts) || 1;
      /**
       * Keep the stop distance already in the ticket, but only while it still belongs here.
       *
       * A stop typed against a price two hundred points away is not a stop distance, it is a
       * leftover — carrying it over drops the stop off the pane and sends the target twice as far
       * again, so the two lines you most want to drag are the two you cannot see.
       */
      const typed = Number(stop);
      const seeded = seedBracket(price, dir);
      const carry = stopStillFits(price, dir, typed) ? Math.abs(price - typed) : null;
      const draft: OrderDraft = {
        direction: dir,
        entryType: "limit",
        entryPrice: price,
        stop: carry === null ? seeded.stop : dir === "long" ? price - carry : price + carry,
        target: carry === null ? seeded.target : dir === "long" ? price + carry * 2 : price - carry * 2,
        contracts: n,
        pointValue: spec.pointValue,
      };
      orderRef.current = draft;
      setOrder(draft);
      setDirection(dir);
      setEntryType("limit");
      setEntryPrice(String(price));
      setStop(String(draft.stop));
      setTarget(String(draft.target));
    },
    [contracts, stop, seedBracket, stopStillFits, spec.pointValue]
  );

  /** Removing a stop or target from the chart tag. */
  /**
   * The × on a chip. What it removes depends on which line it is on.
   *
   * On a working order's entry it cancels the order outright, and on a live position it closes at
   * market — the two things you most often want and previously had to go to the trade panel for.
   * On a target it just drops the target. A stop has no × at all: a live position without one is
   * how an account gets deleted, and dragging it is always available.
   */
  const removeLevel = useCallback(
    (id: string) => {
      if (posRef.current) {
        if (id === "entry") {
          const bar = currentBarRef.current;
          if (!bar) return;
          const closed = closeAtMarket(posRef.current, bar);
          posRef.current = null;
          setTrades((l) => [closed, ...l]);
          void logTrade(closed);
          setPosition(null);
          return;
        }
        if (id !== "target") return; // a live position must keep a stop
        const next = { ...posRef.current, target: null };
        posRef.current = next;
        setPosition(next);
        return;
      }
      if (!orderRef.current) return;
      if (id === "entry" || id === "stop") {
        // Cancelling the entry cancels the bracket with it; there is no order left to protect.
        orderRef.current = null;
        setOrder(null);
        toast("Order cancelled", "success");
        return;
      }
      if (id === "target") {
        const next = { ...orderRef.current, target: null };
        orderRef.current = next;
        setOrder(next);
        setTarget("");
      }
    },
    [toast, logTrade]
  );

  /** Editing the size on a chip. Only a resting order — resizing a live position is a partial fill. */
  const setLevelQty = useCallback((_id: string, contractsNext: number) => {
    if (!orderRef.current || !Number.isFinite(contractsNext) || contractsNext <= 0) return;
    const next = { ...orderRef.current, contracts: Math.round(contractsNext) };
    orderRef.current = next;
    setOrder(next);
    // Keep the ticket in step, so the next order defaults to the size just chosen.
    setContracts(String(next.contracts));
  }, []);

  /** Dragging a level edits the live position or the working order in place. */
  const dragLevel = useCallback(
    (id: string, price: number) => {
      if (posRef.current) {
        const next = { ...posRef.current };
        if (id === "stop") next.stop = price;
        else if (id === "target") next.target = price;
        else return;
        posRef.current = next;
        setPosition(next);
        return;
      }
      if (orderRef.current) {
        const next = { ...orderRef.current };
        if (id === "stop") next.stop = price;
        else if (id === "target") next.target = price;
        else if (id === "entry") next.entryPrice = price;
        else return;
        orderRef.current = next;
        setOrder(next);
        // keep the ticket inputs in step with what was dragged
        if (id === "stop") setStop(String(price));
        if (id === "target") setTarget(String(price));
        if (id === "entry") setEntryPrice(String(price));
      }
    },
    []
  );

  /** The live position's entry, shown as a TradingView-style fill marker (arrow + qty @ price). */
  const executions = useMemo(() => {
    if (!position) return [];
    return [
      {
        ts: position.entryTs,
        price: position.entry,
        qty: position.contracts,
        direction: position.direction,
        kind: "entry" as const,
      },
    ];
  }, [position]);

  const markers = useMemo(() => {
    const out: { ts: number; position: "aboveBar" | "belowBar"; color: string; shape: "arrowUp" | "arrowDown" | "circle"; text?: string }[] = [];
    for (const t of trades.slice(0, 12)) {
      out.push({
        ts: t.entryTs,
        position: t.direction === "long" ? "belowBar" : "aboveBar",
        color: CHART.markerNeutral,
        shape: t.direction === "long" ? "arrowUp" : "arrowDown",
      });
      out.push({
        ts: t.exitTs,
        position: t.direction === "long" ? "aboveBar" : "belowBar",
        color: t.r > 0 ? CHART.markerBright : CHART.markerNeutral,
        shape: "circle",
        text: fmtR(t.r, 1),
      });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }, [position, trades]);

  /* ------------------------------ order ticket ---------------------------- */

  const place = () => {
    setTicketError(null);
    if (!currentBar) return;
    const draft: OrderDraft = {
      direction,
      entryType,
      entryPrice: entryType === "limit" ? Number(entryPrice) : null,
      stop: Number(stop),
      target: target.trim() === "" ? null : Number(target),
      contracts: Number(contracts),
      pointValue: spec.pointValue,
    };
    const error = validateOrder(draft, currentBar.close);
    if (error) return setTicketError(error);

    if (entryType === "market") {
      // Fill on the bar in front of you, at its close — the position appears at once.
      const filled = fillAtMarket(draft, currentBar);
      posRef.current = filled;
      setPosition(filled);
      orderRef.current = null;
      setOrder(null);
      drawPosition(filled);
      return;
    }
    orderRef.current = draft;
    setOrder(draft);
  };

  const setTargetR = (multiple: number) => {
    const entry = entryType === "limit" ? Number(entryPrice) : currentBar?.close;
    const s = Number(stop);
    if (!entry || !Number.isFinite(s) || entry === s) return;
    const distance = Math.abs(entry - s);
    setTarget(String(Number((direction === "long" ? entry + distance * multiple : entry - distance * multiple).toFixed(2))));
  };

  const moveStopToBreakeven = () => {
    if (!position) return;
    const moved = { ...position, stop: position.entry };
    posRef.current = moved;
    setPosition(moved);
  };

  /* -------------------------------- render -------------------------------- */

  if (coverage === null) {
    return (
      <Page>
        <PageHeader title="Replay" />
        <Spinner label="Checking stored candles…" />
      </Page>
    );
  }

  if (!coverage.length) {
    return (
      <Page>
        <PageHeader title="Replay" />
        <Panel>
          <EmptyState
            title="No candles to replay"
            body="Replay steps through real stored bars — import market data first and this fills in. Nothing here is simulated price action."
            action={
              <Button variant="primary" size="md" onClick={() => router.push("/market")}>
                Go to Market data
              </Button>
            }
          />
        </Panel>
      </Page>
    );
  }

  return (
    /* `chart-chrome` repaints this screen in the charting greys — see globals.css. Everything
       inside is already built from the theme tokens, so the class is the whole change. */
    <div className="chart-chrome h-full flex flex-col overflow-hidden bg-base">
      {/* toolbar */}
      <div className="h-[42px] shrink-0 flex items-center gap-2 px-3 border-b border-line bg-surface">
        {/* Replay hides the sidebar, so the way out has to live here. Without it the only exit is
            the browser's back button, which is not a control the app should be relying on. */}
        <button
          onClick={() => router.push("/")}
          title="Leave replay mode"
          className="flex items-center gap-1.5 h-7 pl-1.5 pr-2.5 rounded-sm text-body text-ink-2 hover:text-ink hover:bg-hover transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M9.5 4L5.5 8l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Exit
        </button>
        <div className="w-px h-5 bg-line-soft" />
        <span className="text-ui font-medium tracking-tight">{symbol}</span>
        <div className="w-px h-5 bg-line-soft" />
        <div className="flex items-center gap-[1px]">
          {displayTimeframes.map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={`h-7 px-2 rounded-sm text-body tnum transition-colors ${
                t === tf ? "bg-hover text-ink" : "text-ink-3 hover:text-ink hover:bg-hover/60"
              }`}
            >
              {t}
            </button>
          ))}
          <TimeframeSelect value={tf} options={displayTimeframes} onChange={setTf} />
        </div>
        <div className="w-px h-5 bg-line-soft" />
        <span className="text-caption text-ink-3 hidden xl:inline" title="Fills are checked on every bar at this resolution">
          stepping {baseTf}
        </span>
        <Button onClick={() => setResetSignal((v) => v + 1)} title="Recentre the chart on the latest price">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M7 2.2a4.8 4.8 0 104.5 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M11.6 2v3.4H8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Reset
        </Button>

        <IndicatorsMenu state={indicators} onChange={updateIndicators} />

        <Button
          onClick={() => {
            if (replayMode) {
              setPlaying(false);
              setReplayMode(false);
              setStarted(false);
              clearSession();
              return;
            }
            setReplayMode(true);
            if (!started) setSelectingBar(true);
          }}
          className={replayMode ? "border-accent/60 text-ink" : ""}
          title="Replay — step through history bar by bar"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M3 3.5L8 7l-5 3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M10.5 3v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Replay
        </Button>

        {/* Saving and resuming sits next to Replay because that is the thing it belongs to. It is
            available whether or not a session is running: with one you are saving, without one you
            are picking up where you left off. */}
        <Button onClick={() => setSessionsOpen(true)} title="Save this replay, or pick up a saved one">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M2.5 2.5h6.4L11.5 5.1V11a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M4.8 2.5v3h4v-3M4.8 11.5V8.2h4.4v3.3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          Sessions
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="danger"
            onClick={() => {
              setPlaying(false);
              setStarted(false);
              clearSession();
              // The saved sessions are deliberately left alone. Stopping means "I am done for now",
              // not "throw away the run" — and there is a Delete beside each one for when it does.
              setActiveSessionId(null);
            }}
          >
            Stop
          </Button>
        </div>
      </div>

      {/* chart + side panel */}
      <div className="flex-1 flex min-h-0">
        <DrawingToolbar
          tool={tool}
          onTool={setTool}
          templates={templates}
          activeTemplate={activeTemplate}
          onTemplate={(kind, name) => {
            setActiveTemplate((a) => ({ ...a, [kind]: name }));
            setTool(kind);
          }}
          measuring={measuring}
          onMeasure={() => setMeasuring((v) => !v)}
          magnet={magnet}
          onMagnet={setMagnet}
          hasDrawings={drawings.length > 0}
          onClearAll={() => {
            persistDrawings([]);
            setSelectedDrawing(null);
          }}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 bg-black relative">
            <PriceChart
              symbol={symbol}
              timeframe={tf}
              data={chartBars}
              levels={levels}
              markers={markers}
              executions={executions}
              followCursor
              fill
              onLevelDrag={dragLevel}
              onLevelRemove={removeLevel}
              onLevelQty={setLevelQty}
              tickSize={spec.tickSize}
              measure={measuring}
              onMeasureDone={() => setMeasuring(false)}
              drawings={drawings}
              onDrawingsChange={persistDrawings}
              tool={tool}
              onToolDone={() => setTool(null)}
              selectedDrawingId={selectedDrawing}
              onSelectDrawing={setSelectedDrawing}
              onOpenDrawingSettings={(id) => {
                setSelectedDrawing(id);
                setSettingsFor(id);
              }}
              drawingTemplate={tool ? templateFor(tool) : undefined}
              magnet={magnet}
              indicatorBoxes={indicatorShapes.boxes}
              indicatorLevels={indicatorShapes.levels}
              po3={indicatorShapes.po3}
              po3Style={{ color: indicators.po3Options.color, offset: indicators.po3Options.offset, width: indicators.po3Options.width }}
              selectionTs={selectingBar ? hoverBar?.ts ?? null : null}
              resetSignal={resetSignal}
              captureRef={captureRef}
              onPriceContextMenu={(info) => setContextMenu({ price: info.price, x: info.x, y: info.y })}
              onCrosshairBar={setHoverBar}
              measureRiskPoints={
                position
                  ? Math.abs(position.entry - position.stop)
                  : order
                  ? Math.abs((order.entryPrice ?? currentBar?.close ?? 0) - order.stop)
                  : undefined
              }
              emptyMessage="No bars visible yet — step forward."
              onBarClick={(ts) => {
                if (!selectingBar) return;
                setSelectingBar(false);
                setReplayMode(true);
                void jumpToTime(ts, true);
              }}
            />

            {/* legend */}
            <div className="absolute top-2 left-2 z-30 pointer-events-none select-none">
              <div className="flex items-baseline gap-2">
                <span className="text-body text-ink">{symbol}</span>
                <span className="text-caption text-ink-3 tnum">{tf}</span>
                {/* Only when there is a real bar under the cursor. Hovering past the last candle
                    gives a projected time but no prices, and "O — H — L — C —" is noise where the
                    honest answer is nothing at all. The timestamp below still updates. */}
                {(() => {
                  const b = hoverBar ?? currentBar;
                  if (!b || !Number.isFinite(b.open)) return null;
                  return (
                    <span className="text-caption text-ink-3 tnum">
                      O <span className="text-ink-2">{num(b.open, 2)}</span> H{" "}
                      <span className="text-ink-2">{num(b.high, 2)}</span> L{" "}
                      <span className="text-ink-2">{num(b.low, 2)}</span> C{" "}
                      <span className="text-ink-2">{num(b.close, 2)}</span>
                    </span>
                  );
                })()}
              </div>
              <div className="text-caption text-ink-3 tnum mt-0.5">
                {(hoverBar ?? currentBar) ? `${etClock.format((hoverBar ?? currentBar)!.ts)} ET` : ""}
                {/* Past the last candle the time is extrapolated from the bar spacing, not read
                    off a bar. Saying so stops it being mistaken for data that exists. */}
                {hoverBar && !Number.isFinite(hoverBar.open) && <span className="text-ink-4"> · projected</span>}
              </div>

              {/*
               * Buy and sell sit in the legend column rather than floating over it.
               *
               * They used to be absolutely positioned at a fixed offset while the indicator
               * list grew downwards from above — so every indicator added pushed a row further
               * underneath the buttons, and both ended up unreadable. In the column they stack:
               * price, time, the two buttons, then whatever is on the chart.
               */}
              {/* one-click trading */}
              {started && currentBar && (
                <div className="flex items-stretch gap-1.5 mt-2 pointer-events-auto">
                  {/*
                   * Red sell, blue buy — the platform convention, and the same two colours the
                   * order lines are drawn in, so the button you press and the line it leaves on
                   * the chart are visibly the same trade.
                   */}
                  <button
                    onClick={() => marketOrder("short")}
                    disabled={!!position}
                    className="flex flex-col items-center justify-center h-[38px] px-3 rounded-[3px] border disabled:opacity-35 transition-colors"
                    style={{ borderColor: `${CHART.sell}80`, background: `${CHART.sell}1f` }}
                    title="Sell at market"
                  >
                    <span className="text-body tnum leading-none" style={{ color: CHART.sell }}>{num(currentBar.close, 2)}</span>
                    <span className="text-micro uppercase tracking-[0.08em] leading-none mt-0.5" style={{ color: `${CHART.sell}cc` }}>Sell</span>
                  </button>
                  <div className="flex items-center text-micro text-ink-3 tnum px-0.5">{spec.tickSize}</div>
                  <button
                    onClick={() => marketOrder("long")}
                    disabled={!!position}
                    className="flex flex-col items-center justify-center h-[38px] px-3 rounded-[3px] border disabled:opacity-35 transition-colors"
                    style={{ borderColor: `${CHART.buy}80`, background: `${CHART.buy}1f` }}
                    title="Buy at market"
                  >
                    <span className="text-body tnum leading-none" style={{ color: CHART.buy }}>{num(currentBar.close, 2)}</span>
                    <span className="text-micro uppercase tracking-[0.08em] leading-none mt-0.5" style={{ color: `${CHART.buy}cc` }}>Buy</span>
                  </button>
                  <div className="flex items-center gap-1.5 pl-2">
                    <span className="text-micro text-ink-3">size</span>
                    <Input
                      value={contracts}
                      onChange={(e) => setContracts(e.target.value)}
                      inputMode="numeric"
                      className="h-7! py-0! w-[52px] text-body! text-center"
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-0.5 mt-1.5 pointer-events-auto">
                {([
                  ["sessions", "sessionsHidden", "Session Highs & Lows"],
                  ["po3", "po3Hidden", `PO3 Candles ${indicators.po3Options.timeframe} × ${indicators.po3Options.count}`],
                  ["fvg", "fvgHidden", "FVG / iFVG"],
                ] as [keyof IndicatorState, keyof IndicatorState, string][])
                  .filter(([on]) => indicators[on])
                  .map(([on, hiddenKey, label]) => {
                    const hidden = Boolean(indicators[hiddenKey]);
                    return (
                      <div key={String(on)} className="flex items-center gap-1.5">
                        <span className={`text-caption ${hidden ? "text-ink-3 line-through decoration-ink-3/50" : "text-ink-2"}`}>
                          {label}
                        </span>
                        <button
                          onClick={() => updateIndicators({ ...indicators, [hiddenKey]: !hidden } as IndicatorState)}
                          title={hidden ? "Show" : "Hide"}
                          className="text-ink-3 hover:text-ink"
                        >
                          {hidden ? (
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <path d="M2 8s2.2-3.5 6-3.5S14 8 14 8s-2.2 3.5-6 3.5S2 8 2 8z" stroke="currentColor" strokeWidth="1.1" />
                              <path d="M3 13L13 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <path d="M2 8s2.2-3.5 6-3.5S14 8 14 8s-2.2 3.5-6 3.5S2 8 2 8z" stroke="currentColor" strokeWidth="1.1" />
                              <circle cx="8" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.1" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => updateIndicators({ ...indicators, [on]: false } as IndicatorState)}
                          title="Remove from chart"
                          className="text-ink-3 hover:text-neg opacity-0 hover:opacity-100 focus:opacity-100"
                        >
                          <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>

            {selectedDrawingObj && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40">
                <FloatingDrawingBar
                  drawing={selectedDrawingObj}
                  onChange={(style) => persistDrawings(drawings.map((d) => (d.id === selectedDrawingObj.id ? { ...d, style } : d)))}
                  onToggleLock={() =>
                    persistDrawings(drawings.map((d) => (d.id === selectedDrawingObj.id ? { ...d, locked: !d.locked } : d)))
                  }
                  onDuplicate={() => {
                    const copy: Drawing = {
                      ...selectedDrawingObj,
                      id: `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                    };
                    persistDrawings([...drawings, copy]);
                    setSelectedDrawing(copy.id);
                  }}
                  onDelete={() => {
                    persistDrawings(drawings.filter((d) => d.id !== selectedDrawingObj.id));
                    setSelectedDrawing(null);
                  }}
                  onOpenSettings={(t) => {
                    setSettingsTab(t ?? "style");
                    setSettingsFor(selectedDrawingObj.id);
                  }}
                  templates={templates[selectedDrawingObj.kind] ?? []}
                  onApplyTemplate={(tpl) =>
                    persistDrawings(
                      drawings.map((d) =>
                        d.id === selectedDrawingObj.id ? { ...d, style: { ...d.style, ...(tpl as Partial<DrawingStyle>) } } : d
                      )
                    )
                  }
                />
              </div>
            )}


            {contextMenu && (
              <>
                <div className="fixed inset-0 z-40" onPointerDown={() => setContextMenu(null)} />
                <div
                  className="absolute z-50 bg-raised border border-line rounded-md py-1 shadow-xl shadow-black/50 anim-rise"
                  style={{ left: Math.min(contextMenu.x, 9999), top: contextMenu.y, minWidth: 208 }}
                >
                  <div className="px-3 py-1 text-caption text-ink-3 tnum">at {num(contextMenu.price, 2)}</div>
                  <button
                    className="w-full text-left px-3 py-1.5 text-body text-pos hover:bg-hover"
                    onClick={() => {
                      limitAt(contextMenu.price, "long");
                      setContextMenu(null);
                    }}
                  >
                    Buy limit here
                  </button>
                  <button
                    className="w-full text-left px-3 py-1.5 text-body text-neg hover:bg-hover"
                    onClick={() => {
                      limitAt(contextMenu.price, "short");
                      setContextMenu(null);
                    }}
                  >
                    Sell limit here
                  </button>
                  <div className="h-px bg-line-soft my-1" />
                  <button
                    className="w-full text-left px-3 py-1.5 text-body text-ink-2 hover:bg-hover disabled:opacity-40"
                    disabled={!position && !order}
                    onClick={() => {
                      dragLevel("stop", contextMenu.price);
                      setContextMenu(null);
                    }}
                  >
                    Move stop here
                  </button>
                  <button
                    className="w-full text-left px-3 py-1.5 text-body text-ink-2 hover:bg-hover disabled:opacity-40"
                    disabled={!position && !order}
                    onClick={() => {
                      dragLevel("target", contextMenu.price);
                      setContextMenu(null);
                    }}
                  >
                    Move target here
                  </button>
                </div>
              </>
            )}
          </div>

          {replayMode && (
            /*
             * The replay controls are docked under the chart rather than floating over it.
             *
             * As a floating pill they sat on top of price — covering whatever candles were
             * behind them, and moving with the chart rather than belonging to the window. A
             * docked strip is what TradingView does, and it means the controls never hide the
             * thing they are controlling.
             */
            <div className="shrink-0 border-t border-line bg-surface relative z-50">
              {/* Raised above the chart: the popovers here open upwards into the chart's
                  space, and the chart canvas would otherwise paint straight over them.
                  No overflow container here either: every control in this row opens a popover upwards,
                  and an ancestor that scrolls clips them out of sight. It wraps instead. */}
              <div className="flex items-center justify-center gap-2 px-3 py-1.5 flex-wrap">
                  <div className="flex items-center gap-2 bg-surface/95 backdrop-blur border border-line rounded-md px-2 py-1.5 shadow-xl shadow-black/50">

                <Popover
                  width={250}
                  side="top"
                  trigger={({ toggle, open }) => (
                    <button
                      onClick={toggle}
                      className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-sm text-body transition-colors ${
                        open || selectingBar ? "bg-hover text-ink" : "text-ink-2 hover:text-ink hover:bg-hover/60"
                      }`}
                      title="Pick a bar on the chart, or jump to a date and time"
                    >
                      {/* A bar with an arrow landing on it: pick the candle to start from. */}
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                        <path d="M3.5 2.5v11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        <path d="M13 8H6M8.4 5.6L6 8l2.4 2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {selectingBar ? "Click a bar…" : "Select bar"}
                      <svg width="9" height="9" viewBox="0 0 10 10" className="text-ink-3">
                        <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                >
                  {(close) => (
                    <div className="p-3 grid gap-2">
                      <Field label="Jump to date and time (ET)">
                        <div className="grid gap-1.5">
                          <Input
                            type="date"
                            value={jumpDate}
                            onChange={(e) => setJumpDate(e.target.value)}
                            min={base?.first ? new Date(base.first).toISOString().slice(0, 10) : undefined}
                            max={base?.last ? new Date(base.last).toISOString().slice(0, 10) : undefined}
                          />
                          <div className="flex gap-1.5">
                            <Select
                              className="flex-1"
                              value={jumpTime}
                              onChange={(e) => setJumpTime(e.target.value)}
                              title="New York time to start from"
                            >
                              {QUARTER_HOURS.map((hhmm) => (
                                <option key={hhmm} value={hhmm}>
                                  {hhmm}
                                  {hhmm === "09:30" ? "  ·  NY open" : hhmm === "18:00" ? "  ·  session open" : ""}
                                </option>
                              ))}
                            </Select>
                            <Button
                              variant="primary"
                              onClick={() => {
                                void goToDate(jumpDate, jumpTime);
                                close();
                              }}
                            >
                              Go
                            </Button>
                          </div>
                        </div>
                      </Field>
                      <div className="h-px bg-line-soft" />
                      <Button
                        onClick={() => {
                          setSelectingBar(true);
                          close();
                        }}
                      >
                        Select a bar on the chart
                      </Button>
                      <Button
                        onClick={() => {
                          const day = randomDay();
                          if (day) void goToDate(day, jumpTime);
                          close();
                        }}
                      >
                        Random day
                      </Button>
                      <p className="text-caption text-ink-3 leading-relaxed">
                        Jumping outside the loaded range restarts the session. Within it, the cursor moves and every bar in
                        between is simulated.
                      </p>
                    </div>
                  )}
                </Popover>

                <div className="w-px h-5 bg-line-soft" />

                <button
                  onClick={() => jumpRef.current(cursor - 1)}
                  disabled={playing || !!position || !!order}
                  title="Back one bar — only while flat"
                  className="h-7 w-8 rounded-sm flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover/60 disabled:opacity-30 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M4 3v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    <path d="M11 3.5L6 7l5 3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                </button>

                <button
                  onClick={() => setPlaying((p) => !p)}
                  title="Play / pause — space"
                  className={`h-7 w-8 rounded-sm flex items-center justify-center transition-colors ${
                    playing ? "bg-hover text-ink" : "text-ink-2 hover:text-ink hover:bg-hover/60"
                  }`}
                >
                  {playing ? (
                    <svg width="13" height="13" viewBox="0 0 14 14"><path d="M4 2.5h2v9H4zM8 2.5h2v9H8z" fill="currentColor" /></svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 14 14"><path d="M4 2.5l7 4.5-7 4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" /></svg>
                  )}
                </button>

                <button
                  onClick={() => stepRef.current()}
                  disabled={playing}
                  title={`Next ${effectiveStepTf} candle — right arrow`}
                  className="h-7 w-8 rounded-sm flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover/60 disabled:opacity-30 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M3 3.5L8 7l-5 3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M10 3v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>

                <button
                  onClick={() => {
                    setPlaying(false);
                    skipRef.current(10);
                  }}
                  disabled={playing}
                  title={`Skip ten ${effectiveStepTf} candles, simulating every bar`}
                  className="h-7 w-8 rounded-sm flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover/60 disabled:opacity-30 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M2 3.5L6.5 7 2 10.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M8.5 3v8M11 3v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>

                <div className="w-px h-5 bg-line-soft" />

                <Popover
                  width={140}
                  side="top"
                  trigger={({ toggle }) => (
                    <button onClick={toggle} className="h-7 px-2 rounded-sm text-body tnum text-ink-2 hover:text-ink hover:bg-hover/60" title="Playback speed">
                      {speed / 4}x
                    </button>
                  )}
                >
                  {(close) => (
                    <div className="py-1">
                      {[
                        { v: 2, label: "0.5x" },
                        { v: 4, label: "1x" },
                        { v: 12, label: "3x" },
                        { v: 40, label: "10x" },
                        { v: 80, label: "20x" },
                      ].map((o) => (
                        <button
                          key={o.v}
                          onClick={() => {
                            setSpeed(o.v);
                            close();
                          }}
                          className={`w-full text-left px-3 py-1.5 text-body hover:bg-hover ${speed === o.v ? "text-ink" : "text-ink-2"}`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                </Popover>

                <Popover
                  width={170}
                  side="top"
                  trigger={({ toggle }) => (
                    <button onClick={toggle} className="h-7 px-2 rounded-sm text-body tnum text-ink-2 hover:text-ink hover:bg-hover/60" title="How far each step advances">
                      {effectiveStepTf}
                    </button>
                  )}
                >
                  {(close) => (
                    <div className="py-1">
                      {displayTimeframes.map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            setStepTf(t);
                            close();
                          }}
                          className={`w-full flex items-center justify-between px-3 py-1.5 text-body hover:bg-hover ${
                            t === effectiveStepTf ? "text-ink" : "text-ink-2"
                          }`}
                        >
                          <span className="tnum">{t}</span>
                          <span className="text-caption text-ink-3">
                            {Math.max(1, Math.round(TF_MINUTES[t] / TF_MINUTES[baseTf]))} bars
                          </span>
                        </button>
                      ))}
                      <div className="h-px bg-line-soft my-1" />
                      <button
                        onClick={() => {
                          setStepTf(null);
                          close();
                        }}
                        className="w-full text-left px-3 py-1.5 text-body text-ink-3 hover:bg-hover"
                      >
                        Follow chart timeframe
                      </button>
                    </div>
                  )}
                </Popover>

                <span className="text-caption text-ink-3 tnum ml-2 hidden lg:block">
                  bar {cursor + 1} of {buffer.length}
                  {exhausted && " · end of data"}
                </span>
                    <div className="w-px h-5 bg-line-soft" />
                    <button
                      onClick={() => {
                        setPlaying(false);
                        setReplayMode(false);
                        setStarted(false);
                      }}
                      title="Close replay"
                      className="h-7 w-7 rounded-sm flex items-center justify-center text-ink-3 hover:text-ink hover:bg-hover/60"
                    >
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                        <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  {!started && (
                    <p className="text-caption text-ink-3 text-center mt-1.5">
                      Click a candle on the chart, or pick a date, to start replaying from there
                    </p>
                  )}
              </div>
            </div>
          )}

          <DrawingSettingsDialog
            open={!!settingsFor && !!settingsDrawing}
            drawing={settingsDrawing}
            tab={settingsTab}
            onTab={setSettingsTab}
            timeframes={displayTimeframes}
            onAnchors={(patch) =>
              settingsDrawing &&
              persistDrawings(drawings.map((d) => (d.id === settingsDrawing.id ? { ...d, ...patch } : d)))
            }
            onClose={() => setSettingsFor(null)}
            onChange={(style) => settingsDrawing && persistDrawings(drawings.map((d) => (d.id === settingsDrawing.id ? { ...d, style } : d)))}
            onDelete={() => {
              if (!settingsDrawing) return;
              persistDrawings(drawings.filter((d) => d.id !== settingsDrawing.id));
              setSettingsFor(null);
              setSelectedDrawing(null);
            }}
            onResetDefaults={() =>
              settingsDrawing &&
              persistDrawings(drawings.map((d) => (d.id === settingsDrawing.id ? { ...d, style: styleFor(d.kind) } : d)))
            }
            templates={settingsDrawing ? templates[settingsDrawing.kind] ?? [] : []}
            onSaveTemplate={(name, style) => settingsDrawing && void saveTemplate(settingsDrawing.kind, name, style)}
            onDeleteTemplate={(name) => settingsDrawing && void deleteTemplate(settingsDrawing.kind, name)}
          />
        </div>
      </div>

      {/* trading bar — collapsed by default, like a platform's bottom panel */}
      {panelOpen && (
      <>
      <div
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize · double-click to reset"
        onPointerDown={startPanelResize}
        onDoubleClick={() => setPanelHeight(120)}
        className="group shrink-0 h-[9px] border-t border-line bg-surface flex items-center justify-center cursor-ns-resize hover:bg-hover/60"
      >
        <span className="h-[2px] w-9 rounded-full bg-line group-hover:bg-ink-3 transition-colors" />
      </div>
      <div className="shrink-0 bg-surface px-3 py-2 overflow-y-auto" style={{ height: panelHeight }}>
        {position ? (
          <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
            <span className={`text-body ${position.direction === "long" ? "text-pos" : "text-neg"}`}>
              {position.direction === "long" ? "Long" : "Short"} {position.contracts} {symbol}
            </span>
            <span className="text-body text-ink-3 tnum">
              entry <span className="text-ink-2">{num(position.entry, 2)}</span> · stop{" "}
              <span className="text-ink-2">{num(position.stop, 2)}</span> · target{" "}
              <span className="text-ink-2">{position.target === null ? "—" : num(position.target, 2)}</span> · risk{" "}
              <span className="text-ink-2">{money(position.risk, app.currency)}</span>
            </span>
            <span className="text-body text-ink-3 tnum">
              MAE {num(position.mae, 2)}R · MFE {num(position.mfe, 2)}R · {position.bars} bars
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {position.target === null && (
                <Button
                  onClick={() => {
                    const distance = Math.abs(position.entry - position.stop);
                    const next = {
                      ...position,
                      target: position.direction === "long" ? position.entry + distance * 2 : position.entry - distance * 2,
                    };
                    posRef.current = next;
                    setPosition(next);
                  }}
                  title="Add a target two R away, then drag it"
                >
                  Add target
                </Button>
              )}
              <Button onClick={moveStopToBreakeven} disabled={position.stop === position.entry}>
                Stop to BE
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (!currentBar) return;
                  const closed = closeAtMarket(position, currentBar);
                  posRef.current = null;
                  setTrades((l) => [closed, ...l]);
                  void logTrade(closed);
                  setPosition(null);
                }}
              >
                Close at market
              </Button>
            </div>
          </div>
        ) : order ? (
          <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
            <span className="text-body text-ink-2">
              Working {order.direction} {order.contracts} {symbol}
            </span>
            <span className="text-body text-ink-3 tnum">
              limit <span className="text-ink-2">{num(order.entryPrice, 2)}</span> · stop{" "}
              <span className="text-ink-2">{num(order.stop, 2)}</span> · target{" "}
              <span className="text-ink-2">{order.target === null ? "—" : num(order.target, 2)}</span>
            </span>
            <span className="text-caption text-ink-3">Drag the lines on the chart to adjust · fills only if price trades through</span>
            <div className="ml-auto">
              <Button
                onClick={() => {
                  orderRef.current = null;
                  setOrder(null);
                }}
              >
                Cancel order
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex gap-1">
              {(["long", "short"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  className={`h-7 px-3 rounded-sm border text-body capitalize transition-colors ${
                    direction === d
                      ? d === "long"
                        ? "border-pos/60 bg-pos/10 text-pos"
                        : "border-neg/60 bg-neg/10 text-neg"
                      : "border-line text-ink-3 hover:text-ink-2"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>

            <Segmented
              value={entryType}
              onChange={(v) => {
                const next = v as EntryType;
                setEntryType(next);
                /*
                 * Switching to a limit fills the ticket in around the price you are looking at:
                 * the limit at the last traded price, and a stop and target either side of it.
                 * All three are then on the chart as draggable lines — which is how you actually
                 * choose where they go — instead of an empty ticket that has to be typed into
                 * before anything appears at all. Anything already typed that still fits the
                 * trade is kept.
                 */
                if (next !== "limit" || !currentBar) return;
                const typedEntry = Number(entryPrice);
                // Snapped to the tick: a limit is an order, and an order goes in at a price the
                // exchange quotes, not at whatever the last close happened to work out to.
                const entry = toTick(Number.isFinite(typedEntry) && typedEntry > 0 ? typedEntry : currentBar.close);
                setEntryPrice(String(entry));
                if (stopStillFits(entry, direction, Number(stop))) return;
                const seeded = seedBracket(entry, direction);
                setStop(String(seeded.stop));
                setTarget(String(seeded.target));
              }}
              options={[
                { value: "market", label: "Market" },
                { value: "limit", label: "Limit" },
              ]}
            />

            {entryType === "limit" && (
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Limit</span>
                <Input
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  inputMode="decimal"
                  className="h-7! py-0! w-[92px] text-body!"
                  placeholder={currentBar ? num(currentBar.close, 2) : ""}
                />
              </label>
            )}

            <label className="flex flex-col gap-1">
              <span className="eyebrow">Stop</span>
              <Input value={stop} onChange={(e) => setStop(e.target.value)} inputMode="decimal" className="h-7! py-0! w-[92px] text-body!" />
            </label>

            <label className="flex flex-col gap-1">
              <span className="eyebrow">Target</span>
              <Input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className="h-7! py-0! w-[92px] text-body!" placeholder="optional" />
            </label>

            <div className="flex gap-1">
              {[2, 3, 4].map((m) => (
                <Button key={m} onClick={() => setTargetR(m)} title={`Set the target ${m}R away`}>
                  {m}R
                </Button>
              ))}
            </div>

            <label className="flex flex-col gap-1">
              <span className="eyebrow">Contracts</span>
              <Input value={contracts} onChange={(e) => setContracts(e.target.value)} inputMode="numeric" className="h-7! py-0! w-[76px] text-body!" />
            </label>

            <span className="text-caption text-ink-3 tnum pb-1.5">
              {plannedRisk === null ? `${spec.pointValue}/pt` : `risk ${money(plannedRisk, app.currency)} · ${spec.pointValue}/pt`}
            </span>

            <Button variant="primary" onClick={place} disabled={!currentBar} className="mb-[1px]">
              Place {direction}
            </Button>

            {ticketError && <span className="text-caption text-neg pb-1.5">{ticketError}</span>}
          </div>
        )}
      </div>
      </>
      )}

      <PnlStrip
        position={position}
        openR={openR}
        currentBar={currentBar}
        stats={stats}
        currency={app.currency}
        baseTf={baseTf}
        trades={trades}
        showTrades={showTrades}
        onToggleTrades={() => setShowTrades((v) => !v)}
        panelOpen={panelOpen}
        onTogglePanel={togglePanel}
        accounts={app.activeAccounts}
        autoLog={autoLog}
        setAutoLog={setAutoLog}
        logAccountId={logAccountId}
        setLogAccountId={setLogAccountId}
        strategy={strategy}
        setStrategy={setStrategy}
        setup={setup}
        setSetup={setSetup}
      />

      <Modal
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        title="Replay sessions"
        subtitle="Leave a replay and pick it up where you stopped — bar, trades and open position."
        width={620}
      >
        <div className="grid gap-5">
          {/* Saving is only meaningful with something to save, so the form is hidden rather than
              shown disabled when nothing is running. */}
          {started ? (
            <div className="grid gap-2.5">
              <Field
                label={activeSessionId ? "Update this save" : "Save this replay"}
                hint={
                  currentBarRef.current
                    ? `${describeSession({ symbol, tf, trades, position })} · ${etDateTime(currentBarRef.current.ts).date} ${etDateTime(currentBarRef.current.ts).time}`
                    : undefined
                }
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    placeholder={activeSessionId ? "Keep the current name" : `${symbol} — name this run`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveNamedSession();
                    }}
                    className="flex-1"
                  />
                  <Button variant="primary" onClick={() => void saveNamedSession()} disabled={savingSession}>
                    {savingSession ? "Saving…" : activeSessionId ? "Update" : "Save"}
                  </Button>
                </div>
              </Field>
              <div className="text-caption text-ink-3 leading-relaxed">
                Your place is saved on its own as you replay, so closing the tab loses nothing. Name a run when you
                want it kept beside the others rather than overwritten.
              </div>
            </div>
          ) : (
            <div className="text-caption text-ink-3 leading-relaxed">
              Nothing is running. Resume one below, or start a replay and come back here to save it.
            </div>
          )}

          <div className="grid gap-2">
            <span className="eyebrow">Saved</span>

            {sessions === null ? (
              <div className="py-6 flex justify-center">
                <Spinner />
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-body text-ink-3 py-2 leading-relaxed">
                No saved sessions yet. Start a replay and your place will be kept here automatically.
              </div>
            ) : (
              sessions.map((sess) => {
                const blocked = resumeBlocker(sess, symbol);
                return (
                  <div key={sess.id} className="flex items-center gap-3 p-2.5 bg-base border border-line rounded-sm">
                    <div className="min-w-0 flex-1">
                      <div className="text-body text-ink truncate">
                        {sess.name}
                        {sess.auto && <span className="text-caption text-ink-4 ml-2">auto-saved</span>}
                        {activeSessionId === sess.id && <span className="text-caption text-accent ml-2">open</span>}
                      </div>
                      <div className="text-caption text-ink-3 tnum mt-0.5">
                        {describeSession(sess)} · {etDateTime(sess.cursorTs).date} {etDateTime(sess.cursorTs).time}
                      </div>
                      {/* Named rather than left to be discovered by clicking a button that does
                          nothing: the trades belong to one instrument and cannot move to another. */}
                      {blocked && <div className="text-caption text-warn mt-0.5">{blocked}</div>}
                    </div>
                    <Button onClick={() => void resumeSession(sess)} disabled={resuming || Boolean(blocked)}>
                      {resuming ? "Loading…" : "Resume"}
                    </Button>
                    <button
                      className="text-ink-3 hover:text-neg text-caption px-1"
                      title={`Delete ${sess.name}`}
                      onClick={() => void removeSession(sess)}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Account strip along the bottom, in the spirit of a platform's position bar. */
function PnlStrip({
  position,
  openR,
  currentBar,
  stats,
  currency,
  baseTf,
  trades,
  showTrades,
  onToggleTrades,
  panelOpen,
  onTogglePanel,
  accounts,
  autoLog,
  setAutoLog,
  logAccountId,
  setLogAccountId,
  strategy,
  setStrategy,
  setup,
  setSetup,
}: {
  position: Position | null;
  openR: number | null;
  currentBar: Candle | null;
  stats: ReturnType<typeof sessionStats>;
  currency: string;
  baseTf: Timeframe;
  trades: ClosedTrade[];
  showTrades: boolean;
  onToggleTrades: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  accounts: { id: string; name: string; type: string }[];
  autoLog: boolean;
  setAutoLog: (v: boolean) => void;
  logAccountId: string;
  setLogAccountId: (v: string) => void;
  strategy: string;
  setStrategy: (v: string) => void;
  setup: string;
  setSetup: (v: string) => void;
}) {
  const unrealised = position && openR !== null ? openR * position.risk : 0;
  const total = stats.netPnl + unrealised;
  const totalR = stats.netR + (openR ?? 0);
  const tone = (v: number) => (v > 0 ? "text-pos" : v < 0 ? "text-neg" : "text-ink-2");

  const Cell = ({ label, value, sub, valueClass = "text-ink" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; valueClass?: string }) => (
    <div className="flex flex-col gap-[1px] min-w-0">
      <span className="text-micro uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <span className={`text-ui tnum leading-none ${valueClass}`}>{value}</span>
      {sub && <span className="text-micro text-ink-3 tnum leading-none">{sub}</span>}
    </div>
  );

  return (
    <div className="shrink-0 border-t border-line bg-surface">
      {showTrades && (
        <div className="max-h-[190px] overflow-y-auto border-b border-line-soft">
          {!trades.length ? (
            <p className="px-3 py-3 text-body text-ink-3">No trades in this session yet.</p>
          ) : (
            trades.map((t, i) => (
              <div key={`${t.entryTs}-${i}`} className="flex items-center gap-3 px-3 py-1.5 border-b border-line-soft last:border-0 text-body">
                <span className="text-ink-3 tnum w-[142px] shrink-0">{etClock.format(t.entryTs)}</span>
                <span className={`w-[86px] shrink-0 ${t.direction === "long" ? "text-pos" : "text-neg"}`}>
                  {t.direction === "long" ? "Long" : "Short"} {t.contracts}
                </span>
                <span className="tnum text-ink-2 w-[76px] shrink-0">{num(t.entry, 2)}</span>
                <span className="tnum text-ink-2 w-[76px] shrink-0">{num(t.exit, 2)}</span>
                <span className="text-ink-3 flex-1 truncate">{t.reason}{t.ambiguous ? " · ambiguous" : ""}</span>
                <span className="tnum text-ink-3 w-[92px] shrink-0 text-right">
                  {num(t.mae, 2)}R / {num(t.mfe, 2)}R
                </span>
                <span className={`tnum w-[64px] shrink-0 text-right ${t.r > 0 ? "text-pos" : t.r < 0 ? "text-neg" : "text-ink-3"}`}>{fmtR(t.r)}</span>
                <span className={`tnum w-[86px] shrink-0 text-right ${t.pnl > 0 ? "text-pos" : t.pnl < 0 ? "text-neg" : "text-ink-3"}`}>
                  {money(t.pnl, currency, { sign: true })}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      <div className="flex items-center gap-x-7 gap-y-2 flex-wrap px-3 py-2.5">
        {position ? (
          <>
            <Cell
              label="Position"
              value={
                <span className={position.direction === "long" ? "text-pos" : "text-neg"}>
                  {position.direction === "long" ? "Long" : "Short"} {position.contracts}
                </span>
              }
              sub={`${num(position.entry, 2)} · risk ${money(position.risk, currency)}`}
            />
            <Cell label="Unrealised" value={money(unrealised, currency, { sign: true })} sub={fmtR(openR)} valueClass={tone(unrealised)} />
          </>
        ) : (
          <Cell label="Position" value="Flat" valueClass="text-ink-3" sub={currentBar ? `${num(currentBar.close, 2)} last` : undefined} />
        )}

        <div className="h-7 w-px bg-line-soft hidden sm:block" />

        <Cell label="Realised" value={money(stats.netPnl, currency, { sign: true })} sub={fmtR(stats.netR)} valueClass={tone(stats.netPnl)} />
        <Cell label="Total" value={money(total, currency, { sign: true })} sub={fmtR(totalR)} valueClass={tone(total)} />
        <Cell
          label="Session"
          value={`${stats.trades} trade${stats.trades === 1 ? "" : "s"}`}
          sub={stats.trades ? `${pct(stats.winRate, 0)} · ${stats.wins}W ${stats.losses}L` : undefined}
          valueClass="text-ink-2"
        />

        <div className="ml-auto flex items-center gap-2">
          {stats.ambiguous > 0 && (
            <span className="text-micro text-warn tnum hidden md:block">
              {stats.ambiguous} ambiguous fill{stats.ambiguous === 1 ? "" : "s"}
            </span>
          )}
          <span className="text-micro text-ink-3 tnum hidden md:block">stepping {baseTf}</span>
          <Button onClick={onTogglePanel} title="Order ticket and position controls">
            {panelOpen ? "Hide panel" : "Trade panel"}
          </Button>
          <Button onClick={onToggleTrades}>
            Trades {trades.length ? `(${trades.length})` : ""} {showTrades ? "▾" : "▴"}
          </Button>
          <Popover
            width={280}
            align="right"
            side="top"
            trigger={({ toggle, open }) => (
              <Button onClick={toggle} className={open ? "border-accent/60" : ""} title="Journal logging">
                Logging
              </Button>
            )}
          >
            {() => (
              <div className="p-3 grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-body">Log trades to the journal</div>
                    <div className="text-caption text-ink-3">Tagged “replay”, with MAE and MFE measured exactly</div>
                  </div>
                  <Switch checked={autoLog} onChange={setAutoLog} />
                </div>
                <Field label="Account">
                  <Select value={logAccountId} onChange={(e) => setLogAccountId(e.target.value)}>
                    <option value="">— do not log —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.type})
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Strategy">
                    <Input value={strategy} onChange={(e) => setStrategy(e.target.value)} placeholder="optional" />
                  </Field>
                  <Field label="Setup">
                    <Input value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="optional" />
                  </Field>
                </div>
              </div>
            )}
          </Popover>
        </div>
      </div>

    </div>
  );
}
