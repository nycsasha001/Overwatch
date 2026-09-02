"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Vertical drag handle. The chosen height is remembered per view, so a chart you dragged taller
 * stays that way next time.
 */
export function Resizable({
  storageKey,
  defaultHeight,
  min = 220,
  max = 1400,
  children,
}: {
  storageKey: string;
  defaultHeight: number;
  min?: number;
  max?: number;
  children: (height: number) => React.ReactNode;
}) {
  const [height, setHeight] = useState(defaultHeight);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startH = useRef(0);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const n = Number(saved);
        if (Number.isFinite(n)) setHeight(Math.min(Math.max(n, min), max));
      }
    } catch {
      /* preference simply will not persist */
    }
  }, [storageKey, min, max]);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const next = Math.min(Math.max(startH.current + (e.clientY - startY.current), min), max);
      setHeight(next);
    },
    [min, max]
  );

  const onUp = useCallback(() => {
    setDragging(false);
    setHeight((h) => {
      try {
        window.localStorage.setItem(storageKey, String(h));
      } catch {
        /* ignore */
      }
      return h;
    });
  }, [storageKey]);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, onMove, onUp]);

  return (
    <div>
      {children(height)}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize the chart"
        title="Drag to resize · double-click to reset"
        onPointerDown={(e) => {
          e.preventDefault();
          startY.current = e.clientY;
          startH.current = height;
          setDragging(true);
        }}
        onDoubleClick={() => {
          setHeight(defaultHeight);
          try {
            window.localStorage.setItem(storageKey, String(defaultHeight));
          } catch {
            /* ignore */
          }
        }}
        className={`group h-[11px] flex items-center justify-center cursor-ns-resize ${dragging ? "bg-hover" : "hover:bg-hover/60"} transition-colors`}
      >
        <span className={`h-[2px] w-9 rounded-full transition-colors ${dragging ? "bg-accent" : "bg-line group-hover:bg-ink-3"}`} />
      </div>
    </div>
  );
}
