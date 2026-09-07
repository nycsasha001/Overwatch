"use client";

import React, { useEffect, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Panel                                                                     */
/* -------------------------------------------------------------------------- */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClass = "",
  flush,
  id,
  collapsible,
  defaultCollapsed = false,
  storageKey,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
  flush?: boolean;
  id?: string;
  /** Adds a disclosure control to the header. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Remembers the open/closed choice across sessions. */
  storageKey?: string;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    if (!collapsible || !storageKey) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved !== null) setCollapsed(saved === "1");
    } catch {
      /* storage unavailable — fall back to the default */
    }
  }, [collapsible, storageKey]);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, next ? "1" : "0");
        } catch {
          /* preference simply will not persist */
        }
      }
      return next;
    });
  };

  const heading = (
    <div className="min-w-0">
      <h2 className="text-micro font-semibold tracking-[0.11em] uppercase text-ink-2 truncate">{title}</h2>
      {subtitle && <p className="text-caption text-ink-3 truncate mt-0.5">{subtitle}</p>}
    </div>
  );

  return (
    <section id={id} className={`bg-surface border border-line rounded-md elev-1 ${className}`}>
      {(title || actions) && (
        <header
          className={`flex items-center justify-between gap-3 px-[18px] h-12 ${
            collapsible && collapsed ? "" : "border-b border-line-soft"
          }`}
        >
          {collapsible ? (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={!collapsed}
              className="flex items-center gap-2 min-w-0 text-left group -ml-1 pl-1 pr-2 h-full hover:opacity-90"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                className={`text-ink-3 shrink-0 transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
              >
                <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {heading}
            </button>
          ) : (
            heading
          )}
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      {/* A touch more room than before. Panels were reading as tight because the padding matched
          the gap between them, so the contents sat as close to the frame as the frames sat to each
          other and nothing had space of its own. */}
      {!(collapsible && collapsed) && <div className={flush ? bodyClass : `p-[18px] ${bodyClass}`}>{children}</div>}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Button                                                                    */
/* -------------------------------------------------------------------------- */

type BtnVariant = "primary" | "default" | "ghost" | "danger";
type BtnSize = "sm" | "md";

export function Button({
  variant = "default",
  size = "sm",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  // active:translate-y-px on every variant: a control that does not move under the cursor feels
  // like a picture of a button. The red one moves through .btn-lit, which also drops its gradient.
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-sm border font-medium transition-[background-color,border-color,color,transform,box-shadow] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:translate-y-0 whitespace-nowrap select-none";
  // 30px and 36px: TradingView's toolbar buttons sit around 30, its dialog buttons around 36.
  const sizes: Record<BtnSize, string> = { sm: "h-[30px] px-3.5 text-body", md: "h-9 px-4 text-ui" };
  const variants: Record<BtnVariant, string> = {
    // The one filled-red element in the interface. Red is the secondary colour here, so it is
    // spent on the single action that matters on a screen and nowhere else — ordinary buttons
    // stay black and let it stand alone.
    primary:
      "btn-lit bg-accent border-accent text-white hover:bg-[var(--color-accent-lift)] hover:border-[var(--color-accent-lift)]",
    // Raised, with the same top highlight the panels use, so a button reads as sitting on the
    // surface rather than being drawn onto it.
    default: "bg-raised border-line text-ink elev-1 hover:bg-hover hover:border-[#332f2b] active:translate-y-px",
    ghost: "bg-transparent border-transparent text-ink-2 hover:text-ink hover:bg-hover active:translate-y-px",
    danger: "bg-transparent border-line text-neg hover:bg-neg-dim hover:border-neg/45 active:translate-y-px",
  };
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest} />;
}

/* -------------------------------------------------------------------------- */
/*  Fields                                                                    */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {error ? (
        <p className="mt-1 text-caption text-neg">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-caption text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = "", ...rest },
  ref
) {
  return <input ref={ref} className={`field ${className}`} {...rest} />;
});

export function Select({ className = "", children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`field ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`field ${className}`} {...rest} />;
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 h-7 px-2.5 rounded-sm border text-body transition-colors duration-100 ${
        checked ? "bg-accent/12 border-accent/50 text-ink" : "bg-base border-line text-ink-3 hover:text-ink-2 hover:border-[#332f2b]"
      }`}
    >
      <span
        className={`w-[13px] h-[13px] rounded-xs border flex items-center justify-center ${
          checked ? "bg-accent border-accent" : "border-line-soft bg-transparent"
        }`}
      >
        {checked && (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 5.2l2 2 4-4.4"
              stroke="#ffffff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}

export function Switch({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-[34px] h-[19px] rounded-full border transition-colors duration-150 ${
        checked ? "bg-accent border-accent" : "bg-base border-line"
      }`}
    >
      <span
        className={`absolute top-[2px] w-[13px] h-[13px] rounded-full transition-all duration-150 ${
          checked ? "left-[18px] bg-white" : "left-[2px] bg-ink-3"
        }`}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "sm",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: "xs" | "sm";
}) {
  return (
    <div className={`inline-flex items-center bg-base border border-line rounded-sm p-[2px] ${size === "xs" ? "h-6" : "h-7"}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2 h-full rounded-xs transition-colors duration-100 ${size === "xs" ? "text-caption" : "text-body"} ${
            value === o.value ? "bg-raised text-ink elev-1" : "text-ink-3 hover:text-ink-2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Modal                                                                     */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 720,
  center = false,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  /** Vertically centre the dialog instead of anchoring it near the top. */
  center?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center p-4 sm:p-8 overflow-y-auto ${center ? "items-center" : "items-start"}`}
      role="dialog"
      aria-modal="true"
    >
      {/* Blurring the page behind the dialog does more for focus than dimming it further, and it
          keeps the black from flattening into one undifferentiated sheet. */}
      {/* The scrim fades on its own timing, a touch faster than the panel. Animating them as one
          makes the dialog look like it is sliding out of the backdrop rather than onto it. */}
      <div className="fixed inset-0 bg-black/70 backdrop-blur-[3px] anim-overlay" onClick={onClose} />
      <div
        className="relative bg-surface border border-line rounded-md elev-3 w-full anim-scale flex flex-col max-h-[calc(100vh-4rem)]"
        style={{ maxWidth: width }}
      >
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line-soft shrink-0">
          <div className="min-w-0">
            <h2 className="text-title font-semibold tracking-[-0.012em] truncate">{title}</h2>
            {subtitle && <p className="text-caption text-ink-3 mt-1 leading-relaxed">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink hover:bg-hover rounded-sm -mt-1 -mr-1.5 p-1.5 transition-colors shrink-0"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-5 grow">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-line-soft shrink-0">{footer}</footer>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width={420}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-ui text-ink-2 leading-relaxed">{body}</p>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty state                                                               */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  title,
  body,
  action,
  compact,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-10" : "py-20"}`}>
      {/* Dimmer than the text it sits above. An empty state's job is to explain, and an icon that
          out-weighs the sentence beneath it turns the explanation into a caption. */}
      <div className="w-9 h-9 mb-4 rounded-md border border-line-soft flex items-center justify-center">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path d="M2 12l3.5-4 3 3L14 4" stroke="var(--color-ink-4)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="text-title font-medium tracking-[-0.012em]">{title}</h3>
      <p className="text-body text-ink-3 mt-1.5 max-w-[46ch] leading-relaxed">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tooltip-ish popover for filters / menus                                   */
/* -------------------------------------------------------------------------- */

export function Popover({
  trigger,
  children,
  align = "left",
  width = 260,
  side = "bottom",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  width?: number;
  /** Open upwards when the trigger sits near the bottom of the window. */
  side?: "bottom" | "top";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={`absolute z-40 bg-raised border border-line rounded-md elev-2 anim-rise ${
            align === "right" ? "right-0" : "left-0"
          } ${side === "top" ? "bottom-full mb-1" : "mt-1"}`}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Toasts                                                                    */
/* -------------------------------------------------------------------------- */

type Toast = { id: number; message: string; tone: "info" | "error" | "success" };
const ToastCtx = React.createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => React.useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = React.useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`anim-rise pointer-events-auto bg-raised border rounded-sm elev-2 px-3.5 py-2.5 text-body max-w-[380px] ${
              t.tone === "error" ? "border-neg/50 text-neg" : t.tone === "success" ? "border-pos/40 text-pos" : "border-line text-ink"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Misc                                                                      */
/* -------------------------------------------------------------------------- */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-ink-3 text-body">
      <svg width="13" height="13" viewBox="0 0 16 16" className="animate-spin">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" fill="none" />
        <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
      {label}
    </div>
  );
}

/**
 * A placeholder in the shape of what is coming.
 *
 * Better than a spinner in a panel: the layout does not jump when the data lands, because the
 * space was already the right size. Deliberately low-contrast and slow — a shimmer that catches
 * the eye is competing with content that is about to replace it.
 */
export function Skeleton({ className = "", rows = 1 }: { className?: string; rows?: number }) {
  return (
    <div className="grid gap-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`h-3 rounded-xs bg-[var(--color-line-soft)] animate-pulse ${className}`}
          // Staggered, so a block of rows reads as one surface loading rather than several
          // unrelated things flashing in time.
          style={{ animationDelay: `${i * 90}ms`, animationDuration: "1.8s" }}
        />
      ))}
    </div>
  );
}

export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "pos" | "neg" | "accent" }) {
  const tones = {
    neutral: "border-line text-ink-3",
    pos: "border-pos/35 text-pos bg-pos/8",
    neg: "border-neg/35 text-neg bg-neg/8",
    accent: "border-accent/40 text-accent bg-accent/8",
  } as const;
  return <span className={`inline-flex items-center h-[19px] px-1.5 rounded-xs border text-caption ${tones[tone]}`}>{children}</span>;
}
