"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Undo for the portfolio.
 *
 * Every mutation pushes the *inverse operation* rather than a copy of the previous state. Snapshot
 * undo would mean reinstating a whole page of data and quietly clobbering anything that changed
 * in between — including a price refresh, or an edit made in another tab. Reversing one action
 * touches only that action.
 *
 * The stack is deliberately per-session and in-memory. An undo that survives a reload would be
 * offering to reverse something you did last week, against data that has moved on since, and the
 * least surprising answer to "can I still undo that?" a day later is no.
 */

export interface UndoEntry {
  /** Shown on the button and in the toast: "Removed AAPL". */
  label: string;
  /** Reverses it. Throwing leaves the entry consumed — see below. */
  run: () => Promise<void>;
}

const MAX_DEPTH = 25;

export function useUndo(onAfterUndo?: () => void | Promise<void>) {
  const [stack, setStack] = useState<UndoEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // The keyboard handler is registered once, so it must not close over a stale stack.
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const push = useCallback((entry: UndoEntry) => {
    setStack((s) => [...s.slice(-(MAX_DEPTH - 1)), entry]);
  }, []);

  const clear = useCallback(() => setStack([]), []);

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    const entry = stackRef.current[stackRef.current.length - 1];
    if (!entry) return null;

    setBusy(true);
    // Popped before running, not after. If reversing fails, offering the same undo again would
    // most likely fail the same way and the second attempt could half-apply — better to surface
    // the error once and let the page reload the truth.
    setStack((s) => s.slice(0, -1));
    try {
      await entry.run();
      await onAfterUndo?.();
      return entry;
    } finally {
      setBusy(false);
    }
  }, [onAfterUndo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never steal undo from a field the user is typing in — inside an input, ⌘Z means "undo my
      // typing", and hijacking it to delete a holding would be genuinely alarming.
      const typing =
        !!target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (typing) return;

      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== "z" || e.shiftKey || e.altKey) return;
      if (stackRef.current.length === 0) return;

      e.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  return {
    push,
    undo,
    clear,
    busy,
    depth: stack.length,
    next: stack[stack.length - 1] ?? null,
  };
}

/** ⌘Z on a Mac, Ctrl+Z everywhere else. Computed lazily so it is safe during server rendering. */
export function undoShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+Z";
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘Z" : "Ctrl+Z";
}
