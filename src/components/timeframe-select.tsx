"use client";

import React from "react";
import { Popover } from "./ui";
import { TF_LABEL, type Timeframe } from "@/lib/aggregate";

/** Toolbar timeframe menu, grouped the way a chart platform groups them. */
export function TimeframeSelect({
  value,
  options,
  onChange,
  disabled,
  showUnavailable = true,
}: {
  value: Timeframe;
  /** Timeframes that actually hold bars. */
  options: Timeframe[];
  onChange: (tf: Timeframe) => void;
  disabled?: boolean;
  /** List timeframes with no data too, greyed out, so it is clear why they are absent. */
  showUnavailable?: boolean;
}) {
  const groups: { label: string; members: Timeframe[] }[] = [
    { label: "Seconds", members: ["1s", "30s"] },
    { label: "Minutes", members: ["1m", "2m", "3m", "4m", "5m", "15m"] },
    { label: "Hours", members: ["1h", "4h"] },
    { label: "Days", members: ["1d", "1w"] },
  ];

  return (
    <Popover
      width={190}
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          disabled={disabled}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-sm border text-[12.5px] tnum transition-colors disabled:opacity-45 ${
            open ? "border-accent/60 bg-hover text-ink" : "border-line text-ink hover:bg-hover"
          }`}
          title="Timeframe"
        >
          {value}
          <svg width="9" height="9" viewBox="0 0 10 10" className="text-ink-3">
            <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    >
      {(close) => (
        <div className="py-1 max-h-[320px] overflow-y-auto">
          {groups.map((g) => {
            const members = g.members.filter((m) => options.includes(m) || showUnavailable);
            if (!members.length) return null;
            return (
              <div key={g.label}>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.06em] text-ink-3">{g.label}</div>
                {members.map((tf) => {
                  const has = options.includes(tf);
                  return (
                    <button
                      key={tf}
                      disabled={!has}
                      onClick={() => {
                        if (!has) return;
                        onChange(tf);
                        close();
                      }}
                      title={has ? TF_LABEL[tf] : "No bars stored — import 1-second data on the Market data page"}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-[12.5px] ${
                        !has
                          ? "text-ink-3/50 cursor-not-allowed"
                          : tf === value
                          ? "text-ink hover:bg-hover"
                          : "text-ink-2 hover:bg-hover"
                      }`}
                    >
                      <span className="tnum">{tf}</span>
                      <span className="text-[11px] text-ink-3">{has ? TF_LABEL[tf] : "needs 1s data"}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {!options.length && <p className="px-3 py-2 text-[11.5px] text-ink-3">No candles stored yet.</p>}
        </div>
      )}
    </Popover>
  );
}
