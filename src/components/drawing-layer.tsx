"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MagnetMode } from "@/lib/drawings";
import {
  DEFAULT_STYLE,
  DRAWING_LABEL,
  type Anchor,
  type Drawing,
  type DrawingKind,
  type DrawingStyle,
  type Pt,
  constrainToAxis,
  extendSegment,
  fillOf,
  rgbaFromHex,
  clampSpan,
  hitTest,
  nearestCandleLevel,
  MAGNET_RADIUS,
  positionLevels,
  visibleOn,
  seedPosition,
  styleFor,
  GANN_LEVELS,
  labelPlacement,
  logicalForTime,
} from "@/lib/drawings";

export interface Converters {
  priceToY: (price: number) => number | null;
  yToPrice: (y: number) => number | null;
  timeToX: (t: number) => number | null;
  xToTime: (x: number) => number | null;
}

const dashOf = (d: DrawingStyle["dash"]) => (d === 1 ? "2 3" : d === 2 ? "6 4" : undefined);

/**
 * SVG overlay that owns creating, selecting, moving and reshaping drawings.
 *
 * It sits above the chart canvas and only takes pointer events when a tool is armed or the
 * pointer is actually over a drawing, so panning and the crosshair keep working everywhere else.
 */
export function DrawingLayer({
  drawings,
  onChange,
  tool,
  onToolDone,
  converters,
  width,
  height,
  selectedId,
  onSelect,
  template,
  onOpenSettings,
  timeframe,
  bars,
  magnet = "off",
  tickSize,
  viewVersion = 0,
}: {
  drawings: Drawing[];
  onChange: (next: Drawing[]) => void;
  tool: DrawingKind | null;
  onToolDone: () => void;
  converters: Converters;
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  template?: Partial<DrawingStyle>;
  /** Double-clicking a drawing opens its full settings. */
  onOpenSettings?: (id: string) => void;
  /** Used to honour each drawing's visibility range. */
  timeframe?: string;
  /** Candles currently drawn, so the magnet can snap to their wicks and bodies. */
  bars?: { ts: number; open: number; high: number; low: number; close: number }[] | null;
  magnet?: MagnetMode;
  /** Lets a position drawing report its distances in ticks as well as in price. */
  tickSize?: number;
  /** Bumped by the chart on pan and zoom so anchors are re-projected. */
  viewVersion?: number;
}) {
  const [draft, setDraft] = useState<Drawing | null>(null);
  /**
   * Where the magnet would put the next point, shown while a tool is armed but nothing is drawn.
   *
   * The magnet already snapped anchors on press — it just did so invisibly, so the only way to
   * find out whether it caught the wick you meant was to draw the thing and look. Showing the
   * candidate under the cursor turns that into something you can aim with.
   */
  const [snap, setSnap] = useState<Pt | null>(null);
  const pendingRef = useRef<{ drawing: Drawing; start: Pt } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "a" | "b" | "c" | "ab" | "ba" | "aP" | "bP" | "aT" | "bT";
    startPointer: Pt;
    startA: Anchor;
    startB: Anchor;
    startC: Anchor | null;
  } | null>(null);

  const toPx = useCallback(
    (anchor: Anchor): Pt | null => {
      const x = converters.timeToX(anchor.t);
      const y = converters.priceToY(anchor.price);
      if (x === null || y === null) return null;
      return { x, y };
    },
    [converters]
  );

  const toData = useCallback(
    (p: Pt): Anchor | null => {
      const t = converters.xToTime(p.x);
      const price = converters.yToPrice(p.y);
      if (t === null || price === null) return null;
      return { t, price };
    },
    [converters]
  );

  /**
   * Snap a pointer position to a candle level. Weak only grabs within a small radius; strong
   * always takes the nearest wick or body edge of the candle under the pointer.
   */
  const magnetize = useCallback(
    (p: Pt): Anchor | null => {
      if (magnet === "off" || !bars?.length) return null;
      const t = converters.xToTime(p.x);
      const price = converters.yToPrice(p.y);
      if (t === null || price === null) return null;

      let nearest = bars[0];
      let nearestGap = Math.abs(bars[0].ts - t);
      for (const b of bars) {
        const gap = Math.abs(b.ts - t);
        if (gap < nearestGap) {
          nearestGap = gap;
          nearest = b;
        }
      }

      if (magnet === "strong") {
        const level = nearestCandleLevel(nearest, price, Infinity);
        return level ? { t: nearest.ts, price: level.price } : null;
      }

      // Weak: convert the pixel radius into a price distance at the current scale.
      const refY = converters.priceToY(price);
      const edgeY = refY === null ? null : converters.yToPrice(refY + MAGNET_RADIUS);
      const radius = edgeY === null ? 0 : Math.abs(edgeY - price);
      const level = nearestCandleLevel(nearest, price, radius);
      return level ? { t: nearest.ts, price: level.price } : null;
    },
    [magnet, bars, converters]
  );

  const pointerPos = (e: React.PointerEvent | PointerEvent): Pt => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  /* ------------------------------ creating ------------------------------- */

  const finishCreate = useCallback(
    (created: Drawing, anchor: Anchor, end: Anchor) => {
      const finished: Drawing =
        created.kind === "long" || created.kind === "short"
          ? { ...created, b: end, c: seedPosition(created.kind as "long" | "short", anchor, end) }
          : { ...created, b: end };
      onChange([...drawings, finished]);
      onSelect(created.id);
      pendingRef.current = null;
      setDraft(null);
      onToolDone();
    },
    [drawings, onChange, onSelect, onToolDone]
  );

  /**
   * Two ways to draw, both supported: press and drag, or tap once, move, tap again.
   * A press that releases without moving becomes a pending drawing that follows the pointer
   * until the next click sets its second point.
   */
  const startCreate = (e: React.PointerEvent) => {
    if (!tool) return;
    const p = pointerPos(e);
    const anchor = magnetize(p) ?? toData(p);
    if (!anchor) return;
    e.preventDefault();

    // second tap: commit the pending drawing where the pointer is now
    const pending = pendingRef.current;
    if (pending) {
      const end = e.shiftKey ? toData(constrainToAxis(pending.start, p)) : anchor;
      finishCreate(pending.drawing, pending.drawing.a, end ?? pending.drawing.b);
      return;
    }

    const id = `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const created: Drawing = { id, kind: tool, a: anchor, b: anchor, style: styleFor(tool, template) };
    setDraft(created);

    const constrained = (ev: PointerEvent | MouseEvent): Anchor | null => {
      const raw = pointerPos(ev as PointerEvent);
      // Shift takes precedence over the magnet, as it does on a charting platform.
      if (ev.shiftKey) return toData(constrainToAxis(p, raw));
      return magnetize(raw) ?? toData(raw);
    };

    const move = (ev: PointerEvent) => {
      const next = constrained(ev);
      if (next) setDraft((d) => (d ? { ...d, b: next } : d));
    };

    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const released = pointerPos(ev);
      const dragged = Math.hypot(released.x - p.x, released.y - p.y) > 4;

      if (dragged) {
        finishCreate(created, anchor, constrained(ev) ?? anchor);
        return;
      }

      // A single-anchor position drops immediately with a sensible default box.
      if (tool === "long" || tool === "short") {
        const widthT = converters.xToTime(p.x + 140);
        const belowP = converters.yToPrice(p.y + 28);
        const risk = belowP !== null ? Math.abs(anchor.price - belowP) : Math.abs(anchor.price) * 0.001;
        finishCreate(created, anchor, {
          t: widthT ?? anchor.t,
          price: tool === "long" ? anchor.price - risk : anchor.price + risk,
        });
        return;
      }
      if (tool === "ray") {
        finishCreate(created, anchor, anchor);
        return;
      }

      // Otherwise wait for a second tap, following the pointer in the meantime.
      pendingRef.current = { drawing: created, start: p };
      const hover = (ev2: MouseEvent) => {
        const next = constrained(ev2);
        if (next) setDraft((d) => (d ? { ...d, b: next } : d));
      };
      const cancel = (ev2: KeyboardEvent) => {
        if (ev2.key !== "Escape") return;
        pendingRef.current = null;
        setDraft(null);
        onToolDone();
        window.removeEventListener("mousemove", hover);
        window.removeEventListener("keydown", cancel);
      };
      const settle = () => {
        window.removeEventListener("mousemove", hover);
        window.removeEventListener("keydown", cancel);
      };
      window.addEventListener("mousemove", hover);
      window.addEventListener("keydown", cancel);
      // stop following once the drawing is committed
      const check = setInterval(() => {
        if (!pendingRef.current) {
          settle();
          clearInterval(check);
        }
      }, 200);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ------------------------- selecting and moving ------------------------ */

  const startDrag = (d: Drawing, mode: "move" | "a" | "b" | "c" | "ab" | "ba" | "aP" | "bP" | "aT" | "bT") => (e: React.PointerEvent) => {
    if (d.locked) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(d.id);
    dragRef.current = { id: d.id, mode, startPointer: pointerPos(e), startA: d.a, startB: d.b, startC: d.c ?? null };

    const move = (ev: PointerEvent) => {
      const state = dragRef.current;
      if (!state) return;
      let p = pointerPos(ev);

      if (ev.shiftKey) {
        // Reshaping snaps against the opposite anchor; moving snaps against where the drag began.
        const originAnchor =
          state.mode === "a"
            ? state.startB
            : state.mode === "b"
            ? state.startA
            // The two derived corners have an opposite corner too, it just is not an anchor:
            // it is one coordinate from each.
            : state.mode === "ab"
            ? { t: state.startB.t, price: state.startA.price }
            : state.mode === "ba"
            ? { t: state.startA.t, price: state.startB.price }
            : null;
        const origin = originAnchor ? toPx(originAnchor) : state.startPointer;
        if (origin) p = constrainToAxis(origin, p);
      }

      const anchor = (ev.shiftKey ? null : magnetize(p)) ?? toData(p);
      if (!anchor) return;

      onChange(
        drawings.map((item) => {
          if (item.id !== state.id) return item;
          if (state.mode === "a") return { ...item, a: anchor };
          if (state.mode === "b") return { ...item, b: anchor };
          if (state.mode === "c") return { ...item, c: anchor };
          /**
           * The other two corners of a rectangle.
           *
           * A rect is stored as two opposite anchors, so the corners you did not drag out have no
           * anchor of their own — they are one coordinate borrowed from each. Making them
           * draggable is what lets every corner be magnetised onto a level, which is the whole
           * job when the box is an FVG and its edges are the wicks that made it.
           */
          if (state.mode === "ab") {
            return { ...item, a: { ...item.a, t: anchor.t }, b: { ...item.b, price: anchor.price } };
          }
          if (state.mode === "ba") {
            return { ...item, b: { ...item.b, t: anchor.t }, a: { ...item.a, price: anchor.price } };
          }
          /**
           * The four edge handles.
           *
           * A corner moves in both axes at once, which is the wrong tool for "this box is the
           * right height, its top just needs to sit on that wick". Each of these moves one edge
           * and leaves the other three where they are.
           */
          if (state.mode === "aP") return { ...item, a: { ...item.a, price: anchor.price } };
          if (state.mode === "bP") return { ...item, b: { ...item.b, price: anchor.price } };
          if (state.mode === "aT") return { ...item, a: { ...item.a, t: anchor.t } };
          if (state.mode === "bT") return { ...item, b: { ...item.b, t: anchor.t } };
          const startAnchor = toData(state.startPointer);
          if (!startAnchor) return item;
          const dt = anchor.t - startAnchor.t;
          const dp = anchor.price - startAnchor.price;
          return {
            ...item,
            a: { t: state.startA.t + dt, price: state.startA.price + dp },
            b: { t: state.startB.t + dt, price: state.startB.price + dp },
            c: state.startC ? { t: state.startC.t + dt, price: state.startC.price + dp } : item.c,
          };
        })
      );
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* -------------------------------- keys --------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        onChange(drawings.filter((d) => d.id !== selectedId));
        onSelect(null);
      }
      if (e.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawings, selectedId, onChange, onSelect]);

  /* ------------------------------ rendering ------------------------------ */

  const rendered = useMemo(
    () => [...drawings, ...(draft ? [draft] : [])].filter((d) => (timeframe ? visibleOn(d.style, timeframe) : true)),
    // viewVersion is a redraw trigger: the shapes are unchanged but their pixel positions are not
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawings, draft, timeframe, viewVersion]
  );

  const shapeFor = (d: Drawing) => {
    const a = toPx(d.a);
    const b = toPx(d.b);
    // Should not happen now that conversions extrapolate, but never drop a drawing silently:
    // fall back to the other anchor so it stays visible and grabbable.
    if (!a && !b) return null;
    const pa = a ?? (b as Pt);
    const pb = b ?? (a as Pt);
    const selected = d.id === selectedId;
    const stroke = d.style.color;
    const A = pa;
    const B = pb;
    // A width of zero means no border at all — drawn as stroke "none" rather than a hairline,
    // which is the difference between a shape with no outline and one with a very thin one.
    const noBorder = d.style.width === 0;
    const common = {
      stroke: noBorder ? "none" : stroke,
      strokeWidth: noBorder ? 0 : selected ? d.style.width + 1 : d.style.width,
      strokeOpacity: (d.style.strokeOpacity ?? 100) / 100,
      strokeDasharray: dashOf(d.style.dash),
      fill: "none",
      vectorEffect: "non-scaling-stroke" as const,
    };

    switch (d.kind) {
      case "ray": {
        // Horizontal, anchored where it was drawn and running forward from there.
        return (
          <g key={d.id}>
            <line x1={A.x} x2={width} y1={A.y} y2={A.y} {...common} />
            <line x1={A.x} x2={width} y1={A.y} y2={A.y} stroke="transparent" strokeWidth={12} onPointerDown={startDrag(d, "move")} style={{ cursor: "ns-resize", pointerEvents: "stroke" }} />
            {(() => {
              // The label can sit at either end of the ray or in the middle of it, above the line,
              // below it, or on it. The span runs from where the ray was anchored to the right
              // edge of the plot, which is as far as it is drawn.
              const hAlign = d.style.labelHAlign ?? "left";
              const vAlign = d.style.labelAlign ?? "top";
              const L = labelPlacement({ x1: A.x, x2: width, y: A.y, hAlign, vAlign, fontSize: d.style.labelSize });
              // The price follows the label rather than sitting under a fixed corner, or moving
              // the label would leave the two at opposite ends of the same line.
              const priceY = vAlign === "bottom" ? L.y + d.style.labelSize + 2 : vAlign === "inside" ? A.y + d.style.labelSize + 6 : L.y - d.style.labelSize - 2;
              return (
                <>
                  {d.style.label && (
                    <text
                      x={L.x}
                      y={L.y}
                      textAnchor={L.anchor}
                      fontSize={d.style.labelSize}
                      fontWeight={d.style.labelBold ? 600 : 400}
                      fill={d.style.labelColor ?? stroke}
                      style={{ pointerEvents: "none" }}
                    >
                      {d.style.label}
                    </text>
                  )}
                  {d.style.showPrices && (
                    <text
                      x={L.x}
                      y={d.style.label ? priceY : L.y}
                      textAnchor={L.anchor}
                      fontSize={9}
                      fill={stroke}
                      className="tnum"
                      style={{ pointerEvents: "none" }}
                    >
                      {d.a.price.toFixed(2)}
                    </text>
                  )}
                </>
              );
            })()}
            {selected && <circle cx={A.x} cy={A.y} r={4} fill={stroke} onPointerDown={startDrag(d, "a")} style={{ cursor: "grab", pointerEvents: "all" }} />}
          </g>
        );
      }
      case "gann": {
        const { x, w } = clampSpan(A.x, B.x, width);
        const y = Math.min(A.y, B.y);
        const h = Math.abs(B.y - A.y);
        if (w <= 0) return null;
        return (
          <g key={d.id}>
            <rect x={x} y={y} width={w} height={h} fill={fillOf(d.style) ?? "none"} stroke={stroke} strokeWidth={common.strokeWidth} />
            {/* Three lines only — the two ends of the leg and its midpoint. The vertical grid and
                the diagonal belonged to a Gann fan and say nothing about equilibrium. */}
            {GANN_LEVELS.map((lv) => (
              <line
                key={`h${lv}`}
                x1={x}
                x2={x + w}
                y1={y + h * lv}
                y2={y + h * lv}
                stroke={stroke}
                strokeWidth={lv === 0.5 ? 1 : 0.9}
                strokeDasharray={lv === 0.5 ? "5 4" : undefined}
                opacity={lv === 0.5 ? 0.85 : 0.9}
              />
            ))}
            <text x={x + 3} y={y + h * 0.5 - 3} fontSize={9} fill={stroke} opacity={0.8}>
              EQ
            </text>
            {d.style.showPrices && (
              <>
                <text x={x + w - 4} y={y - 4} fontSize={9} textAnchor="end" fill={stroke} className="tnum" style={{ pointerEvents: "none" }}>
                  {Math.max(d.a.price, d.b.price).toFixed(2)}
                </text>
                <text x={x + w - 4} y={y + h + 10} fontSize={9} textAnchor="end" fill={stroke} className="tnum" style={{ pointerEvents: "none" }}>
                  {Math.min(d.a.price, d.b.price).toFixed(2)}
                </text>
              </>
            )}
            <rect x={x} y={y} width={w} height={h} fill="transparent" onPointerDown={startDrag(d, "move")} style={{ cursor: "move", pointerEvents: "all" }} />
            {selected &&
              ([
                // Four corners…
                [A.x, A.y, "a", "nwse-resize"],
                [B.x, B.y, "b", "nwse-resize"],
                [A.x, B.y, "ab", "nesw-resize"],
                [B.x, A.y, "ba", "nesw-resize"],
                // …and the midpoint of each edge, for moving one side onto a level.
                [(A.x + B.x) / 2, A.y, "aP", "ns-resize"],
                [(A.x + B.x) / 2, B.y, "bP", "ns-resize"],
                [A.x, (A.y + B.y) / 2, "aT", "ew-resize"],
                [B.x, (A.y + B.y) / 2, "bT", "ew-resize"],
              ] as [number, number, "a" | "b" | "ab" | "ba" | "aP" | "bP" | "aT" | "bT", string][]).map(([hx, hy, mode, cursor]) => (
                <g key={mode}>
                  {/* A dark ring under the dot, so a handle stays visible on top of the fill. */}
                  <circle cx={hx} cy={hy} r={4.5} fill="#08080a" opacity={0.85} style={{ pointerEvents: "none" }} />
                  <circle
                    cx={hx}
                    cy={hy}
                    r={3.5}
                    fill={stroke}
                    onPointerDown={startDrag(d, mode)}
                    style={{ cursor, pointerEvents: "all" }}
                  />
                  {/* A larger invisible target: the dot is small enough to be fiddly to grab. */}
                  <circle
                    cx={hx}
                    cy={hy}
                    r={9}
                    fill="transparent"
                    onPointerDown={startDrag(d, mode)}
                    style={{ cursor, pointerEvents: "all" }}
                  />
                </g>
              ))}
          </g>
        );
      }
      case "rect": {
        const { x, w } = clampSpan(A.x, B.x, width);
        const y = Math.min(A.y, B.y);
        const h = Math.abs(B.y - A.y);
        if (w <= 0) return null;
        return (
          <g key={d.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={fillOf(d.style) ?? "none"}
              stroke={common.stroke}
              strokeWidth={common.strokeWidth}
              strokeOpacity={common.strokeOpacity}
              strokeDasharray={common.strokeDasharray}
            />
            {d.style.midline && <line x1={x} x2={x + w} y1={y + h / 2} y2={y + h / 2} stroke={stroke} strokeWidth={1} strokeDasharray="5 4" opacity={0.85} />}
            {d.style.label &&
              (() => {
                // Vertical placement: above, below, or centred through the box.
                const ly =
                  d.style.labelAlign === "bottom"
                    ? y + h + d.style.labelSize + 2
                    : d.style.labelAlign === "inside"
                    ? y + h / 2 - 3
                    : y - 4;
                // Horizontal placement is independent of the vertical one — either can pair with
                // any of the other, matching a rectangle's usual left/centre/right × top/middle/bottom grid.
                // Drawings saved before this axis existed have no labelHAlign; "inside" used to
                // imply centred both ways, so fall back to that rather than defaulting to "left".
                const hAlign = d.style.labelHAlign ?? (d.style.labelAlign === "inside" ? "middle" : "left");
                const lx = hAlign === "middle" ? x + w / 2 : hAlign === "right" ? x + w - 4 : x + 4;
                const anchor = hAlign === "middle" ? "middle" : hAlign === "right" ? "end" : "start";
                return (
                  <text
                    x={lx}
                    y={ly}
                    textAnchor={anchor}
                    fontSize={d.style.labelSize}
                    fontWeight={d.style.labelBold ? 600 : 400}
                    fill={d.style.labelColor ?? stroke}
                    style={{ pointerEvents: "none" }}
                  >
                    {d.style.label}
                  </text>
                );
              })()}
            {d.style.showPrices && (
              <>
                <text x={x + w - 4} y={y - 4} fontSize={9} textAnchor="end" fill={stroke} className="tnum" style={{ pointerEvents: "none" }}>
                  {Math.max(d.a.price, d.b.price).toFixed(2)}
                </text>
                <text x={x + w - 4} y={y + h + 10} fontSize={9} textAnchor="end" fill={stroke} className="tnum" style={{ pointerEvents: "none" }}>
                  {Math.min(d.a.price, d.b.price).toFixed(2)}
                </text>
              </>
            )}
            <rect x={x} y={y} width={w} height={h} fill="transparent" onPointerDown={startDrag(d, "move")} style={{ cursor: "move", pointerEvents: "all" }} />
            {selected &&
              ([
                // Four corners…
                [A.x, A.y, "a", "nwse-resize"],
                [B.x, B.y, "b", "nwse-resize"],
                [A.x, B.y, "ab", "nesw-resize"],
                [B.x, A.y, "ba", "nesw-resize"],
                // …and the midpoint of each edge, for moving one side onto a level.
                [(A.x + B.x) / 2, A.y, "aP", "ns-resize"],
                [(A.x + B.x) / 2, B.y, "bP", "ns-resize"],
                [A.x, (A.y + B.y) / 2, "aT", "ew-resize"],
                [B.x, (A.y + B.y) / 2, "bT", "ew-resize"],
              ] as [number, number, "a" | "b" | "ab" | "ba" | "aP" | "bP" | "aT" | "bT", string][]).map(([hx, hy, mode, cursor]) => (
                <g key={mode}>
                  {/* A dark ring under the dot, so a handle stays visible on top of the fill. */}
                  <circle cx={hx} cy={hy} r={4.5} fill="#08080a" opacity={0.85} style={{ pointerEvents: "none" }} />
                  <circle
                    cx={hx}
                    cy={hy}
                    r={3.5}
                    fill={stroke}
                    onPointerDown={startDrag(d, mode)}
                    style={{ cursor, pointerEvents: "all" }}
                  />
                  {/* A larger invisible target: the dot is small enough to be fiddly to grab. */}
                  <circle
                    cx={hx}
                    cy={hy}
                    r={9}
                    fill="transparent"
                    onPointerDown={startDrag(d, mode)}
                    style={{ cursor, pointerEvents: "all" }}
                  />
                </g>
              ))}
          </g>
        );
      }
      case "long":
      case "short": {
        const { entry, stop, target, rr } = positionLevels(d);
        const yEntry = converters.priceToY(entry);
        const yStop = converters.priceToY(stop);
        const yTarget = converters.priceToY(target);
        if (yEntry === null || yStop === null || yTarget === null) return null;
        // A position anchored off-screen must not paint across the whole chart.
        const span = clampSpan(A.x, B.x, width);
        if (span.w <= 0) return null;
        const x = span.x;
        const w = Math.max(span.w, 120);
        const cx = x + w / 2;

        /**
         * The labels a position tool exists to show.
         *
         * Distance from entry in up to three units at once — offset, percent and ticks — because
         * which one matters depends on what you are doing: percent to compare across instruments,
         * ticks to size an order, offset to eyeball it in price terms. "Price labels" turns the
         * numbers off entirely; "Compact stats" drops straight to the bare price.
         */
        const statsFields = d.style.statsFields ?? ["pct", "ticks"];
        const away = (p: number): string | null => {
          if (!d.style.showPrices) return null;
          if (d.style.compactStats) return p.toFixed(2);
          const parts = [p.toFixed(2)];
          if (statsFields.includes("offset")) parts.push(`Δ${Math.abs(p - entry).toFixed(2)}`);
          if (statsFields.includes("pct")) parts.push(`(${(entry ? (Math.abs(p - entry) / entry) * 100 : 0).toFixed(3)}%)`);
          if (statsFields.includes("ticks") && tickSize && tickSize > 0) parts.push(`${Math.round(Math.abs(p - entry) / tickSize)}`);
          return parts.join(" ");
        };
        // Drawings saved before this flag existed have no alwaysShowStats; default it to true so
        // they keep behaving the way they always did rather than going quiet until reselected.
        const showStats = selected || (d.style.alwaysShowStats ?? true);

        // No text metrics inside an SVG render, so the chip is sized from the character count.
        const chipW = (text: string, size: number) => text.length * size * 0.52 + 10;

        /**
         * Labels scaled to the box they belong to.
         *
         * The chip is a fixed size in pixels while the drawing is whatever you dragged, so on a
         * small position the full text ends up wider than the thing it is describing. Rather than
         * let it overhang, each label has shorter forms to fall back through — full, then price
         * only, then nothing — and takes the longest one that actually fits.
         */
        const fit = (options: string[], size: number) =>
          options.find((o) => chipW(o, size) <= w - 6) ?? null;

        const chip = (key: string, cy: number, fill: string, rows: (string | null)[], size = 9) => {
          const shown = rows.filter((r): r is string => !!r);
          if (!shown.length) return null;
          const wide = Math.max(...shown.map((r) => chipW(r, size)));
          const h = shown.length * (size + 2) + 5;
          return (
            <g key={key} style={{ pointerEvents: "none" }}>
              <rect
                x={cx - wide / 2}
                y={cy - h / 2}
                width={wide}
                height={h}
                rx={3}
                fill={fill}
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={0.75}
              />
              {shown.map((r, i) => (
                <text
                  key={i}
                  x={cx}
                  y={cy - h / 2 + 5 + i * (size + 2) + size * 0.45}
                  fontSize={size}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#08080a"
                  style={{ pointerEvents: "none" }}
                >
                  {r}
                </text>
              ))}
            </g>
          );
        };

        const rows: { y: number; price: number; colour: string; mode: "a" | "b" | "c" }[] = [
          { y: yEntry, price: entry, colour: d.style.entryColor, mode: "a" },
          { y: yStop, price: stop, colour: d.style.stopColor, mode: "b" },
          { y: yTarget, price: target, colour: d.style.targetColor, mode: "c" },
        ];

        return (
          <g key={d.id}>
            {/*
              Risk below the entry, reward above it — or the other way up for a short. Each zone
              is tinted with its own level's colour, so changing the stop colour recolours the
              whole risk side rather than just the line drawn across it.
            */}
            <rect
              x={x}
              y={Math.min(yEntry, yStop)}
              width={w}
              height={Math.abs(yStop - yEntry)}
              fill={rgbaFromHex(d.style.stopColor, d.style.fillOpacity) ?? "rgba(120,123,134,0.16)"}
              stroke="none"
            />
            <rect
              x={x}
              y={Math.min(yEntry, yTarget)}
              width={w}
              height={Math.abs(yTarget - yEntry)}
              fill={rgbaFromHex(d.style.targetColor, d.style.fillOpacity) ?? fillOf(d.style) ?? "rgba(41,98,255,0.16)"}
              stroke="none"
            />
            <rect
              x={x}
              y={Math.min(yStop, yTarget)}
              width={w}
              height={Math.abs(yTarget - yStop)}
              fill="transparent"
              onPointerDown={startDrag(d, "move")}
              style={{ cursor: "move", pointerEvents: "all" }}
            />

            {rows.map((row) => (
              <g key={row.mode}>
                <line x1={x} x2={x + w} y1={row.y} y2={row.y} stroke={row.colour} strokeWidth={1} />
                <line
                  x1={x}
                  x2={x + w}
                  y1={row.y}
                  y2={row.y}
                  stroke="transparent"
                  strokeWidth={10}
                  onPointerDown={startDrag(d, row.mode)}
                  style={{ cursor: "ns-resize", pointerEvents: "stroke" }}
                />
                {selected && (
                  <circle
                    cx={x + w}
                    cy={row.y}
                    r={4}
                    fill={row.colour}
                    onPointerDown={startDrag(d, row.mode)}
                    style={{ cursor: "ns-resize", pointerEvents: "all" }}
                  />
                )}
              </g>
            ))}

            {showStats &&
              chip("target", yTarget, d.style.targetColor, [
                away(target) === null
                  ? fit(["Target"], 9)
                  : fit([`Target: ${away(target)}`, `Target: ${target.toFixed(2)}`, target.toFixed(2)], 9),
              ])}
            {showStats &&
              chip("stop", yStop, d.style.stopColor, [
                away(stop) === null ? fit(["Stop"], 9) : fit([`Stop: ${away(stop)}`, `Stop: ${stop.toFixed(2)}`, stop.toFixed(2)], 9),
              ])}
            {showStats &&
              chip("entry", yEntry, d.style.entryColor, [
                fit([`${d.kind === "long" ? "Long" : "Short"}: ${entry.toFixed(2)}`, entry.toFixed(2)], 9),
                // The second line only when compact stats are off and the box is tall enough to
                // carry it without crowding the two lines either side of it.
                d.style.compactStats || Math.abs(yTarget - yStop) < 64
                  ? null
                  : fit(
                      [
                        `Risk/reward ratio: ${rr ? rr.toFixed(2) : "—"}${d.style.label ? ` · ${d.style.label}` : ""}`,
                        `RR ${rr ? rr.toFixed(2) : "—"}`,
                      ],
                      9
                    ),
              ])}
          </g>
        );
      }
      default: {
        const [p1, p2] = extendSegment(A, B, width, d.style.extendLeft, d.style.extendRight);
        const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const arrow = (tip: Pt, ux: number, uy: number) => {
          const size = 8;
          const spread = 3.4;
          const bx = tip.x - ux * size;
          const by = tip.y - uy * size;
          const px = -uy;
          const py = ux;
          return `M ${tip.x} ${tip.y} L ${bx + px * spread} ${by + py * spread} L ${bx - px * spread} ${by - py * spread} Z`;
        };
        const showStats = d.style.lineStats && (selected || d.style.alwaysShowStats);
        const statT = d.style.statsPosition === "left" ? 0.25 : d.style.statsPosition === "center" ? 0.5 : 0.75;
        const statPt = { x: A.x + dx * statT, y: A.y + dy * statT };
        const deltaPrice = d.b.price - d.a.price;
        const deltaPct = d.a.price ? (deltaPrice / d.a.price) * 100 : 0;
        const barCount =
          bars && bars.length
            ? (() => {
                const la = logicalForTime(bars, d.a.t);
                const lb = logicalForTime(bars, d.b.t);
                return la === null || lb === null ? null : Math.round(Math.abs(lb - la));
              })()
            : null;
        return (
          <g key={d.id}>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} {...common} />
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={12} onPointerDown={startDrag(d, "move")} style={{ cursor: "move", pointerEvents: "stroke" }} />
            {d.style.capA === "arrow" && !noBorder && <path d={arrow(A, -ux, -uy)} fill={stroke} />}
            {d.style.capB === "arrow" && !noBorder && <path d={arrow(B, ux, uy)} fill={stroke} />}
            {d.style.midpoint && <circle cx={mid.x} cy={mid.y} r={3} fill={stroke} stroke="#08080a" strokeWidth={1} style={{ pointerEvents: "none" }} />}
            {d.style.showPrices && (
              <>
                <text x={A.x + 6} y={A.y - 6} fontSize={9} fill={stroke} style={{ pointerEvents: "none" }}>
                  {d.a.price.toFixed(2)}
                </text>
                <text x={B.x + 6} y={B.y - 6} fontSize={9} fill={stroke} style={{ pointerEvents: "none" }}>
                  {d.b.price.toFixed(2)}
                </text>
              </>
            )}
            {showStats && (
              <text
                x={statPt.x}
                y={statPt.y - 8}
                fontSize={9.5}
                textAnchor="middle"
                fill={stroke}
                className="tnum"
                style={{ pointerEvents: "none" }}
              >
                {`${deltaPrice >= 0 ? "+" : ""}${deltaPrice.toFixed(2)} (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%)${
                  barCount === null ? "" : ` · ${barCount} bars`
                }`}
              </text>
            )}
            {selected && (
              <>
                <circle cx={A.x} cy={A.y} r={4} fill={stroke} onPointerDown={startDrag(d, "a")} style={{ cursor: "grab", pointerEvents: "all" }} />
                <circle cx={B.x} cy={B.y} r={4} fill={stroke} onPointerDown={startDrag(d, "b")} style={{ cursor: "grab", pointerEvents: "all" }} />
              </>
            )}
            {d.style.label &&
              (() => {
                // A sloped line has no single "the line", so the label rides the segment: its
                // vertical anchor is the height of the line at whichever end it is placed against.
                const hAlign = d.style.labelHAlign ?? "middle";
                const vAlign = d.style.labelAlign ?? "top";
                const yAt = hAlign === "left" ? p1.y : hAlign === "right" ? p2.y : (p1.y + p2.y) / 2;
                const L = labelPlacement({ x1: p1.x, x2: p2.x, y: yAt, hAlign, vAlign, fontSize: d.style.labelSize });
                return (
                  <text
                    x={L.x}
                    y={L.y}
                    textAnchor={L.anchor}
                    fontSize={d.style.labelSize}
                    fontWeight={d.style.labelBold ? 600 : 400}
                    fill={d.style.labelColor ?? stroke}
                    style={{ pointerEvents: "none" }}
                  >
                    {d.style.label}
                  </text>
                );
              })()}
          </g>
        );
      }
    }
  };

  return (
    <svg
      ref={svgRef}
      data-drawings=""
      width={width}
      height={height}
      className="absolute inset-0 z-20"
      style={{ pointerEvents: tool ? "auto" : "none", cursor: tool ? "crosshair" : undefined }}
      onPointerDown={(e) => {
        if (tool) startCreate(e);
        else if (e.target === svgRef.current) onSelect(null);
      }}
      onPointerMove={(e) => {
        // Only while a tool is armed and nothing is being dragged: during a drag the shape itself
        // is already following the snapped point, so a second marker would just be noise.
        if (!tool || magnet === "off" || draft || dragRef.current) {
          if (snap) setSnap(null);
          return;
        }
        const target = magnetize(pointerPos(e));
        const px = target ? toPx(target) : null;
        setSnap((prev) =>
          px === null ? null : prev && Math.abs(prev.x - px.x) < 0.5 && Math.abs(prev.y - px.y) < 0.5 ? prev : px
        );
      }}
      onPointerLeave={() => setSnap(null)}
    >
      {snap && (
        <g style={{ pointerEvents: "none" }}>
          <circle cx={snap.x} cy={snap.y} r={5.5} fill="none" stroke="#e7eaee" strokeWidth={1.2} opacity={0.9} />
          <circle cx={snap.x} cy={snap.y} r={1.6} fill="#e7eaee" opacity={0.9} />
        </g>
      )}
      {rendered.map((d) => (
        <g
          key={`w-${d.id}`}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onOpenSettings?.(d.id);
          }}
        >
          {shapeFor(d)}
        </g>
      ))}
    </svg>
  );
}

/** Which drawing, if any, sits under a pointer — used to decide whether to claim the event. */
export function drawingAt(drawings: Drawing[], p: Pt, toPx: (a: Anchor) => Pt | null): Drawing | null {
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    const a = toPx(d.a);
    const b = toPx(d.b);
    if (!a || !b) continue;
    if (hitTest(d.kind, p, a, b, d.style.width)) return d;
  }
  return null;
}

export const emptyStyle = DEFAULT_STYLE;
export const kindLabel = DRAWING_LABEL;
