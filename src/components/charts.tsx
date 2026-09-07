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
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 58;
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
    const w = width - padL - padR;
    const h = height - padT - padB;
    const xAt = (i: number) => padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
    const yAt = (v: number) => padT + h - ((v - min) / (max - min)) * h;
    return { min, max, w, h, xAt, yAt, ticks: niceTicks(min, max, 4) };
  }, [points, width, height, baseline]);

  const path = useMemo(() => {
    if (!geom) return "";
    return points.map((p, i) => `${i ? "L" : "M"}${geom.xAt(i).toFixed(2)},${geom.yAt(p.value).toFixed(2)}`).join(" ");
  }, [geom, points]);

  const last = points[points.length - 1];
  const up = last ? last.value >= baseline : true;
  const stroke = up ? "var(--color-pos)" : "var(--color-neg)";
  const hoveredPoint = hover !== null ? points[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x - padL) / (geom.w || 1);
    const i = Math.round(t * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {geom && (
        <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block">
          <defs>
            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.14" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {geom.ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={geom.yAt(t)} y2={geom.yAt(t)} stroke="var(--color-line-soft)" strokeWidth="1" />
              <text x={padL - 8} y={geom.yAt(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--color-ink-3)" className="tnum">
                {format(t)}
              </text>
            </g>
          ))}
          {baseline >= geom.min && baseline <= geom.max && (
            <line
              x1={padL}
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
          {hover !== null && (
            <g>
              <line x1={geom.xAt(hover)} x2={geom.xAt(hover)} y1={padT} y2={height - padB} stroke="var(--color-line)" strokeWidth="1" />
              <circle cx={geom.xAt(hover)} cy={geom.yAt(points[hover].value)} r="3" fill="var(--color-base)" stroke={stroke} strokeWidth="1.5" />
            </g>
          )}
          <text x={padL} y={height - 6} fontSize="10.5" fill="var(--color-ink-3)">
            {points[0].label}
          </text>
          {points.length > 1 && (
            <text x={width - padR} y={height - 6} fontSize="10.5" fill="var(--color-ink-3)" textAnchor="end">
              {last.label}
            </text>
          )}
        </svg>
      )}
      {hoveredPoint && geom && (
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
