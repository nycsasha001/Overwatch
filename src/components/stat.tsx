"use client";

import React from "react";

export function Stat({
  label,
  value,
  tone = "flat",
  sub,
  hint,
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "pos" | "neg" | "flat";
  sub?: React.ReactNode;
  hint?: string;
  size?: "sm" | "md" | "lg";
}) {
  const toneClass = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink";
  const sizeClass = size === "lg" ? "text-[26px]" : size === "md" ? "text-[17px]" : "text-[14px]";
  return (
    <div title={hint} className="min-w-0">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-ink-3 truncate">{label}</div>
      <div className={`tnum font-medium leading-tight mt-1 tracking-[-0.03em] ${sizeClass} ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-ink-3 mt-0.5 tnum truncate">{sub}</div>}
    </div>
  );
}

export function StatRow({ children, cols = 4 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div
      className="grid gap-x-6 gap-y-5"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${cols >= 6 ? 110 : 130}px, 1fr))` }}
    >
      {children}
    </div>
  );
}

export function KeyValue({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "pos" | "neg" | "flat" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[5px] border-b border-line-soft last:border-0">
      <span className="text-[12.5px] text-ink-3">{label}</span>
      <span className={`text-[12.5px] tnum ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink"}`}>{value}</span>
    </div>
  );
}
