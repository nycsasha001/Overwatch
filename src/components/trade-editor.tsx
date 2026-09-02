"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./app-context";
import { Button, ConfirmDialog, Field, Input, Modal, Select, Textarea, Toggle, useToast } from "./ui";
import { api } from "@/lib/client";
import { RESULT_CODES, RESULT_LABEL, ResultCode, Screenshot, ScreenshotPhase, Trade } from "@/lib/types";
import { deriveR } from "@/lib/stats";
import { isoDate, money, num } from "@/lib/format";

interface EditorValue {
  open: (trade: Trade | null, defaults?: Partial<FormState>) => void;
}
const Ctx = createContext<EditorValue>({ open: () => {} });
export const useTradeEditor = () => useContext(Ctx);

interface FormState {
  date: string;
  time: string;
  instrument: string;
  direction: "long" | "short";
  session: string;
  strategy: string;
  setup: string;
  entry: string;
  stop: string;
  target: string;
  exit: string;
  size: string;
  riskAmount: string;
  riskPct: string;
  result: ResultCode;
  pnl: string;
  rMultiple: string;
  plannedRr: string;
  mae: string;
  mfe: string;
  fees: string;
  htfSweep: boolean;
  sweep4h: boolean;
  sweep1h: boolean;
  sweep15m: boolean;
  sessionSweep: boolean;
  mss: boolean;
  fvg: boolean;
  orderBlock: boolean;
  displacement: boolean;
  pdArray: string;
  entryModel: string;
  liquidityTarget: string;
  tags: string;
  thesis: string;
  execution: string;
  review: string;
  mistakes: string;
  emotions: string;
}

const blank = (defaults: Partial<FormState> = {}): FormState => ({
  date: isoDate(new Date()),
  time: "",
  instrument: "",
  direction: "long",
  session: "",
  strategy: "",
  setup: "",
  entry: "",
  stop: "",
  target: "",
  exit: "",
  size: "",
  riskAmount: "",
  riskPct: "",
  result: "win",
  pnl: "",
  rMultiple: "",
  plannedRr: "",
  mae: "",
  mfe: "",
  fees: "",
  htfSweep: false,
  sweep4h: false,
  sweep1h: false,
  sweep15m: false,
  sessionSweep: false,
  mss: false,
  fvg: false,
  orderBlock: false,
  displacement: false,
  pdArray: "",
  entryModel: "",
  liquidityTarget: "",
  tags: "",
  thesis: "",
  execution: "",
  review: "",
  mistakes: "",
  emotions: "",
  ...defaults,
});

const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

const fromTrade = (t: Trade): FormState => ({
  date: t.date,
  time: t.time ?? "",
  instrument: t.instrument,
  direction: t.direction,
  session: t.session ?? "",
  strategy: t.strategy ?? "",
  setup: t.setup ?? "",
  entry: s(t.entry),
  stop: s(t.stop),
  target: s(t.target),
  exit: s(t.exit),
  size: s(t.size),
  riskAmount: s(t.riskAmount),
  riskPct: s(t.riskPct),
  result: t.result,
  pnl: s(t.pnl),
  rMultiple: s(t.rMultiple),
  plannedRr: s(t.plannedRr),
  mae: s(t.mae),
  mfe: s(t.mfe),
  fees: s(t.fees),
  htfSweep: !!t.htfSweep,
  sweep4h: !!t.sweep4h,
  sweep1h: !!t.sweep1h,
  sweep15m: !!t.sweep15m,
  sessionSweep: !!t.sessionSweep,
  mss: !!t.mss,
  fvg: !!t.fvg,
  orderBlock: !!t.orderBlock,
  displacement: !!t.displacement,
  pdArray: t.pdArray ?? "",
  entryModel: t.entryModel ?? "",
  liquidityTarget: t.liquidityTarget ?? "",
  tags: t.tags.join(", "),
  thesis: t.thesis ?? "",
  execution: t.execution ?? "",
  review: t.review ?? "",
  mistakes: t.mistakes ?? "",
  emotions: t.emotions ?? "",
});

function Section({
  title,
  hint,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-line rounded-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 h-9 text-left hover:bg-hover/50 transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className={`text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}>
          <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[12.5px] font-medium">{title}</span>
        {hint && <span className="text-[11.5px] text-ink-3">{hint}</span>}
        <span className="ml-auto">{badge}</span>
      </button>
      {open && <div className="px-3 pb-3.5 pt-1 border-t border-line-soft">{children}</div>}
    </div>
  );
}

export function TradeEditorProvider({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [form, setForm] = useState<FormState>(blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<Screenshot[]>([]);
  const [pending, setPending] = useState<{ phase: ScreenshotPhase; file: File }[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  const openEditor = useCallback(
    (trade: Trade | null, defaults: Partial<FormState> = {}) => {
      setError(null);
      setPending([]);
      if (trade) {
        setEditing(trade);
        setForm(fromTrade(trade));
        setShots(trade.screenshots ?? []);
      } else {
        setEditing(null);
        setShots([]);
        setForm(
          blank({
            instrument: app.settings.defaultInstrument,
            session: app.settings.defaultSession,
            riskPct: app.account?.defaultRiskPct != null ? String(app.account.defaultRiskPct) : String(app.settings.defaultRiskPct),
            ...defaults,
          })
        );
      }
      setOpen(true);
    },
    [app.settings, app.account]
  );

  const value = useMemo(() => ({ open: openEditor }), [openEditor]);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  /* Derived values shown live to the trader */
  const nOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
  const derivedR = deriveR(nOrNull(form.entry), nOrNull(form.stop), nOrNull(form.exit), form.direction);
  const balanceForRisk = (app.account?.startingBalance ?? 0) + app.trades.reduce((sum, t) => sum + t.pnl, 0);
  const derivedRisk =
    form.riskPct.trim() !== "" && balanceForRisk > 0 ? (Number(form.riskPct) / 100) * balanceForRisk : null;
  const effectiveRisk = form.riskAmount.trim() !== "" ? Number(form.riskAmount) : derivedRisk;
  // Planned reward-to-risk, from the levels as they were set at entry.
  const derivedPlannedRr = (() => {
    const entry = Number(form.entry), stop = Number(form.stop), target = Number(form.target);
    if (![entry, stop, target].every(Number.isFinite)) return null;
    const risk = Math.abs(entry - stop);
    return risk > 0 ? Number((Math.abs(target - entry) / risk).toFixed(2)) : null;
  })();
  const effectiveR = form.rMultiple.trim() !== "" ? Number(form.rMultiple) : derivedR;
  const derivedPnl = effectiveR !== null && effectiveRisk !== null ? effectiveR * effectiveRisk : null;

  const save = async (closeAfter = true) => {
    setError(null);
    if (!app.accounts.length) return;
    const accountId = app.accountId === "all" ? app.accounts[0].id : app.accountId;
    if (!form.instrument.trim()) return setError("Instrument is required.");
    if (!form.date) return setError("Date is required.");

    const payload: Record<string, unknown> = {
      accountId,
      date: form.date,
      time: form.time || null,
      instrument: form.instrument.trim().toUpperCase(),
      direction: form.direction,
      session: form.session || null,
      strategy: form.strategy || null,
      setup: form.setup || null,
      entry: nOrNull(form.entry),
      stop: nOrNull(form.stop),
      target: nOrNull(form.target),
      exit: nOrNull(form.exit),
      size: nOrNull(form.size),
      riskAmount: form.riskAmount.trim() !== "" ? Number(form.riskAmount) : derivedRisk,
      riskPct: nOrNull(form.riskPct),
      result: form.result,
      pnl: form.pnl.trim() !== "" ? Number(form.pnl) : derivedPnl ?? 0,
      rMultiple: form.rMultiple.trim() !== "" ? Number(form.rMultiple) : derivedR,
      plannedRr: form.plannedRr.trim() !== "" ? Number(form.plannedRr) : derivedPlannedRr,
      mae: nOrNull(form.mae),
      mfe: nOrNull(form.mfe),
      fees: nOrNull(form.fees),
      htfSweep: form.htfSweep,
      sweep4h: form.sweep4h,
      sweep1h: form.sweep1h,
      sweep15m: form.sweep15m,
      sessionSweep: form.sessionSweep,
      mss: form.mss,
      fvg: form.fvg,
      orderBlock: form.orderBlock,
      displacement: form.displacement,
      pdArray: form.pdArray || null,
      entryModel: form.entryModel || null,
      liquidityTarget: form.liquidityTarget || null,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      thesis: form.thesis || null,
      execution: form.execution || null,
      review: form.review || null,
      mistakes: form.mistakes || null,
      emotions: form.emotions || null,
    };

    setBusy(true);
    try {
      const saved = editing ? await api.updateTrade(editing.id, payload) : await api.createTrade(payload);
      if (pending.length) {
        for (const p of pending) {
          try {
            await api.uploadScreenshot(saved.id, p.phase, p.file);
          } catch (e) {
            toast(e instanceof Error ? e.message : "A screenshot failed to upload", "error");
          }
        }
        setPending([]);
      }
      await app.refresh();
      toast(editing ? "Trade updated" : "Trade saved", "success");
      if (closeAfter) setOpen(false);
      else {
        setEditing(null);
        setShots([]);
        setForm((f) => blank({ instrument: f.instrument, session: f.session, date: f.date, riskPct: f.riskPct, strategy: f.strategy }));
        firstField.current?.focus();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save the trade";
      setError(msg);
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      await api.deleteTrade(editing.id);
      await app.refresh();
      toast("Trade deleted");
      setConfirmDelete(false);
      setOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete the trade", "error");
    }
  };

  const duplicate = async () => {
    if (!editing) return;
    try {
      const copy = await api.duplicateTrade(editing.id);
      await app.refresh();
      toast("Trade duplicated");
      openEditor(copy);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not duplicate the trade", "error");
    }
  };

  const addFiles = async (phase: ScreenshotPhase, files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    if (editing) {
      for (const file of list) {
        try {
          const shot = await api.uploadScreenshot(editing.id, phase, file);
          setShots((s2) => [...s2, shot]);
        } catch (e) {
          toast(e instanceof Error ? e.message : "Upload failed", "error");
        }
      }
      await app.refresh();
    } else {
      setPending((p) => [...p, ...list.map((file) => ({ phase, file }))]);
    }
  };

  const removeShot = async (id: string) => {
    try {
      await api.deleteScreenshot(id);
      setShots((s2) => s2.filter((x) => x.id !== id));
      await app.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove the screenshot", "error");
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void save(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form, editing, pending]);

  const journalFilled = [form.thesis, form.execution, form.review, form.mistakes, form.emotions].filter(Boolean).length;
  const setupFlags = [form.htfSweep, form.sweep4h, form.sweep1h, form.sweep15m, form.sessionSweep, form.mss, form.fvg, form.orderBlock, form.displacement].filter(Boolean).length;
  const shotCount = shots.length + pending.length;

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={820}
        title={editing ? "Edit trade" : "New trade"}
        subtitle={
          app.accountId === "all"
            ? `Saved to ${app.accounts[0]?.name ?? "the first account"} — switch account to change`
            : app.account?.name
        }
        footer={
          <>
            {editing && (
              <>
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
                <Button onClick={duplicate}>Duplicate</Button>
              </>
            )}
            <div className="grow" />
            {!editing && (
              <Button onClick={() => save(false)} disabled={busy}>
                Save &amp; add another
              </Button>
            )}
            <Button variant="primary" onClick={() => save(true)} disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Save trade"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {error && <div className="border border-neg/40 bg-neg-dim/40 text-neg text-[12.5px] rounded-sm px-3 py-2">{error}</div>}

          {/* --- Core --- */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Date">
              <Input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
            </Field>
            <Field label="Time">
              <Input type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} />
            </Field>
            <Field label="Instrument">
              <Input
                ref={firstField}
                list="instrument-options"
                value={form.instrument}
                onChange={(e) => set({ instrument: e.target.value })}
                placeholder="MNQ"
                autoFocus
              />
              <datalist id="instrument-options">
                {app.settings.instruments.map((i) => (
                  <option key={i} value={i} />
                ))}
              </datalist>
            </Field>
            <Field label="Direction">
              <div className="flex gap-1">
                {(["long", "short"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set({ direction: d })}
                    className={`flex-1 h-[30px] rounded-sm border text-[12.5px] capitalize transition-colors ${
                      form.direction === d
                        ? d === "long"
                          ? "border-pos/60 bg-pos/10 text-pos"
                          : "border-neg/60 bg-neg/10 text-neg"
                        : "border-line text-ink-3 hover:text-ink-2"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Session">
              <Select value={form.session} onChange={(e) => set({ session: e.target.value })}>
                <option value="">—</option>
                {app.settings.sessions.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Strategy">
              <Input
                list="strategy-options"
                value={form.strategy}
                onChange={(e) => set({ strategy: e.target.value })}
                placeholder={app.strategies[0]?.name ?? "e.g. Silver bullet"}
              />
              <datalist id="strategy-options">
                {app.strategies.map((x) => (
                  <option key={x.id} value={x.name} />
                ))}
              </datalist>
            </Field>
            <Field label="Setup">
              <Input list="setup-options" value={form.setup} onChange={(e) => set({ setup: e.target.value })} placeholder="e.g. 4H Sweep" />
              <datalist id="setup-options">
                {app.setups.map((x) => (
                  <option key={x.id} value={x.name} />
                ))}
                {["4H Sweep", "1H Sweep", "15m Sweep", "Session Sweep"].map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </Field>
            <Field label="Position size">
              <Input value={form.size} onChange={(e) => set({ size: e.target.value })} inputMode="decimal" placeholder="2" />
            </Field>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Entry">
              <Input value={form.entry} onChange={(e) => set({ entry: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Stop loss">
              <Input value={form.stop} onChange={(e) => set({ stop: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Take profit">
              <Input value={form.target} onChange={(e) => set({ target: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Exit">
              <Input value={form.exit} onChange={(e) => set({ exit: e.target.value })} inputMode="decimal" />
            </Field>
          </div>

          <Field label="Result">
            <div className="flex flex-wrap gap-1">
              {RESULT_CODES.map((rc) => (
                <button
                  key={rc}
                  type="button"
                  onClick={() => set({ result: rc })}
                  className={`h-[28px] px-2.5 rounded-sm border text-[12px] transition-colors ${
                    form.result === rc
                      ? app.settings.classification[rc] === "win"
                        ? "border-pos/60 bg-pos/10 text-pos"
                        : app.settings.classification[rc] === "loss"
                        ? "border-neg/60 bg-neg/10 text-neg"
                        : "border-line bg-hover text-ink"
                      : "border-line text-ink-3 hover:text-ink-2"
                  }`}
                >
                  {RESULT_LABEL[rc]}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Risk %" hint={derivedRisk !== null ? `≈ ${money(derivedRisk, app.currency)}` : undefined}>
              <Input value={form.riskPct} onChange={(e) => set({ riskPct: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Risk $" hint={form.riskAmount.trim() === "" && derivedRisk !== null ? "From risk % of balance" : undefined}>
              <Input
                value={form.riskAmount}
                onChange={(e) => set({ riskAmount: e.target.value })}
                inputMode="decimal"
                placeholder={derivedRisk !== null ? num(derivedRisk, 0) : ""}
              />
            </Field>
            <Field label="R multiple" hint={form.rMultiple.trim() === "" && derivedR !== null ? "From entry / stop / exit" : undefined}>
              <Input
                value={form.rMultiple}
                onChange={(e) => set({ rMultiple: e.target.value })}
                inputMode="decimal"
                placeholder={derivedR !== null ? num(derivedR) : "e.g. 2.1"}
              />
            </Field>
            <Field
              label="Planned R:R"
              hint={
                form.plannedRr.trim() === "" && derivedPlannedRr !== null
                  ? "From entry / stop / target"
                  : "What you were aiming for"
              }
            >
              <Input
                value={form.plannedRr}
                onChange={(e) => set({ plannedRr: e.target.value })}
                inputMode="decimal"
                placeholder={derivedPlannedRr !== null ? num(derivedPlannedRr) : "e.g. 3"}
              />
            </Field>
            <Field label="P&L" hint={form.pnl.trim() === "" && derivedPnl !== null ? `From R × risk = ${money(derivedPnl, app.currency)}` : undefined}>
              <Input
                value={form.pnl}
                onChange={(e) => set({ pnl: e.target.value })}
                inputMode="decimal"
                placeholder={derivedPnl !== null ? num(derivedPnl, 2) : "0"}
              />
            </Field>
          </div>

          {/* --- Advanced setup --- */}
          <Section
            title="Setup context"
            hint="Sweeps, structure, PD arrays"
            badge={setupFlags ? <span className="text-[11px] text-ink-3 tnum">{setupFlags} selected</span> : undefined}
          >
            <div className="grid gap-3 pt-1">
              <div>
                <div className="label">Liquidity sweeps</div>
                <div className="flex flex-wrap gap-1.5">
                  <Toggle checked={form.htfSweep} onChange={(v) => set({ htfSweep: v })} label="HTF sweep" />
                  <Toggle checked={form.sweep4h} onChange={(v) => set({ sweep4h: v })} label="4H sweep" />
                  <Toggle checked={form.sweep1h} onChange={(v) => set({ sweep1h: v })} label="1H sweep" />
                  <Toggle checked={form.sweep15m} onChange={(v) => set({ sweep15m: v })} label="15m sweep" />
                  <Toggle checked={form.sessionSweep} onChange={(v) => set({ sessionSweep: v })} label="Session high/low" />
                </div>
              </div>
              <div>
                <div className="label">Confluence</div>
                <div className="flex flex-wrap gap-1.5">
                  <Toggle checked={form.mss} onChange={(v) => set({ mss: v })} label="Market structure shift" />
                  <Toggle checked={form.displacement} onChange={(v) => set({ displacement: v })} label="Displacement" />
                  <Toggle checked={form.fvg} onChange={(v) => set({ fvg: v })} label="FVG" />
                  <Toggle checked={form.orderBlock} onChange={(v) => set({ orderBlock: v })} label="Order block" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="PD array">
                  <Select value={form.pdArray} onChange={(e) => set({ pdArray: e.target.value })}>
                    <option value="">—</option>
                    {app.settings.pdArrays.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Entry model">
                  <Select value={form.entryModel} onChange={(e) => set({ entryModel: e.target.value })}>
                    <option value="">—</option>
                    {app.settings.entryModels.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Liquidity target">
                  <Select value={form.liquidityTarget} onChange={(e) => set({ liquidityTarget: e.target.value })}>
                    <option value="">—</option>
                    {app.settings.liquidityTargets.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="MAE (R)" hint="How far it went against you">
                  <Input value={form.mae} onChange={(e) => set({ mae: e.target.value })} inputMode="decimal" placeholder="0.6" />
                </Field>
                <Field label="MFE (R)" hint="Best unrealised move in your favour">
                  <Input value={form.mfe} onChange={(e) => set({ mfe: e.target.value })} inputMode="decimal" placeholder="3.2" />
                </Field>
                <Field label="Fees / commissions">
                  <Input value={form.fees} onChange={(e) => set({ fees: e.target.value })} inputMode="decimal" />
                </Field>
              </div>
              <Field label="Tags" hint="Comma separated">
                <Input value={form.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="A+ setup, news day" />
              </Field>
            </div>
          </Section>

          {/* --- Journal --- */}
          <Section
            title="Journal"
            hint="Thesis, execution, review"
            defaultOpen={journalFilled > 0}
            badge={journalFilled ? <span className="text-[11px] text-ink-3 tnum">{journalFilled}/5 written</span> : undefined}
          >
            <div className="grid gap-3 pt-1">
              <Field label="Pre-trade thesis" hint="Why did I take this trade?">
                <Textarea rows={3} value={form.thesis} onChange={(e) => set({ thesis: e.target.value })} />
              </Field>
              <Field label="Execution" hint="What happened during execution?">
                <Textarea rows={3} value={form.execution} onChange={(e) => set({ execution: e.target.value })} />
              </Field>
              <Field label="Post-trade review" hint="What did I learn?">
                <Textarea rows={3} value={form.review} onChange={(e) => set({ review: e.target.value })} />
              </Field>
              <Field label="Mistakes" hint="What did I do incorrectly?">
                <Textarea rows={2} value={form.mistakes} onChange={(e) => set({ mistakes: e.target.value })} />
              </Field>
              <Field label="Emotions" hint="How was my mindset?">
                <Textarea rows={2} value={form.emotions} onChange={(e) => set({ emotions: e.target.value })} />
              </Field>
            </div>
          </Section>

          {/* --- Screenshot --- */}
          <Section
            title="Screenshot"
            hint="The trade itself"
            badge={shotCount ? <span className="text-[11px] text-ink-3 tnum">{shotCount} attached</span> : undefined}
          >
            <div className="pt-1">
              <label className="border border-dashed border-line rounded-sm h-[70px] flex items-center justify-center text-[11.5px] text-ink-3 cursor-pointer hover:border-accent/50 hover:text-ink-2 transition-colors">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles("trade", e.target.files)}
                />
                Click to add an image
              </label>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {shots.map((x) => (
                  <div key={x.id} className="relative group border border-line rounded-sm overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/screenshots/file/${x.filename}`} alt="Trade screenshot" className="w-full h-[64px] object-cover" />
                    <button
                      type="button"
                      onClick={() => removeShot(x.id)}
                      className="absolute top-1 right-1 bg-black/70 border border-line rounded-xs px-1 text-[10px] text-ink-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {pending.map((p, i) => (
                  <div key={i} className="text-[11px] text-ink-3 truncate border border-line rounded-sm px-2 py-1">
                    {p.file.name} · uploads on save
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <p className="text-[11px] text-ink-3">
            Only date, instrument, direction and result are required. ⌘/Ctrl + Enter saves.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this trade?"
        body="The trade, its journal notes and any attached screenshots will be permanently removed from the database."
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </Ctx.Provider>
  );
}
