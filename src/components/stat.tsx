"use client";

import React from "react";

/**
 * A figure and what it is.
 *
 * Nearly every number in Overwatch is rendered through this, so it is the single place that
 * decides how financial data reads. Three things it does deliberately:
 *
 * The label sits *above* the value and is the quietest thing in the block. A label competing with
 * its own figure is the commonest way a dashboard ends up looking busy — you scan a row of stats
 * for the numbers, and the words are only consulted once something stands out.
 *
 * The value is tracked in tightly and set in the mono face. Negative tracking at display sizes is
 * most of what separates a figure that looks set from one that looks defaulted, and tabular digits
 * mean a row of stats aligns without the layout doing anything.
 *
 * Tone is spent only on direction. A flat or neutral figure stays in body ink; colour here means
 * "this went up" or "this went down" and nothing else, which is what keeps it meaningful when it
 * does appear.
 */
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
  const sizeClass =
    size === "lg" ? "text-figure" : size === "md" ? "text-figure-sm" : "text-title";
  // Larger type needs more negative tracking, not the same amount: the gap between letters grows
  // with the type while the eye's tolerance for it does not.
  const trackClass = size === "lg" ? "tracking-[-0.035em]" : "tracking-[-0.025em]";

  return (
    <div title={hint} className="min-w-0">
      <div className="eyebrow truncate">{label}</div>
      <div className={`tnum font-medium leading-none mt-2 ${sizeClass} ${trackClass} ${toneClass}`}>{value}</div>
      {sub && <div className="text-caption text-ink-3 mt-1.5 tnum truncate">{sub}</div>}
    </div>
  );
}

/**
 * A row of stats that reflows instead of wrapping awkwardly.
 *
 * The generous column gap is the point. Stats separated by a thin margin read as one continuous
 * strip of digits; the space is what turns them into distinct facts, and it does the job a divider
 * would have done without adding another line to the screen.
 */
export function StatRow({ children, cols = 4 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div
      className="grid gap-x-8 gap-y-6"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${cols >= 6 ? 108 : 132}px, 1fr))` }}
    >
      {children}
    </div>
  );
}

/**
 * A labelled value on one line, for detail lists.
 *
 * The rule beneath each row is the softest in the palette and the last one is dropped, so a list
 * of these reads as a set of related facts rather than as a table someone forgot to finish.
 */
export function KeyValue({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "pos" | "neg" | "flat" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-line-soft last:border-0">
      <span className="text-body text-ink-3">{label}</span>
      <span className={`text-body tnum ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink"}`}>{value}</span>
    </div>
  );
}
