"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/* Responsive width measurement */
export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export interface LinePoint {
  x: number;
  value: number;
  label: string;
  sub?: string;
  delta?: number;
  /** Optional second series shown alongside the main value in the hover readout (e.g. cash next to R). */
  subValue?: number;
  subDelta?: number;
}

export function LineChart({
  points,
  baseline = 0,
  height = 240,
  format,
  formatDelta,
  formatSub,
  subLabel,
  area = true,
  tooltip = true,
  onScrub,
}: {
  points: LinePoint[];
  baseline?: number;
  height?: number;
  format: (v: number) => string;
  formatDelta?: (v: number) => string;
  /** Formatter for the optional second readout (subValue / subDelta). */
  formatSub?: (v: number) => string;
  subLabel?: string;
  area?: boolean;
  /** Off when the page prints the scrubbed figures itself, above the chart, instead of in a box. */
  tooltip?: boolean;
  /** Index of the point under the cursor, or null once the cursor leaves. */
  onScrub?: (index: number | null) => void;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const padR = 12;
  const padT = 10;
  const padB = 22;

  const geom = useMemo(() => {
    if (!points.length || width < 60) return null;
    const values = points.map((p) => p.value).concat([baseline]);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
    const ticks = niceTicks(min, max, 4);
    /**
     * The gutter is cut to fit the widest tick, not fixed at a width that happened to suit the
     * numbers on screen the day it was written. A five-figure portfolio prints "$21,560.00" into a
     * 58px gutter and loses the "$2" off the left edge — a chart reading 1,560.00 for a twenty-one
     * thousand dollar account. Tabular figures make the estimate reliable: every digit is one width.
     */
    const widest = Math.max(...ticks.map((t) => format(t).length));
    const padL = Math.min(Math.max(34, widest * 6.2 + 12), Math.max(40, width * 0.3));
    const w = width - padL - padR;
    const h = height - padT - padB;
    const xAt = (i: number) => padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
    const yAt = (v: number) => padT + h - ((v - min) / (max - min)) * h;
    return { min, max, w, h, padL, xAt, yAt, ticks };
  }, [points, width, height, baseline, format]);

  const path = useMemo(() => {
    if (!geom) return "";
    return points.map((p, i) => `${i ? "L" : "M"}${geom.xAt(i).toFixed(2)},${geom.yAt(p.value).toFixed(2)}`).join(" ");
  }, [geom, points]);

  const last = points[points.length - 1];
  const up = last ? last.value >= baseline : true;
  const stroke = up ? "var(--color-pos)" : "var(--color-neg)";
  const hoveredPoint = hover !== null ? points[hover] : null;

  /**
   * Scrubbing.
   *
   * A pointer moves far more often than sixty times a second, and every move here re-renders
   * whatever the page hangs off the readout, so the index is queued and applied once per frame.
   * Landing on the same point twice does not re-render at all, which is most moves.
   */
  const frame = useRef<number | null>(null);
  const queued = useRef<number | null>(null);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const scrub = (clientX: number) => {
    if (!geom || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const t = (clientX - rect.left - geom.padL) / (geom.w || 1);
    const i = Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1))));
    queued.current = i;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setHover((prev) => (prev === queued.current ? prev : queued.current));
    });
  };

  const release = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    setHover(null);
  };

  // The callback rides on a ref so a page can pass an inline arrow without the effect below
  // re-firing on every render of that page.
  const scrubRef = useRef(onScrub);
  scrubRef.current = onScrub;
  useEffect(() => {
    scrubRef.current?.(hover);
  }, [hover]);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {geom && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          // Captured so a drag that runs off the edge keeps scrubbing rather than stopping dead at
          // the border. A finger is left free to scroll the page vertically; only sideways movement
          // belongs to the chart.
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e.clientX);
          }}
          onPointerMove={(e) => scrub(e.clientX)}
          // A finger leaves nothing behind, so the cursor goes with it; a mouse is still hovering
          // and keeps its place. Unless the drag ended off the chart, where releasing the capture
          // is the last event that arrives and nothing would ever clear the cursor.
          onPointerUp={(e) => {
            const r = svgRef.current?.getBoundingClientRect();
            const inside =
              !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
            if (e.pointerType !== "mouse" || !inside) release();
          }}
          onPointerCancel={release}
          onPointerLeave={release}
          style={{ touchAction: "pan-y" }}
          // select-none: without it a drag across the chart sweeps the axis labels into a
          // highlighted blue selection, which is what a drag means everywhere except here.
          className="block cursor-crosshair select-none"
        >
          <defs>
            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.14" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {geom.ticks.map((t) => (
            <g key={t}>
              <line x1={geom.padL} x2={width - padR} y1={geom.yAt(t)} y2={geom.yAt(t)} stroke="var(--color-line-soft)" strokeWidth="1" />
              <text x={geom.padL - 8} y={geom.yAt(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--color-ink-3)" className="tnum">
                {format(t)}
              </text>
            </g>
          ))}
          {baseline >= geom.min && baseline <= geom.max && (
            <line
              x1={geom.padL}
              x2={width - padR}
              y1={geom.yAt(baseline)}
              y2={geom.yAt(baseline)}
              stroke="var(--color-line)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}
          {area && (
            <path
              d={`${path} L${geom.xAt(points.length - 1)},${geom.yAt(geom.min)} L${geom.xAt(0)},${geom.yAt(geom.min)} Z`}
              fill="url(#eqFill)"
            />
          )}
          <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          {points.length === 1 && <circle cx={geom.xAt(0)} cy={geom.yAt(points[0].value)} r="2.5" fill={stroke} />}
          {/* Where the line has got to. It steps aside while you scrub, so there is only ever one
              dot on the chart and it is the one you are pointing at. */}
          {points.length > 1 && hover === null && <circle cx={geom.xAt(points.length - 1)} cy={geom.yAt(last.value)} r="2.5" fill={stroke} />}
          {hoveredPoint && (
            // Between two recorded points there is nothing to report, so the cursor lands on the
            // nearer one rather than inventing a value. The glide is what makes that snap read as
            // movement instead of a jump — eighty milliseconds, over before you notice it.
            <g style={{ transition: "transform 80ms cubic-bezier(0.22, 1, 0.36, 1)", transform: `translateX(${geom.xAt(hover!)}px)` }}>
              <line x1={0} x2={0} y1={padT} y2={height - padB} stroke="var(--color-ink-4)" strokeWidth="1" />
              <circle
                r="3.5"
                fill={stroke}
                stroke="var(--color-base)"
                strokeWidth="2"
                style={{
                  transition: "transform 80ms cubic-bezier(0.22, 1, 0.36, 1)",
                  transform: `translateY(${geom.yAt(hoveredPoint.value)}px)`,
                }}
              />
            </g>
          )}
          <text x={geom.padL} y={height - 6} fontSize="10.5" fill="var(--color-ink-3)">
            {points[0].label}
          </text>
          {points.length > 1 && (
            <text x={width - padR} y={height - 6} fontSize="10.5" fill="var(--color-ink-3)" textAnchor="end">
              {last.label}
            </text>
          )}
        </svg>
      )}
      {tooltip && hoveredPoint && geom && (
        <div
          className="absolute pointer-events-none bg-raised border border-line rounded-sm px-2.5 py-1.5 text-caption shadow-lg shadow-black/40 z-10"
          style={{
            left: Math.min(Math.max(geom.xAt(hover as number) - 60, 0), Math.max(width - 130, 0)),
            top: 4,
            minWidth: 132,
          }}
        >
          <div className="text-ink-3">{hoveredPoint.label}</div>
          <div className="flex items-baseline gap-1.5">
            <span className="tnum text-ink font-medium">{format(hoveredPoint.value)}</span>
            {hoveredPoint.delta !== undefined && formatDelta && (
              <span className={`tnum text-caption ${hoveredPoint.delta > 0 ? "text-pos" : hoveredPoint.delta < 0 ? "text-neg" : "text-ink-3"}`}>
                {formatDelta(hoveredPoint.delta)}
              </span>
            )}
          </div>
          {hoveredPoint.subValue !== undefined && formatSub && (
            <div className="flex items-baseline gap-1.5 mt-0.5 pt-0.5 border-t border-line-soft">
              <span className="tnum text-ink-2">{formatSub(hoveredPoint.subValue)}</span>
              {hoveredPoint.subDelta !== undefined && (
                <span className={`tnum text-caption ${hoveredPoint.subDelta > 0 ? "text-pos" : hoveredPoint.subDelta < 0 ? "text-neg" : "text-ink-3"}`}>
                  {hoveredPoint.subDelta > 0 ? "+" : ""}
                  {formatSub(hoveredPoint.subDelta)}
                </span>
              )}
              {subLabel && <span className="text-micro text-ink-3">{subLabel}</span>}
            </div>
          )}
          {hoveredPoint.sub && <div className="text-ink-3">{hoveredPoint.sub}</div>}
        </div>
      )}
    </div>
  );
}

export interface BarItem {
  label: string;
  value: number;
  sub?: string;
}

export function BarChart({
  items,
  height = 200,
  format,
  neutralColor = false,
  maxLabelEvery = 1,
}: {
  items: BarItem[];
  height?: number;
  format: (v: number) => string;
  neutralColor?: boolean;
  maxLabelEvery?: number;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 54;
  const padR = 10;
  const padT = 8;
  const padB = 24;

  const geom = useMemo(() => {
    if (!items.length || width < 60) return null;
    const vals = items.map((i) => i.value);
    let min = Math.min(0, ...vals);
    let max = Math.max(0, ...vals);
    if (min === max) max = min + 1;
    const padding = (max - min) * 0.1;
    max += padding;
    if (min < 0) min -= padding;
    const w = width - padL - padR;
    const h = height - padT - padB;
    const band = w / items.length;
    const barW = Math.max(2, Math.min(band * 0.62, 34));
    const yAt = (v: number) => padT + h - ((v - min) / (max - min)) * h;
    return { min, max, w, h, band, barW, yAt, zero: yAt(0), ticks: niceTicks(min, max, 3) };
  }, [items, width, height]);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {geom && (
        <svg width={width} height={height} className="block" onMouseLeave={() => setHover(null)}>
          {geom.ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={geom.yAt(t)} y2={geom.yAt(t)} stroke="var(--color-line-soft)" />
              <text x={padL - 8} y={geom.yAt(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--color-ink-3)" className="tnum">
                {format(t)}
              </text>
            </g>
          ))}
          <line x1={padL} x2={width - padR} y1={geom.zero} y2={geom.zero} stroke="var(--color-line)" />
          {items.map((it, i) => {
            const x = padL + i * geom.band + (geom.band - geom.barW) / 2;
            const y = it.value >= 0 ? geom.yAt(it.value) : geom.zero;
            const h = Math.max(1, Math.abs(geom.yAt(it.value) - geom.zero));
            // "Neutral" means the bars are counts, not money — so they take a grey. Using the
            // accent here would paint them red, which on this palette reads as a loss.
            const color = neutralColor ? "var(--color-ink-2)" : it.value >= 0 ? "var(--color-pos)" : "var(--color-neg)";
            return (
              <g key={it.label + i} onMouseEnter={() => setHover(i)}>
                <rect x={padL + i * geom.band} y={padT} width={geom.band} height={geom.h} fill="transparent" />
                <rect x={x} y={y} width={geom.barW} height={h} fill={color} opacity={hover === null || hover === i ? 0.85 : 0.4} rx="1" />
                {i % maxLabelEvery === 0 && (
                  <text x={x + geom.barW / 2} y={height - 8} fontSize="10.5" fill="var(--color-ink-3)" textAnchor="middle">
                    {it.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && items[hover] && geom && (
        <div
          className="absolute pointer-events-none bg-raised border border-line rounded-sm px-2.5 py-1.5 text-caption shadow-lg shadow-black/40 z-10"
          style={{ left: Math.min(Math.max(padL + hover * geom.band - 40, 0), Math.max(width - 140, 0)), top: 0, minWidth: 110 }}
        >
          <div className="text-ink-3">{items[hover].label}</div>
          <div className={`tnum ${items[hover].value > 0 ? "text-pos" : items[hover].value < 0 ? "text-neg" : "text-ink"}`}>
            {format(items[hover].value)}
          </div>
          {items[hover].sub && <div className="text-ink-3">{items[hover].sub}</div>}
        </div>
      )}
    </div>
  );
}

/** Thin inline bar used inside breakdown tables. */
export function MiniBar({ value, max, tone }: { value: number; max: number; tone?: "pos" | "neg" }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  const t = tone ?? (value >= 0 ? "pos" : "neg");
  return (
    <div className="h-[3px] w-full bg-line-soft rounded-full overflow-hidden">
      <div className={`h-full ${t === "pos" ? "bg-pos" : "bg-neg"}`} style={{ width: `${pct}%`, opacity: 0.75 }} />
    </div>
  );
}

/** Filled step-area used for drawdown (always <= 0). */
export function DrawdownChart({ points, height = 140, format }: { points: LinePoint[]; height?: number; format: (v: number) => string }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const padL = 58;
  const padR = 12;
  const padT = 8;
  const padB = 18;
  const geom = useMemo(() => {
    if (!points.length || width < 60) return null;
    const min = Math.min(-0.0001, ...points.map((p) => p.value));
    const max = 0;
    const w = width - padL - padR;
    const h = height - padT - padB;
    const xAt = (i: number) => padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
    const yAt = (v: number) => padT + h - ((v - min * 1.1) / (max - min * 1.1)) * h;
    return { min, max, w, h, xAt, yAt, ticks: niceTicks(min * 1.1, 0, 2) };
  }, [points, width, height]);

  if (!geom) return <div ref={ref} style={{ height }} />;
  const d = points.map((p, i) => `${i ? "L" : "M"}${geom.xAt(i).toFixed(2)},${geom.yAt(p.value).toFixed(2)}`).join(" ");
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      <svg width={width} height={height} className="block">
        {geom.ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={geom.yAt(t)} y2={geom.yAt(t)} stroke="var(--color-line-soft)" />
            <text x={padL - 8} y={geom.yAt(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--color-ink-3)" className="tnum">
              {format(t)}
            </text>
          </g>
        ))}
        <path d={`${d} L${geom.xAt(points.length - 1)},${geom.yAt(0)} L${geom.xAt(0)},${geom.yAt(0)} Z`} fill="var(--color-neg)" opacity="0.13" />
        <path d={d} fill="none" stroke="var(--color-neg)" strokeWidth="1.2" opacity="0.85" />
      </svg>
    </div>
  );
}
