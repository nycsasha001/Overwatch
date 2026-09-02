"use client";

import React, { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Popover, Select } from "./ui";
import { DRAWING_LABEL, TIMEFRAME_ORDER, type Anchor, type Drawing, type DrawingKind, type DrawingStyle, type MagnetMode } from "@/lib/drawings";
import { etDateTime, etToUtc } from "@/lib/session";

export interface DrawingTemplate {
  name: string;
  style: Record<string, unknown>;
}

/**
 * The tool icons, drawn the way a charting package draws them.
 *
 * Each one is a picture of what the tool leaves on the chart rather than a generic glyph: the
 * levels it sets, and a dot wherever there is a handle you can drag. That is why the position
 * tools show three lines and a letter instead of an arrow — an arrow says "up", but the tool sets
 * a target, an entry and a stop, and the icon may as well say so.
 */
const TOOLS: { kind: DrawingKind; icon: React.ReactNode }[] = [
  {
    kind: "trendline",
    icon: (
      <svg width="23" height="23" viewBox="0 0 16 16" fill="none">
        <path d="M4 12l8-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="4" cy="12" r="1.35" fill="currentColor" />
        <circle cx="12" cy="4" r="1.35" fill="currentColor" />
      </svg>
    ),
  },
  {
    kind: "ray",
    icon: (
      <svg width="23" height="23" viewBox="0 0 16 16" fill="none">
        <path d="M4 8h9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="3.6" cy="8" r="1.45" fill="currentColor" />
      </svg>
    ),
  },
  {
    kind: "rect",
    icon: (
      <svg width="23" height="23" viewBox="0 0 16 16" fill="none">
        <rect x="3.2" y="3.8" width="9.6" height="8.4" stroke="currentColor" strokeWidth="1.15" />
        {/* A handle at each corner, which is where the drag points actually are. */}
        <circle cx="3.2" cy="3.8" r="1.25" fill="currentColor" />
        <circle cx="12.8" cy="3.8" r="1.25" fill="currentColor" />
        <circle cx="3.2" cy="12.2" r="1.25" fill="currentColor" />
        <circle cx="12.8" cy="12.2" r="1.25" fill="currentColor" />
      </svg>
    ),
  },
  {
    kind: "gann",
    icon: (
      // Two bounds and the midpoint between them, dashed — which is the whole tool.
      <svg width="23" height="23" viewBox="0 0 16 16" fill="none">
        <path d="M2.5 3.5h11M2.5 12.5h11" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
        <path d="M2.5 8h11" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeDasharray="2.2 2" opacity="0.8" />
      </svg>
    ),
  },
  {
    kind: "long",
    icon: (
      <svg width="23" height="23" viewBox="0 0 16 16" fill="none">
        <path d="M6.6 3h6.9M6.6 8h6.9M6.6 13h6.9" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
        <circle cx="13.3" cy="3" r="1.05" fill="currentColor" />
        <circle cx="13.3" cy="13" r="1.05" fill="currentColor" />
        <text x="1.4" y="10.4" fontSize="7.5" fontWeight="600" fill="currentColor" fontFamily="inherit">
          L
        </text>
      </svg>
    ),
  },
  {
    kind: "short",
    icon: (
      <svg width="23" height="23" viewBox="0 0 16 16" fill="none">
        <path d="M6.6 3h6.9M6.6 8h6.9M6.6 13h6.9" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
        <circle cx="13.3" cy="3" r="1.05" fill="currentColor" />
        <circle cx="13.3" cy="13" r="1.05" fill="currentColor" />
        <text x="1.4" y="10.4" fontSize="7.5" fontWeight="600" fill="currentColor" fontFamily="inherit">
          S
        </text>
      </svg>
    ),
  },
];

// The drawing palette is the chart's, not the interface's: a grey ramp plus the two colours
// position drawings use. It stays monochrome so markup never competes with price.
const SWATCHES = ["#ffffff", "#d1d4dc", "#9598a1", "#787b86", "#5d606b", "#3a4049", "#35b37e", "#e2555a"];

/** Vertical tool strip, with the template menu for each tool. */
export function DrawingToolbar({
  tool,
  onTool,
  templates,
  activeTemplate,
  onTemplate,
  hasDrawings,
  onClearAll,
  measuring,
  onMeasure,
  magnet,
  onMagnet,
}: {
  tool: DrawingKind | null;
  onTool: (t: DrawingKind | null) => void;
  templates: Record<string, DrawingTemplate[]>;
  activeTemplate: Record<string, string>;
  onTemplate: (kind: DrawingKind, name: string) => void;
  hasDrawings: boolean;
  onClearAll: () => void;
  measuring: boolean;
  onMeasure: () => void;
  magnet: MagnetMode;
  onMagnet: (m: MagnetMode) => void;
}) {
  return (
    <div className="w-[56px] shrink-0 border-r border-line bg-surface flex flex-col items-center py-2 gap-1">
      <button
        onClick={() => onTool(null)}
        title="Cursor — select and move drawings"
        className={`w-[42px] h-[42px] rounded-sm flex items-center justify-center transition-colors ${
          tool === null ? "bg-hover text-ink" : "text-ink-2 hover:text-ink hover:bg-hover/60"
        }`}
      >
        <svg width="23" height="23" viewBox="0 0 14 14" fill="none">
          <path d="M3 2l8 5.5-3.4.6L9 11.5 7.6 12 6 8.6 3.4 10.7z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      </button>

      <hr className="rule w-5 my-0.5" />

      {TOOLS.map((t) => {
        const list = templates[t.kind] ?? [];
        return (
          <div key={t.kind} className="relative">
            <button
              onClick={() => onTool(tool === t.kind ? null : t.kind)}
              onContextMenu={(e) => e.preventDefault()}
              title={`${DRAWING_LABEL[t.kind]}${list.length ? ` · ${activeTemplate[t.kind] ?? "default"}` : ""}`}
              className={`w-[42px] h-[42px] rounded-sm flex items-center justify-center transition-colors ${
                tool === t.kind ? "bg-accent/15 text-accent" : "text-ink-2 hover:text-ink hover:bg-hover/60"
              }`}
            >
              {t.icon}
            </button>
            {list.length > 0 && (
              <Popover
                width={200}
                trigger={({ toggle }) => (
                  <button
                    onClick={toggle}
                    title="Templates"
                    className="absolute -right-[1px] bottom-[2px] w-[10px] h-[10px] text-ink-3 hover:text-ink"
                  >
                    <svg width="7" height="7" viewBox="0 0 8 8">
                      <path d="M0 8L8 8L8 0z" fill="currentColor" />
                    </svg>
                  </button>
                )}
              >
                {(close) => (
                  <div className="py-1">
                    <div className="px-3 py-1 text-[10px] uppercase tracking-[0.06em] text-ink-3">{DRAWING_LABEL[t.kind]}</div>
                    <button
                      onClick={() => {
                        onTemplate(t.kind, "");
                        close();
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-hover ${!activeTemplate[t.kind] ? "text-ink" : "text-ink-2"}`}
                    >
                      Default
                    </button>
                    {list.map((tpl) => (
                      <button
                        key={tpl.name}
                        onClick={() => {
                          onTemplate(t.kind, tpl.name);
                          close();
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-hover flex items-center gap-2 ${
                          activeTemplate[t.kind] === tpl.name ? "text-ink" : "text-ink-2"
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ background: String(tpl.style.color ?? "#d1d4dc") }}
                        />
                        {tpl.name}
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            )}
          </div>
        );
      })}

      <hr className="rule w-7 my-0.5" />

      <div className="relative">
        <button
          onClick={() => onMagnet(magnet === "off" ? "weak" : "off")}
          title={
            magnet === "off"
              ? "Magnet off — click the arrow for weak or strong"
              : magnet === "weak"
              ? "Weak magnet: snaps when close to a wick or body"
              : "Strong magnet: always snaps to the nearest wick or body"
          }
          className={`w-[42px] h-[42px] rounded-sm flex items-center justify-center transition-colors ${
            magnet !== "off" ? "bg-accent/15 text-accent" : "text-ink-3 hover:text-ink hover:bg-hover/60"
          }`}
        >
          <svg width="23" height="23" viewBox="0 0 16 16" fill="none">
            <path d="M4 12V7a4 4 0 018 0v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M4 12h3M9 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M4 9.2h3M9 9.2h3" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
          </svg>
        </button>
        {magnet === "strong" && (
          <span className="absolute top-[3px] right-[3px] text-[8px] font-medium text-accent pointer-events-none">S</span>
        )}
        <Popover
          width={230}
          trigger={({ toggle }) => (
            <button onClick={toggle} title="Magnet mode" className="absolute -right-[1px] bottom-[2px] w-[10px] h-[10px] text-ink-3 hover:text-ink">
              <svg width="7" height="7" viewBox="0 0 8 8">
                <path d="M0 8L8 8L8 0z" fill="currentColor" />
              </svg>
            </button>
          )}
        >
          {(close) => (
            <div className="py-1">
              {([
                ["off", "Magnet off", "Draw freely"],
                ["weak", "Weak magnet", "Snaps only when near a wick or body"],
                ["strong", "Strong magnet", "Always snaps to the nearest level"],
              ] as [MagnetMode, string, string][]).map(([mode, label, hint]) => (
                <button
                  key={mode}
                  onClick={() => {
                    onMagnet(mode);
                    close();
                  }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-hover ${magnet === mode ? "text-ink" : "text-ink-2"}`}
                >
                  <div className="text-[12.5px]">{label}</div>
                  <div className="text-[11px] text-ink-3">{hint}</div>
                </button>
              ))}
            </div>
          )}
        </Popover>
      </div>

      <button
        onClick={onMeasure}
        title="Ruler — drag across the chart to measure"
        className={`w-[42px] h-[42px] rounded-sm flex items-center justify-center transition-colors ${
          measuring ? "bg-accent/15 text-accent" : "text-ink-3 hover:text-ink hover:bg-hover/60"
        }`}
      >
        <svg width="23" height="23" viewBox="0 0 16 16" fill="none">
          <path d="M2 10l8-8 4 4-8 8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M5 7l1.4 1.4M7 5l1.4 1.4M8.6 8.6L10 10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      </button>

      {hasDrawings && (
        <>
          <hr className="rule w-6 my-0.5" />
          <button
            onClick={onClearAll}
            title="Remove every drawing on this symbol"
            className="w-[40px] h-[40px] rounded-sm flex items-center justify-center text-ink-3 hover:text-neg hover:bg-hover/60"
          >
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <path d="M3 4h8M5.5 4V2.8h3V4M4.2 4l.5 7.2h4.6L9.8 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Full settings dialog — double-click a drawing, or press Settings           */
/* -------------------------------------------------------------------------- */

/** One swatch, one job: click it, pick a colour. TradingView's own dialogs never show a row of
 *  presets next to it — a single box standing for "this row's colour" is the whole idiom. */
function ColorField({ label, value, onChange, allowNone }: { label: string; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12.5px] text-ink-2">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value ?? "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-[26px] h-[22px] bg-transparent border border-line rounded-xs cursor-pointer"
          style={{ opacity: value ? 1 : 0.35 }}
          title={value ?? "No colour"}
        />
        {allowNone && (
          <button onClick={() => onChange(null)} className="text-[11px] text-ink-3 hover:text-ink px-1" title="No colour">
            none
          </button>
        )}
      </div>
    </div>
  );
}

/** A labelled checkbox — the position settings' own convention, next to the rest's toggle switches. */
function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 py-1.5 text-[12.5px] text-ink-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-[15px] h-[15px] accent-[var(--color-accent)] cursor-pointer"
      />
      {label}
    </label>
  );
}

/** The "Line" row every drawing settles on: one swatch showing colour + dash style, opening a
 *  popover with the actual colour, thickness and style controls — a single row standing in for
 *  what used to be three. */
interface LineControls {
  color: string;
  width: number;
  dash: 0 | 1 | 2;
  onColor: (v: string | null) => void;
  onWidth: (v: number) => void;
  onDash: (v: 0 | 1 | 2) => void;
}

/** Just the swatch button + popover, for rows that need to sit alongside other controls. */
function LineSwatchTrigger({ color, width, dash, onColor, onWidth, onDash }: LineControls) {
  return (
    <Popover
      align="right"
      width={220}
      trigger={({ toggle }) => (
        <button onClick={toggle} className="flex items-center gap-1.5 border border-line rounded-xs px-1.5 h-[26px]" title="Line colour, thickness and style">
          <span className="w-[15px] h-[15px] rounded-xs" style={{ background: color }} />
          <span className="w-[18px] border-t" style={{ borderTopColor: color, borderTopStyle: dash === 1 ? "dotted" : dash === 2 ? "dashed" : "solid", borderTopWidth: 2 }} />
        </button>
      )}
    >
      {() => (
        <div className="p-2.5 grid gap-1">
          <ColorField label="Colour" value={color} onChange={onColor} />
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-[12.5px] text-ink-2">Thickness</span>
            <Select className="w-[104px]" value={width} onChange={(e) => onWidth(Number(e.target.value))}>
              <option value={0}>None</option>
              {[1, 2, 3, 4].map((w) => (
                <option key={w} value={w}>
                  {w} px
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-[12.5px] text-ink-2">Style</span>
            <Select className="w-[104px]" value={dash} onChange={(e) => onDash(Number(e.target.value) as 0 | 1 | 2)}>
              <option value={0}>Solid</option>
              <option value={1}>Dotted</option>
              <option value={2}>Dashed</option>
            </Select>
          </div>
        </div>
      )}
    </Popover>
  );
}

/** The full "Line" row: label + swatch trigger. Used wherever nothing else shares the row. */
function LineSwatch({ label = "Line", ...controls }: LineControls & { label?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12.5px] text-ink-2">{label}</span>
      <LineSwatchTrigger {...controls} />
    </div>
  );
}

/** A start/end endpoint marker toggle for trend lines — none, or an arrowhead. */
function CapButton({ label, cap, onToggle }: { label: string; cap: "none" | "arrow"; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={`${label} point: ${cap === "arrow" ? "arrow" : "none"}`}
      className={`w-[26px] h-[26px] flex items-center justify-center border rounded-xs ${cap === "arrow" ? "border-accent text-accent" : "border-line text-ink-3"}`}
    >
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <path d="M2 12L12 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        {cap === "arrow" && <path d="M12 2L7.5 3.2M12 2l-1.2 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </button>
  );
}

const STATS_FIELD_OPTIONS: { value: "offset" | "pct" | "ticks"; label: string }[] = [
  { value: "offset", label: "Price offset" },
  { value: "pct", label: "Percent" },
  { value: "ticks", label: "Ticks" },
];
// Mirrors DEFAULT_STYLE.statsFields — the toolbar shows a drawing's *effective* choice even when
// it predates this field and has none stored yet, matching what drawing-layer.tsx renders.
const DEFAULT_STATS_FIELDS: DrawingStyle["statsFields"] = ["pct", "ticks"];

export type SettingsTab = "style" | "text" | "coordinates" | "visibility";

export function DrawingSettingsDialog({
  drawing,
  open,
  tab = "style",
  onTab,
  onClose,
  onChange,
  onDelete,
  templates,
  onSaveTemplate,
  onDeleteTemplate,
  onResetDefaults,
  onAnchors,
  timeframes,
}: {
  drawing: Drawing | null;
  open: boolean;
  tab?: SettingsTab;
  onTab?: (t: SettingsTab) => void;
  onClose: () => void;
  onChange: (style: DrawingStyle) => void;
  onDelete: () => void;
  templates: DrawingTemplate[];
  onSaveTemplate: (name: string, style: DrawingStyle) => void;
  onDeleteTemplate: (name: string) => void;
  onResetDefaults: () => void;
  onAnchors?: (patch: { a?: Anchor; b?: Anchor; c?: Anchor }) => void;
  timeframes?: string[];
}) {
  const [name, setName] = useState("");
  const [savingAs, setSavingAs] = useState(false);
  const [active, setActive] = useState<SettingsTab>(tab);
  useEffect(() => setActive(tab), [tab, open]);
  // The position tools have no "Text" tab of their own — it folds into Style — so a tab
  // preference left over from another drawing must not strand the dialog on a hidden panel.
  const isPositionKind = drawing?.kind === "long" || drawing?.kind === "short";
  useEffect(() => {
    if (isPositionKind && active === "text") setActive("style");
  }, [isPositionKind, active]);
  if (!drawing) return null;
  const s = drawing.style;
  const set = (patch: Partial<DrawingStyle>) => onChange({ ...s, ...patch });
  const isBox = drawing.kind === "rect" || drawing.kind === "gann";
  const isPosition = drawing.kind === "long" || drawing.kind === "short";

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={470}
      center
      title={
        <span className="inline-flex items-center gap-1.5">
          {DRAWING_LABEL[drawing.kind]}
          <button
            onClick={() => {
              const next = window.prompt("Label", s.label);
              if (next !== null) set({ label: next });
            }}
            className="text-ink-3 hover:text-ink p-0.5"
            title="Rename"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M3 11l-.5 2.5L5 13l6.5-6.5-2-2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
            </svg>
          </button>
        </span>
      }
      footer={
        <>
          <Popover
            trigger={({ toggle }) => (
              <button onClick={toggle} className="flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink">
                Template
                <span className="text-ink-3">▾</span>
              </button>
            )}
          >
            {(close) =>
              savingAs ? (
                <div className="p-2.5 grid gap-1.5">
                  <Input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name this style"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || !name.trim()) return;
                      onSaveTemplate(name.trim(), s);
                      setName("");
                      setSavingAs(false);
                      close();
                    }}
                  />
                  <div className="flex gap-1.5 justify-end">
                    <Button onClick={() => setSavingAs(false)}>Back</Button>
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (!name.trim()) return;
                        onSaveTemplate(name.trim(), s);
                        setName("");
                        setSavingAs(false);
                        close();
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-1 grid">
                  <button onClick={() => setSavingAs(true)} className="text-left px-2 py-1.5 text-[12.5px] text-ink-2 hover:bg-hover rounded-xs">
                    Save as…
                  </button>
                  <button
                    onClick={() => {
                      onResetDefaults();
                      close();
                    }}
                    className="text-left px-2 py-1.5 text-[12.5px] text-ink-2 hover:bg-hover rounded-xs"
                  >
                    Apply defaults
                  </button>
                  {templates.length > 0 && (
                    <>
                      <div className="border-t border-line-soft my-1" />
                      {templates.map((t) => (
                        <div key={t.name} className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-hover rounded-xs group">
                          <button
                            onClick={() => {
                              onChange({ ...s, ...(t.style as Partial<DrawingStyle>) });
                              close();
                            }}
                            className="flex items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink grow text-left"
                          >
                            <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ background: String(t.style.color ?? "#ffffff") }} />
                            {t.name}
                          </button>
                          <button onClick={() => onDeleteTemplate(t.name)} className="text-[11px] text-ink-3 hover:text-neg opacity-0 group-hover:opacity-100">
                            remove
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )
            }
          </Popover>
          <div className="grow" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onClose}>
            Ok
          </Button>
        </>
      }
    >
      {/*
        * Style, Text, Coordinates, Visibility — one panel each.
        *
        * These were briefly merged into two, which made "simpler" mean "the same fields, harder to
        * find". Four narrow panels beat two crowded ones: every tab here is one question, and the
        * one you want is the one you clicked.
        *
        * The position tools follow the platform's own Long/Short dialog instead: three tabs
        * (Inputs, Style, Visibility — "Text" folds into Style), and a narrower set of rows.
        */}
      <div className="flex items-center gap-1 border-b border-line-soft -mt-1 mb-3">
        {(isPosition ? (["coordinates", "style", "visibility"] as SettingsTab[]) : (["style", "text", "coordinates", "visibility"] as SettingsTab[])).map((t) => (
          <button
            key={t}
            onClick={() => {
              setActive(t);
              onTab?.(t);
            }}
            className={`px-3 h-8 text-[12.5px] border-b-2 -mb-px transition-colors ${
              active === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
            } ${isPosition ? "" : "capitalize"}`}
          >
            {isPosition ? (t === "coordinates" ? "Inputs" : t === "style" ? "Style" : "Visibility") : t}
          </button>
        ))}
      </div>

      {isPosition && (
        <div className={`grid gap-1 ${active === "style" ? "" : "hidden"}`}>
          <LineSwatch
            label="Lines"
            color={s.color}
            width={s.width}
            dash={s.dash}
            onColor={(v) => set({ color: v ?? "#ffffff" })}
            onWidth={(v) => set({ width: v })}
            onDash={(v) => set({ dash: v })}
          />
          <ColorField label="Stop color" value={s.stopColor} onChange={(v) => set({ stopColor: v ?? "#787b86" })} />
          <ColorField label="Target color" value={s.targetColor} onChange={(v) => set({ targetColor: v ?? "#ffffff" })} />
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-[12.5px] text-ink-2">Text</span>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={s.labelColor ?? "#000000"}
                onChange={(e) => set({ labelColor: e.target.value })}
                className="w-[26px] h-[22px] bg-transparent border border-line rounded-xs cursor-pointer"
                title="Text colour"
              />
              <Select className="w-[72px]" value={s.labelSize} onChange={(e) => set({ labelSize: Number(e.target.value) })}>
                {[9, 10, 12, 14, 16].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Checkbox label="Price labels" checked={s.showPrices} onChange={(v) => set({ showPrices: v })} />

          <div className="label mt-3">Info</div>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-[12.5px] text-ink-2">Stats</span>
            <Popover
              align="right"
              width={180}
              trigger={({ toggle }) => (
                <button onClick={toggle} className="flex items-center justify-between gap-2 border border-line rounded-xs px-2 h-[26px] w-[150px] text-[12px] text-ink-2 truncate">
                  <span className="truncate">
                    {STATS_FIELD_OPTIONS.filter((o) => (s.statsFields ?? DEFAULT_STATS_FIELDS).includes(o.value)).map((o) => o.label).join(", ") || "None"}
                  </span>
                  <span className="text-ink-3">▾</span>
                </button>
              )}
            >
              {() => (
                <div className="p-2 grid gap-0.5">
                  {STATS_FIELD_OPTIONS.map((o) => {
                    const fields = s.statsFields ?? DEFAULT_STATS_FIELDS;
                    const checked = fields.includes(o.value);
                    return (
                      <Checkbox
                        key={o.value}
                        label={o.label}
                        checked={checked}
                        onChange={(v) => set({ statsFields: v ? [...fields, o.value] : fields.filter((f) => f !== o.value) })}
                      />
                    );
                  })}
                </div>
              )}
            </Popover>
          </div>
          <Checkbox label="Compact stats mode" checked={s.compactStats ?? false} onChange={(v) => set({ compactStats: v })} />
          <Checkbox label="Always show stats" checked={s.alwaysShowStats ?? true} onChange={(v) => set({ alwaysShowStats: v })} />
        </div>
      )}

      {!isPosition && (
        <div className={`grid gap-1 ${active === "style" ? "" : "hidden"}`}>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-[12.5px] text-ink-2">Line</span>
            <div className="flex items-center gap-1.5">
              <LineSwatchTrigger color={s.color} width={s.width} dash={s.dash} onColor={(v) => set({ color: v ?? "#ffffff" })} onWidth={(v) => set({ width: v })} onDash={(v) => set({ dash: v })} />
              {drawing.kind === "trendline" && (
                <>
                  <CapButton label="Start" cap={s.capA} onToggle={() => set({ capA: s.capA === "arrow" ? "none" : "arrow" })} />
                  <CapButton label="End" cap={s.capB} onToggle={() => set({ capB: s.capB === "arrow" ? "none" : "arrow" })} />
                </>
              )}
            </div>
          </div>

          {drawing.kind === "trendline" && (
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[12.5px] text-ink-2">Extend</span>
              <Select
                className="w-[140px]"
                value={s.extendLeft && s.extendRight ? "both" : s.extendLeft ? "left" : s.extendRight ? "right" : "none"}
                onChange={(e) => {
                  const v = e.target.value;
                  set({ extendLeft: v === "left" || v === "both", extendRight: v === "right" || v === "both" });
                }}
              >
                <option value="none">Don&apos;t extend</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="both">Both</option>
              </Select>
            </div>
          )}
          {drawing.kind === "trendline" && <Checkbox label="Middle point" checked={s.midpoint ?? false} onChange={(v) => set({ midpoint: v })} />}

          {isBox && (
            <>
              <div className="label mt-2">Background</div>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-[12.5px] text-ink-2">Fill</span>
                <Popover
                  align="right"
                  width={220}
                  trigger={({ toggle }) => (
                    <button onClick={toggle} className="w-[26px] h-[22px] rounded-xs border border-line" style={{ background: s.fillColor ?? "transparent" }} title="Background colour and opacity" />
                  )}
                >
                  {() => (
                    <div className="p-2.5 grid gap-1">
                      <ColorField label="Colour" value={s.fillColor} onChange={(v) => set({ fillColor: v })} allowNone />
                      <div className="flex items-center justify-between gap-3 py-1.5">
                        <span className="text-[12.5px] text-ink-2">Opacity</span>
                        <div className="flex items-center gap-2">
                          <input type="range" min={0} max={100} value={s.fillOpacity} onChange={(e) => set({ fillOpacity: Number(e.target.value) })} className="w-[120px] accent-[var(--color-accent)]" />
                          <span className="text-[12px] text-ink-3 tnum w-[34px] text-right">{s.fillOpacity}%</span>
                        </div>
                      </div>
                    </div>
                  )}
                </Popover>
              </div>
              {drawing.kind === "rect" && <Checkbox label="Dashed midline" checked={s.midline} onChange={(v) => set({ midline: v })} />}
            </>
          )}

          <Checkbox label="Price labels" checked={s.showPrices} onChange={(v) => set({ showPrices: v })} />

          {drawing.kind === "trendline" && (
            <>
              <div className="label mt-3">Info</div>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-[12.5px] text-ink-2">Stats</span>
                <Select className="w-[124px]" value={s.lineStats ? "shown" : "hidden"} onChange={(e) => set({ lineStats: e.target.value === "shown" })}>
                  <option value="hidden">Hidden</option>
                  <option value="shown">Shown</option>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-[12.5px] text-ink-2">Stats position</span>
                <Select className="w-[124px]" value={s.statsPosition ?? "right"} onChange={(e) => set({ statsPosition: e.target.value as DrawingStyle["statsPosition"] })} disabled={!s.lineStats}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </Select>
              </div>
              <Checkbox label="Always show stats" checked={s.alwaysShowStats ?? false} onChange={(v) => set({ alwaysShowStats: v })} />
            </>
          )}
        </div>
      )}

      <div className={`grid gap-1 ${active === "text" ? "" : "hidden"}`}>
        <Field label="Label">
          <Input value={s.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. 4H FVG" />
        </Field>
        <div className="flex items-center justify-between gap-3 py-1.5">
          <span className="text-[12.5px] text-ink-2">Text</span>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={s.labelColor ?? "#000000"}
              onChange={(e) => set({ labelColor: e.target.value })}
              className="w-[26px] h-[22px] bg-transparent border border-line rounded-xs cursor-pointer"
              style={{ opacity: s.labelColor ? 1 : 0.35 }}
              title="Text colour"
            />
            <Select className="w-[72px]" value={s.labelSize} onChange={(e) => set({ labelSize: Number(e.target.value) })}>
              {[9, 10, 12, 14, 16].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <Checkbox label="Bold" checked={s.labelBold} onChange={(v) => set({ labelBold: v })} />
        {isBox && (
          <>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[12.5px] text-ink-2">Vertical</span>
              <Select className="w-[124px]" value={s.labelAlign} onChange={(e) => set({ labelAlign: e.target.value as DrawingStyle["labelAlign"] })}>
                <option value="top">Above</option>
                <option value="inside">Inside</option>
                <option value="bottom">Below</option>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[12.5px] text-ink-2">Horizontal</span>
              <Select
                className="w-[124px]"
                value={s.labelHAlign ?? (s.labelAlign === "inside" ? "middle" : "left")}
                onChange={(e) => set({ labelHAlign: e.target.value as DrawingStyle["labelHAlign"] })}
              >
                <option value="left">Left</option>
                <option value="middle">Middle</option>
                <option value="right">Right</option>
              </Select>
            </div>
          </>
        )}
      </div>

      <div className={`grid gap-3 ${active === "coordinates" ? "" : "hidden"}`}>
        {onAnchors && (
          <>
            {([
              ["a", isPosition ? "Entry" : "Point 1"],
              ["b", isPosition ? "Stop" : "Point 2"],
              ...(drawing.c ? ([["c", "Target"]] as [string, string][]) : []),
            ] as [string, string][]).map(([key, label]) => {
              const anchor = (drawing as unknown as Record<string, Anchor>)[key];
              if (!anchor) return null;
              const { date, time } = etDateTime(anchor.t);
              return (
                <div key={key} className="grid grid-cols-3 gap-2 items-end">
                  <Field label={`${label} price`}>
                    <Input
                      value={anchor.price}
                      inputMode="decimal"
                      onChange={(e) => onAnchors({ [key]: { ...anchor, price: Number(e.target.value) || 0 } } as never)}
                    />
                  </Field>
                  <Field label="Date (ET)">
                    <Input
                      type="date"
                      value={date}
                      onChange={(e) => {
                        const [y, m, d] = e.target.value.split("-").map(Number);
                        const [hh, mm] = time.split(":").map(Number);
                        if (y) onAnchors({ [key]: { ...anchor, t: etToUtc(y, m, d, hh, mm) } } as never);
                      }}
                    />
                  </Field>
                  <Field label="Time (ET)">
                    <Input
                      type="time"
                      value={time}
                      onChange={(e) => {
                        const [hh, mm] = e.target.value.split(":").map(Number);
                        const [y, m, d] = date.split("-").map(Number);
                        if (Number.isFinite(hh)) onAnchors({ [key]: { ...anchor, t: etToUtc(y, m, d, hh, mm) } } as never);
                      }}
                    />
                  </Field>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className={`grid gap-3 ${active === "visibility" ? "" : "hidden"}`}>
        <p className="text-[12.5px] text-ink-3 leading-relaxed">
          Hide this drawing outside a range of timeframes — an intraday level does not need to clutter the daily.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From timeframe">
            <Select value={s.visibleFrom ?? ""} onChange={(e) => set({ visibleFrom: e.target.value || null })}>
              <option value="">Any</option>
              {(timeframes ?? TIMEFRAME_ORDER).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To timeframe">
            <Select value={s.visibleTo ?? ""} onChange={(e) => set({ visibleTo: e.target.value || null })}>
              <option value="">Any</option>
              {(timeframes ?? TIMEFRAME_ORDER).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

    </Modal>
  );
}

/** Centred templates dialog, shared by the style bar. */
export function DrawingTemplatesDialog({
  open,
  onClose,
  kind,
  style,
  templates,
  onApply,
  onSave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  kind: DrawingKind;
  style: DrawingStyle;
  templates: DrawingTemplate[];
  onApply: (style: Record<string, unknown>) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [name, setName] = useState("");

  return (
    <Modal
      open={open}
      onClose={onClose}
      center
      width={420}
      title={`${DRAWING_LABEL[kind]} templates`}
      subtitle="Save a look once, reuse it for every drawing of the same confluence"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label="Save the current style as">
          <div className="flex gap-1.5">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FVG, Order block, Breaker"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  onSave(name.trim());
                  setName("");
                }
              }}
              autoFocus
            />
            <Button
              variant="primary"
              onClick={() => {
                if (!name.trim()) return;
                onSave(name.trim());
                setName("");
              }}
            >
              Save
            </Button>
          </div>
        </Field>

        <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
          <span className="w-3 h-3 rounded-xs border border-line" style={{ background: style.color }} />
          Current: {style.width}px {style.dash === 0 ? "solid" : style.dash === 1 ? "dotted" : "dashed"}
          {style.fillColor ? ` · fill ${style.fillOpacity}%` : ""}
        </div>

        {templates.length === 0 ? (
          <p className="text-[12.5px] text-ink-3 border-t border-line-soft pt-3">
            No templates yet for this tool. Style a drawing the way you want a confluence to look, then save it here —
            every new one comes out the same.
          </p>
        ) : (
          <div className="grid gap-1 border-t border-line-soft pt-2">
            {templates.map((t) => (
              <div key={t.name} className="flex items-center justify-between gap-2 py-1.5 border-b border-line-soft last:border-0">
                <button
                  onClick={() => {
                    onApply(t.style);
                    onClose();
                  }}
                  className="flex items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink"
                >
                  <span className="w-3 h-3 rounded-xs border border-line" style={{ background: String(t.style.color ?? "#ffffff") }} />
                  {t.name}
                </button>
                <button onClick={() => onDelete(t.name)} className="text-[11px] text-ink-3 hover:text-neg">
                  remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Floating bar shown while a drawing is selected                            */
/* -------------------------------------------------------------------------- */

const DASHES: { v: 0 | 1 | 2; label: string; pattern: string }[] = [
  { v: 0, label: "Solid", pattern: "" },
  { v: 1, label: "Dotted", pattern: "2 3" },
  { v: 2, label: "Dashed", pattern: "6 4" },
];

function BarButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick?: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`h-[26px] min-w-[26px] px-1.5 rounded-sm flex items-center justify-center gap-1 transition-colors ${
        active ? "bg-hover text-ink" : "text-ink-2 hover:text-ink hover:bg-hover/70"
      }`}
    >
      {children}
    </button>
  );
}

function SwatchMenu({ value, onPick, close }: { value: string | null; onPick: (c: string | null) => void; close: () => void }) {
  return (
    <div className="p-2">
      <div className="grid grid-cols-4 gap-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => {
              onPick(c);
              close();
            }}
            className={`h-[22px] rounded-xs border ${value === c ? "border-ink" : "border-line"}`}
            style={{ background: c }}
            title={c}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-line-soft">
        <input
          type="color"
          value={value ?? "#ffffff"}
          onChange={(e) => onPick(e.target.value)}
          className="w-[28px] h-[22px] bg-transparent border border-line rounded-xs cursor-pointer"
          title="Custom colour"
        />
        <button onClick={() => { onPick(null); close(); }} className="text-[11.5px] text-ink-3 hover:text-ink">
          None
        </button>
      </div>
    </div>
  );
}

export function FloatingDrawingBar({
  drawing,
  onChange,
  onToggleLock,
  onDuplicate,
  onDelete,
  onOpenSettings,
  templates,
  onApplyTemplate,
}: {
  drawing: Drawing;
  onChange: (style: DrawingStyle) => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenSettings: (tab?: "style" | "text" | "coordinates" | "visibility") => void;
  templates: DrawingTemplate[];
  onApplyTemplate: (style: Record<string, unknown>) => void;
}) {
  const s = drawing.style;
  const set = (patch: Partial<DrawingStyle>) => onChange({ ...s, ...patch });
  const isBox = drawing.kind === "rect" || drawing.kind === "gann" || drawing.kind === "long" || drawing.kind === "short";

  return (
    <div className="inline-flex items-center gap-0.5 bg-raised border border-line rounded-md px-1.5 py-1 shadow-xl shadow-black/50">
      <span className="px-1 text-ink-3 select-none" title={DRAWING_LABEL[drawing.kind]}>
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" opacity="0.55">
          <circle cx="2" cy="3" r="1" /><circle cx="6" cy="3" r="1" />
          <circle cx="2" cy="7" r="1" /><circle cx="6" cy="7" r="1" />
          <circle cx="2" cy="11" r="1" /><circle cx="6" cy="11" r="1" />
        </svg>
      </span>

      <Popover
        width={160}
        trigger={({ toggle }) => (
          <BarButton onClick={toggle} title="Templates">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
              <rect x="9" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
              <rect x="2" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M11.5 9.5v5M9 12h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </BarButton>
        )}
      >
        {(close) => (
          <div className="py-1">
            {templates.length === 0 && <p className="px-3 py-2 text-[11.5px] text-ink-3">No templates for this tool yet.</p>}
            {templates.map((t) => (
              <button
                key={t.name}
                onClick={() => {
                  onApplyTemplate(t.style);
                  close();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
              >
                <span className="w-2.5 h-2.5 rounded-xs" style={{ background: String(t.style.color ?? "#ffffff") }} />
                {t.name}
              </button>
            ))}
            <div className="h-px bg-line-soft my-1" />
            <button onClick={() => { onOpenSettings("style"); close(); }} className="w-full text-left px-3 py-1.5 text-[12px] text-ink-3 hover:bg-hover hover:text-ink">
              Save current style…
            </button>
          </div>
        )}
      </Popover>

      <BarButton onClick={() => onOpenSettings("text")} title="Text" active={!!s.label}>
        <div className="flex flex-col items-center gap-[2px]">
          <span className="text-[13px] leading-none font-medium">T</span>
          <span className="w-[14px] h-[2px] rounded-full" style={{ background: s.labelColor ?? s.color }} />
        </div>
      </BarButton>

      <Popover
        width={176}
        trigger={({ toggle }) => (
          <BarButton onClick={toggle} title="Line colour">
            <div className="flex flex-col items-center gap-[2px]">
              <svg width="15" height="13" viewBox="0 0 16 14" fill="none">
                <path d="M6.4 1.6l5.4 5.4a1 1 0 010 1.4l-3.6 3.6a1.4 1.4 0 01-2 0L2.8 8.2a1 1 0 010-1.4l3.6-3.6" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
                <path d="M13.4 9.4c0 .9.6 1.6 1.3 1.6" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
              </svg>
              <span className="w-[14px] h-[2px] rounded-full" style={{ background: s.color }} />
            </div>
          </BarButton>
        )}
      >
        {(close) => <SwatchMenu value={s.color} onPick={(c) => set({ color: c ?? "#ffffff" })} close={close} />}
      </Popover>

      {isBox && (
        <Popover
          width={176}
          trigger={({ toggle }) => (
            <BarButton onClick={toggle} title="Fill colour">
              <div className="flex flex-col items-center gap-[2px]">
                <svg width="15" height="13" viewBox="0 0 16 14" fill="none">
                  <path d="M6.4 1.6l5.4 5.4a1 1 0 010 1.4l-3.6 3.6a1.4 1.4 0 01-2 0L2.8 8.2a1 1 0 010-1.4l3.6-3.6" fill="currentColor" fillOpacity="0.35" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
                  <path d="M13.4 9.4c0 .9.6 1.6 1.3 1.6" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
                </svg>
                <span className="w-[14px] h-[2px] rounded-full" style={{ background: s.fillColor ?? "transparent", outline: s.fillColor ? "none" : "1px dashed #6c737f" }} />
              </div>
            </BarButton>
          )}
        >
          {(close) => <SwatchMenu value={s.fillColor} onPick={(c) => set({ fillColor: c })} close={close} />}
        </Popover>
      )}

      <div className="w-px h-4 bg-line-soft mx-0.5" />

      <Popover
        width={130}
        trigger={({ toggle }) => (
          <BarButton onClick={toggle} title="Thickness">
            <span className="text-[11.5px] tnum">{s.width}px</span>
          </BarButton>
        )}
      >
        {(close) => (
          <div className="py-1">
            {[1, 2, 3, 4].map((w) => (
              <button
                key={w}
                onClick={() => { set({ width: w }); close(); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-hover ${w === s.width ? "text-ink" : "text-ink-2"}`}
              >
                <span className="w-6 bg-current rounded-full" style={{ height: w }} />
                {w}px
              </button>
            ))}
          </div>
        )}
      </Popover>

      <Popover
        width={140}
        trigger={({ toggle }) => (
          <BarButton onClick={toggle} title="Line style">
            <svg width="18" height="10" viewBox="0 0 20 10">
              <line x1="1" y1="5" x2="19" y2="5" stroke="currentColor" strokeWidth="1.6" strokeDasharray={DASHES[s.dash].pattern || undefined} />
            </svg>
          </BarButton>
        )}
      >
        {(close) => (
          <div className="py-1">
            {DASHES.map((d) => (
              <button
                key={d.v}
                onClick={() => { set({ dash: d.v }); close(); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-hover ${d.v === s.dash ? "text-ink" : "text-ink-2"}`}
              >
                <svg width="26" height="8" viewBox="0 0 26 8">
                  <line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" strokeWidth="1.6" strokeDasharray={d.pattern || undefined} />
                </svg>
                {d.label}
              </button>
            ))}
          </div>
        )}
      </Popover>

      <BarButton onClick={() => onOpenSettings("visibility")} title="Visibility on timeframes">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </BarButton>

      <BarButton onClick={() => onOpenSettings("coordinates")} title="Coordinates">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="8" r="4.6" stroke="currentColor" strokeWidth="1.2" />
          <path d="M7 5.6V8l1.6 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M12.5 3v4M10.5 5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </BarButton>

      <BarButton onClick={onToggleLock} title={drawing.locked ? "Unlock" : "Lock"} active={drawing.locked}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <rect x="3.5" y="7" width="9" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
          <path d={drawing.locked ? "M5.5 7V5a2.5 2.5 0 015 0v2" : "M5.5 7V5a2.5 2.5 0 014.9-.6"} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </BarButton>

      <BarButton onClick={onDelete} title="Delete">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="hover:text-neg">
          <path d="M3.5 4.5h9M6 4.5V3.2h4v1.3M4.8 4.5l.6 8h5.2l.6-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </BarButton>

      <Popover
        width={170}
        align="right"
        trigger={({ toggle }) => (
          <BarButton onClick={toggle} title="More">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="4" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12" cy="8" r="1.2" />
            </svg>
          </BarButton>
        )}
      >
        {(close) => (
          <div className="py-1">
            <button onClick={() => { onOpenSettings("style"); close(); }} className="w-full text-left px-3 py-1.5 text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink">
              Settings…
            </button>
            <button onClick={() => { onDuplicate(); close(); }} className="w-full text-left px-3 py-1.5 text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink">
              Duplicate
            </button>
            <div className="h-px bg-line-soft my-1" />
            <button onClick={() => { onDelete(); close(); }} className="w-full text-left px-3 py-1.5 text-[12.5px] text-neg hover:bg-hover">
              Delete
            </button>
          </div>
        )}
      </Popover>
    </div>
  );
}
