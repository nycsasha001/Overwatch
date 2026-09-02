"use client";

import React from "react";
import { Button, Field, Popover, Select, Switch } from "./ui";
import { DEFAULT_FVG, DEFAULT_PO3, DEFAULT_SESSIONS, type FvgOptions, type Po3Options, type SessionOptions } from "@/lib/indicators";
import { TIMEFRAMES, type Timeframe } from "@/lib/aggregate";

export interface IndicatorState {
  fvg: boolean;
  sessions: boolean;
  po3: boolean;
  /** Added to the chart but temporarily hidden from the legend's eye toggle. */
  fvgHidden: boolean;
  sessionsHidden: boolean;
  po3Hidden: boolean;
  fvgOptions: FvgOptions;
  sessionOptions: SessionOptions;
  po3Options: Po3Options;
}

export const defaultIndicators = (): IndicatorState => ({
  fvg: false,
  sessions: false,
  po3: false,
  fvgHidden: false,
  sessionsHidden: false,
  po3Hidden: false,
  fvgOptions: { ...DEFAULT_FVG },
  sessionOptions: { ...DEFAULT_SESSIONS, windows: DEFAULT_SESSIONS.windows.map((w) => ({ ...w })) },
  po3Options: { ...DEFAULT_PO3 },
});

/** Toolbar menu listing the indicators, each with a switch and its own settings. */
export function IndicatorsMenu({ state, onChange }: { state: IndicatorState; onChange: (s: IndicatorState) => void }) {
  const active = [state.fvg, state.sessions, state.po3].filter(Boolean).length;

  return (
    <Popover
      width={330}
      trigger={({ toggle, open }) => (
        <Button onClick={toggle} className={open ? "border-accent/60" : ""} title="Indicators">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 10.5l3-4 3 2.5 5-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Indicators
          {active > 0 && (
            <span className="ml-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-accent/20 text-accent text-[10.5px] flex items-center justify-center tnum">
              {active}
            </span>
          )}
        </Button>
      )}
    >
      {() => (
        <div className="p-3 grid gap-3 max-h-[70vh] overflow-y-auto">
          {/* FVG / iFVG */}
          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12.5px]">FVG / iFVG</div>
                <div className="text-[11px] text-ink-3">Three-candle imbalances, and the ones price has inverted</div>
              </div>
              <Switch checked={state.fvg} onChange={(v) => onChange({ ...state, fvg: v })} />
            </div>
            {state.fvg && (
              <div className="grid gap-2 mt-2 pl-1 border-l border-line-soft">
                <div className="flex items-center justify-between gap-3 pl-2">
                  <span className="text-[12px] text-ink-2">Hide once filled</span>
                  <Switch
                    checked={state.fvgOptions.hideFilled}
                    onChange={(v) => onChange({ ...state, fvgOptions: { ...state.fvgOptions, hideFilled: v } })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 pl-2">
                  <span className="text-[12px] text-ink-2">Show inverse FVGs</span>
                  <Switch
                    checked={state.fvgOptions.showInverse}
                    onChange={(v) => onChange({ ...state, fvgOptions: { ...state.fvgOptions, showInverse: v } })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 pl-2">
                  <span className="text-[12px] text-ink-2">50% midline</span>
                  <Switch
                    checked={state.fvgOptions.midline}
                    onChange={(v) => onChange({ ...state, fvgOptions: { ...state.fvgOptions, midline: v } })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 pl-2">
                  <span className="text-[12px] text-ink-2">Label</span>
                  <Select
                    className="w-[110px]"
                    value={state.fvgOptions.labelPosition}
                    onChange={(e) =>
                      onChange({
                        ...state,
                        fvgOptions: { ...state.fvgOptions, labelPosition: e.target.value as FvgOptions["labelPosition"] },
                      })
                    }
                  >
                    <option value="right">Right</option>
                    <option value="center">Centred</option>
                    <option value="left">Left</option>
                    <option value="hidden">Hidden</option>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-3 pl-2">
                  <span className="text-[12px] text-ink-2">Extend right</span>
                  <Select
                    className="w-[110px]"
                    value={state.fvgOptions.extendBars}
                    onChange={(e) => onChange({ ...state, fvgOptions: { ...state.fvgOptions, extendBars: Number(e.target.value) } })}
                  >
                    <option value={0}>To the edge</option>
                    {[5, 10, 20, 30, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n} bars
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-3 pl-2">
                  <span className="text-[12px] text-ink-2">Keep last</span>
                  <Select
                    className="w-[92px]"
                    value={state.fvgOptions.maxCount}
                    onChange={(e) => onChange({ ...state, fvgOptions: { ...state.fvgOptions, maxCount: Number(e.target.value) } })}
                  >
                    {[10, 20, 40, 80].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
          </section>

          <div className="h-px bg-line-soft" />

          {/* Session highs & lows */}
          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12.5px]">Session highs &amp; lows</div>
                <div className="text-[11px] text-ink-3">Levels that extend until they are swept</div>
              </div>
              <Switch checked={state.sessions} onChange={(v) => onChange({ ...state, sessions: v })} />
            </div>
            {state.sessions && (
              <div className="grid gap-1.5 mt-2 pl-3 border-l border-line-soft">
                {state.sessionOptions.windows.map((w, i) => (
                  <div key={w.name} className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-ink-2 flex items-center gap-2">
                      <input
                        type="color"
                        value={w.color}
                        onChange={(e) => {
                          const windows = state.sessionOptions.windows.map((x, j) => (i === j ? { ...x, color: e.target.value } : x));
                          onChange({ ...state, sessionOptions: { ...state.sessionOptions, windows } });
                        }}
                        className="w-[18px] h-[16px] bg-transparent border border-line rounded-xs cursor-pointer"
                        title="Line colour"
                      />
                      {w.name}
                      <span className="text-[10.5px] text-ink-3 tnum">
                        {String(Math.floor(w.start / 60)).padStart(2, "0")}:{String(w.start % 60).padStart(2, "0")}–
                        {String(Math.floor(w.end / 60) % 24).padStart(2, "0")}:{String(w.end % 60).padStart(2, "0")}
                      </span>
                    </span>
                    <Switch
                      checked={w.enabled}
                      onChange={(v) => {
                        const windows = state.sessionOptions.windows.map((x, j) => (i === j ? { ...x, enabled: v } : x));
                        onChange({ ...state, sessionOptions: { ...state.sessionOptions, windows } });
                      }}
                    />
                  </div>
                ))}
                <Field label="Session hours are read in">
                  <Select
                    value={state.sessionOptions.timezone}
                    onChange={(e) => onChange({ ...state, sessionOptions: { ...state.sessionOptions, timezone: e.target.value } })}
                  >
                    {["Europe/Brussels", "America/New_York", "UTC", "Asia/Tokyo", "Europe/London"].map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-center justify-between gap-3 mt-1">
                  <span className="text-[12px] text-ink-2">Stop at sweep</span>
                  <Switch
                    checked={state.sessionOptions.stopAtSweep}
                    onChange={(v) => onChange({ ...state, sessionOptions: { ...state.sessionOptions, stopAtSweep: v } })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-ink-2">Sessions kept</span>
                  <Select
                    className="w-[92px]"
                    value={state.sessionOptions.lookback}
                    onChange={(e) => onChange({ ...state, sessionOptions: { ...state.sessionOptions, lookback: Number(e.target.value) } })}
                  >
                    {[1, 2, 3, 5, 10].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
          </section>

          <div className="h-px bg-line-soft" />

          {/* PO3 */}
          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12.5px]">PO3 candles</div>
                <div className="text-[11px] text-ink-3">Higher-timeframe candles drawn beside price</div>
              </div>
              <Switch checked={state.po3} onChange={(v) => onChange({ ...state, po3: v })} />
            </div>
            {state.po3 && (
              <div className="grid grid-cols-2 gap-2 mt-2 pl-3 border-l border-line-soft">
                <Field label="Timeframe">
                  <Select
                    value={state.po3Options.timeframe}
                    onChange={(e) => onChange({ ...state, po3Options: { ...state.po3Options, timeframe: e.target.value as Timeframe } })}
                  >
                    {TIMEFRAMES.filter((t) => ["15m", "1h", "4h", "1d", "1w"].includes(t)).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="How many">
                  <Select
                    value={state.po3Options.count}
                    onChange={(e) => onChange({ ...state, po3Options: { ...state.po3Options, count: Number(e.target.value) } })}
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Distance from price" hint="In bars, from the latest candle">
                  <Select
                    value={state.po3Options.offset}
                    onChange={(e) => onChange({ ...state, po3Options: { ...state.po3Options, offset: Number(e.target.value) } })}
                  >
                    {[0, 3, 5, 8, 13, 20, 30, 50].map((n) => (
                      <option key={n} value={n}>
                        {n} bars
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Candle width">
                  <Select
                    value={state.po3Options.width}
                    onChange={(e) => onChange({ ...state, po3Options: { ...state.po3Options, width: Number(e.target.value) } })}
                  >
                    {[1, 2, 3, 4, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} bars
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </section>
        </div>
      )}
    </Popover>
  );
}
