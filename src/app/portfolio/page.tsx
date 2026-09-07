"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Page, PageHeader } from "@/components/shell";
import { Button, EmptyState, Field, Input, Modal, Panel, Segmented, Select, Spinner, useToast } from "@/components/ui";
import { LineChart, type LinePoint } from "@/components/charts";
import { Stat, StatRow, KeyValue } from "@/components/stat";
import { SymbolPicker } from "@/components/symbol-picker";
import { money, num, pct, toneOf } from "@/lib/format";
import { api } from "@/lib/client";
import { agoLabel } from "@/lib/prices";
import {
  allocation,
  availableRanges,
  filterable,
  inRange,
  isManuallyValued,
  MANUAL_ASSET_TYPES,
  performanceSinceStart,
  snapshotValue,
  totalsOf,
  type Position,
  type Range,
} from "@/lib/portfolio";
import type { PortfolioState } from "@/lib/portfolio-server";
import type { Quote } from "@/lib/portfolio";
import type { AcquisitionType, HoldingAcquisition, PortfolioAssetType, PortfolioTransaction, WatchlistItem } from "@/lib/types";
import { lookup, type SymbolInfo } from "@/lib/symbols";
import { useUndo, undoShortcutLabel, type UndoEntry } from "@/lib/undo";
import { PortfolioLock } from "@/components/portfolio-lock";

/**
 * The investment side of the account: what it is all worth, what moved today, and how it has done
 * since you started.
 *
 * This is a mirror, not a broker. Positions are entered by hand and only prices come from outside,
 * so nothing here can place an order and there are no broker credentials to steal.
 *
 * Two rules run through every number on the page. A figure that cannot be determined shows as a
 * dash and is named, never as zero — a holding that failed to price is worth an unknown amount,
 * and rendering that as $0.00 would understate the portfolio silently. And the value chart draws
 * only what was actually recorded: it starts the day you start, and nothing before that is
 * invented or back-filled.
 */

const ASSET_LABEL: Record<PortfolioAssetType, string> = {
  stock: "Stock",
  etf: "ETF",
  crypto: "Crypto",
  other: "Other (ticker)",
  metal: "Precious metal",
  cash: "Cash / savings",
  property: "Property",
  collectible: "Collectible",
};

/**
 * What one unit is, per type, so the form can ask for "Ounces" rather than "Shares".
 *
 * Small, but it is the difference between a form that understands what you are entering and one
 * that makes you translate bullion into share language before it will accept it.
 */
const UNIT_LABEL: Partial<Record<PortfolioAssetType, {
  /** Field label for the quantity. */
  plural: string;
  /** Goes after "per" — "what you paid, per ounce". */
  singular: string;
  /** Appended to the number in the holdings table, where one column serves every type. */
  suffix?: string;
  hint: string;
}>> = {
  metal: { plural: "Ounces", singular: "ounce", suffix: "oz", hint: "Troy ounces — this is weight, not shares" },
  cash: { plural: "Amount", singular: "unit", hint: "The balance, in dollars" },
  property: { plural: "Units", singular: "unit", hint: "Usually 1 — the whole thing" },
  collectible: { plural: "Items", singular: "item", hint: "How many of them you have" },
};

/** "ounce" for bullion, "share" for a ticker — whatever one of this holding is called. */
function unitNoun(assetType: PortfolioAssetType): string {
  return UNIT_LABEL[assetType]?.singular ?? "share";
}

const ACQUISITION_LABEL: Record<HoldingAcquisition, string> = {
  purchase: "Purchased",
  gift: "Gift",
  other: "Other",
  mixed: "Mixed",
};

/**
 * Cash is a class in the filter even though it is not a holding.
 *
 * It has no asset type of its own — it lives on the portfolio, not in the table — so it needs a key
 * the filter can carry. Kept distinct from the `cash` asset type, which is a named account you
 * entered as a holding, because unticking one must not silently untick the other.
 */
const CASH_CLASS = "cash_balance";

/**
 * The quick answers, so the common cuts are one click rather than four.
 *
 * "Portfolio" is the market side of the ledger — everything with a live price, as opposed to the
 * things sitting in a safe. It includes "Other (ticker)" because that type is market-priced by
 * definition; a ticker missing from a view called Portfolio would be the surprising outcome.
 *
 * Each preset is narrowed to the classes actually held before it is offered, so one that could
 * only ever return nothing is never shown. There is deliberately no single-class preset here —
 * the per-class chips beside these already are that, and a preset duplicating one of them lights
 * two controls up for one selection.
 */
const FILTER_PRESETS: { label: string; types: PortfolioAssetType[] }[] = [
  { label: "Portfolio", types: ["stock", "etf", "crypto", "other"] },
  { label: "Stocks & funds", types: ["stock", "etf"] },
  { label: "Physical", types: ["metal", "property", "collectible"] },
];

/**
 * A toggle in a row of toggles.
 *
 * Its own control rather than a Segmented because the selection is a set, not a choice: "metals and
 * crypto" has to be as expressible as "metals". Segmented would force one at a time.
 */
function Chip({ active, subtle, onClick, children }: {
  active: boolean;
  subtle?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-7 px-2.5 rounded-sm border text-body font-medium transition-[background-color,border-color,color] active:translate-y-px ${
        active
          ? "bg-accent border-accent text-white"
          : subtle
            ? "bg-transparent border-line text-ink-3 hover:text-ink hover:border-[#332f2b]"
            : "bg-raised border-line text-ink hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

/** A ticker-shaped label, derived from what you called it, for the things that have no ticker. */
function labelFrom(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 15);
}

const signed = (v: number | null) => (v === null ? "—" : money(v, "USD", { sign: true }));
const signedPct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${pct(v, 2)}`);

function Delta({ value, valuePct }: { value: number | null; valuePct: number | null }) {
  if (value === null) return <span className="figure-none">—</span>;
  const tone = toneOf(value);
  const cls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink-3";
  return (
    <span className={`tnum ${cls}`}>
      {signed(value)}
      {valuePct !== null && <span className="text-ink-3 ml-1.5">({signedPct(valuePct)})</span>}
    </span>
  );
}

/* ------------------------------- add / edit ---------------------------------- */

interface HoldingForm {
  symbol: string;
  name: string;
  /** Either a share count or a dollar amount, depending on `mode`. */
  quantity: string;
  mode: "shares" | "amount";
  /** Cost per share, as your broker reports it. Blank means "use today's price". */
  avgCost: string;
  /** Current value per unit, for the asset types no feed quotes. */
  manualPrice: string;
  /** How it came to be yours. Drives whether "amount invested" is asked for at all. */
  acquisition: AcquisitionType;
  /** Cash actually parted with. Blank means "the whole basis", which is what buying something is. */
  amountInvested: string;
  /** YYYY-MM-DD. Blank means today. */
  acquiredAt: string;
  assetType: PortfolioAssetType;
}

const EMPTY_FORM: HoldingForm = {
  symbol: "", name: "", quantity: "", mode: "amount", avgCost: "", manualPrice: "",
  acquisition: "purchase", amountInvested: "", acquiredAt: "", assetType: "stock",
};

function HoldingDialog({ open, editing, seed, onClose, onSaved, onUndoable }: {
  open: boolean;
  editing: Position | null;
  /** Pre-selected symbol, used when converting a watchlist row into a holding. */
  seed?: { symbol: string; name: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
  onUndoable: (e: UndoEntry) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<HoldingForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setForm({
        symbol: editing.holding.symbol,
        name: editing.holding.name ?? "",
        quantity: String(editing.holding.shares),
        // Editing is always in shares: "set this position to $500" is ambiguous about whether the
        // cost basis is supposed to move with it.
        mode: "shares",
        // Not editable here — the average cost is derived from the transaction history, so it is
        // corrected by fixing a buy in the detail view rather than overtyped from this form.
        avgCost: "",
        manualPrice: editing.holding.manualPrice === null ? "" : String(editing.holding.manualPrice),
        // Acquisition belongs to the lots, not the position, so it is not editable from here — a
        // holding that is part bought and part gifted has no single answer. It is corrected by
        // fixing the transaction in the detail view.
        acquisition: "purchase",
        amountInvested: "",
        acquiredAt: "",
        assetType: editing.holding.assetType,
      });
    } else if (seed) {
      // Came from "bought" on the watchlist: the symbol is known, so start on the shares field.
      setForm({ ...EMPTY_FORM, symbol: seed.symbol, name: seed.name ?? "", assetType: lookup(seed.symbol)?.assetType ?? "stock" });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editing, seed]);

  const set = <K extends keyof HoldingForm>(k: K, v: HoldingForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const pick = (symbol: string, info: SymbolInfo | null) =>
    setForm((f) => ({ ...f, symbol, name: info?.name ?? (symbol ? f.name : ""), assetType: info?.assetType ?? f.assetType }));

  // Blank is fine — it means "use today's price". Anything else has to be a real, positive price,
  // and saying so here beats a round trip that comes back with a server error.
  const costTyped = form.avgCost.trim() !== "";
  const costValue = costTyped ? Number(form.avgCost) : null;
  const costInvalid = costTyped && (!Number.isFinite(costValue as number) || (costValue as number) <= 0);

  // Gold, cash, a house: nothing to look up, so the form asks for the value instead of previewing
  // one. The same predicate the server uses, so the two cannot disagree about which is which.
  const manual = isManuallyValued(form.assetType);
  const unit = UNIT_LABEL[form.assetType];
  const valueTyped = form.manualPrice.trim() !== "";
  const valueNum = valueTyped ? Number(form.manualPrice) : null;
  const valueInvalid = manual && valueTyped && (!Number.isFinite(valueNum as number) || (valueNum as number) <= 0);
  // A manual holding with no value would sit in the table as a permanent dash, so it is required
  // rather than optional — unlike cost, which the feed can supply for a ticker.
  const valueMissing = manual && !editing && !valueTyped && !costTyped;

  // A gift is the case this whole distinction exists for: real basis, no cash. `other` keeps the
  // field open, because inherited and converted assets sit anywhere between the two.
  const gifted = form.acquisition === "gift";
  const investedTyped = form.amountInvested.trim() !== "";
  const investedNum = investedTyped ? Number(form.amountInvested) : null;
  const investedInvalid = investedTyped && (!Number.isFinite(investedNum as number) || (investedNum as number) < 0);
  // The feed quotes now, never a past day, so a back-dated gift has to bring its own basis.
  const today = new Date().toISOString().slice(0, 10);
  const backdated = form.acquiredAt !== "" && form.acquiredAt !== today;
  const basisMissing = !editing && !manual && form.acquisition !== "purchase" && backdated && !costTyped;


  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      // Cost is optional. Left blank, the server stamps what the symbol is trading at and records
      // it as a buy, so the day you enter it is the day you bought it at a price the market
      // actually quoted. Given, it is used verbatim — a position you have held for a year has a
      // cost basis that today's price knows nothing about, and typing it is the only way in.
      //
      // Blank is sent as *absent*, not as 0: zero is a legitimate cost the server would honour,
      // and an empty box does not mean "free".
      //
      // Amounts are sent as amounts. The server divides by whichever price it records, so the cost
      // basis lands on exactly the figure that was typed.
      const payload = {
        symbol: form.symbol,
        name: form.name || null,
        ...(form.mode === "amount" ? { amount: Number(form.quantity) } : { shares: Number(form.quantity) }),
        ...(form.avgCost.trim() ? { avgCost: Number(form.avgCost) } : {}),
        // Only meaningful for the hand-valued types, and the server ignores it for the rest.
        ...(manual && form.manualPrice.trim() ? { manualPrice: Number(form.manualPrice) } : {}),
        acquisition: form.acquisition,
        // Sent only when stated. Left out, the server applies what the acquisition type implies —
        // the full basis for a purchase, nothing for a gift — rather than freezing a guess.
        ...(investedTyped ? { amountInvested: Number(form.amountInvested) } : {}),
        ...(form.acquiredAt ? { acquiredAt: form.acquiredAt } : {}),
        assetType: form.assetType,
      };
      if (editing) {
        const { previous } = await api.updateHolding(editing.holding.id, payload);
        onUndoable({
          label: `Edited ${previous.symbol}`,
          run: async () => {
            await api.updateHolding(previous.id, { symbol: previous.symbol, name: previous.name, shares: previous.shares, avgCost: previous.avgCost, assetType: previous.assetType });
          },
        });
      } else {
        const created = await api.addHolding(payload);
        // Undo of an add is a delete — and the delete hands back the rows, so undoing the undo
        // (redo, effectively) still has everything it needs.
        onUndoable({
          label: `Added ${created.symbol}`,
          run: async () => {
            await api.deleteHolding(created.id);
          },
        });
      }
      toast(editing ? `${form.symbol} updated` : `${form.symbol} added`, "success");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the holding");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.holding.symbol}` : "Add a holding"}
      subtitle={
        editing
          ? "Correcting the share count. Cost stays as recorded."
          : manual
            ? "No feed quotes this, so the value is the one you give."
            : "Recorded at today\u2019s price, or at the cost you enter."
      }
      width={480}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={
              saving || !form.symbol || !form.quantity || costInvalid || valueInvalid || valueMissing ||
              investedInvalid || basisMissing
            }
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add holding"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        {/* Asked first, because it decides what the rest of the form is: a ticker search and a
            price preview, or a name and a value you supply. Asking it last would mean re-reading
            fields you had already filled in. */}
        <Field label="Type">
          <Select
            value={form.assetType}
            onChange={(e) => {
              const next = e.target.value as PortfolioAssetType;
              // Crossing between the two families invalidates the identifier: a ticker is not a
              // label for a safe full of coins, and vice versa. Clearing it is less confusing than
              // carrying "AAPL" over to a property.
              const crossed = isManuallyValued(next) !== isManuallyValued(form.assetType);
              setForm((f) => ({
                ...f,
                assetType: next,
                ...(crossed ? { symbol: "", name: "", manualPrice: "" } : {}),
                // Only tickers can be bought by dollar amount — the server divides by a price it
                // fetches, and there is nothing to fetch for gold.
                ...(isManuallyValued(next) ? { mode: "shares" as const } : {}),
              }));
            }}
          >
            <optgroup label="Priced from the market">
              {(["stock", "etf", "crypto", "other"] as PortfolioAssetType[]).map((t) => (
                <option key={t} value={t}>
                  {ASSET_LABEL[t]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Valued by you">
              {(MANUAL_ASSET_TYPES as readonly PortfolioAssetType[]).map((t) => (
                <option key={t} value={t}>
                  {ASSET_LABEL[t]}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>

        {manual ? (
          /* No ticker exists for this, so there is nothing to search. The name is the real field;
             the short label is what the table and the transaction history key on, derived from the
             name so you are not made to satisfy a ticker format by hand. */
          <>
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    name: e.target.value,
                    // Follows the name until you edit the label yourself, then stops.
                    symbol: f.symbol === labelFrom(f.name) || !f.symbol ? labelFrom(e.target.value) : f.symbol,
                  }))
                }
                placeholder={form.assetType === "metal" ? "Physical gold" : "Savings account"}
                autoFocus={!editing}
              />
            </Field>
            <Field label="Short label" hint="How it appears in the table and the allocation.">
              <Input
                value={form.symbol}
                onChange={(e) => set("symbol", labelFrom(e.target.value))}
                placeholder={form.assetType === "metal" ? "GOLD" : "SAVINGS"}
              />
            </Field>
          </>
        ) : (
          <Field label="Symbol">
            <SymbolPicker value={form.symbol} onChange={pick} autoFocus={!editing} />
          </Field>
        )}

        <Field
          label={manual ? (unit?.plural ?? "Quantity") : form.mode === "amount" ? "Amount to invest" : "Shares"}
          hint={
            manual
              ? unit?.hint
              : editing
                ? undefined
                : form.mode === "amount"
                  ? "Converted to shares at today\u2019s price"
                  : undefined
          }
        >
          <div className="flex items-center gap-2">
            <Input
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              inputMode="decimal"
              placeholder={form.mode === "amount" ? "500" : "10"}
              autoFocus={Boolean(seed)}
              className="flex-1"
            />
            {!editing && !manual && (
              <Segmented
                value={form.mode}
                options={[
                  { value: "amount", label: "$" },
                  { value: "shares", label: "Shares" },
                ]}
                onChange={(v) => set("mode", v as HoldingForm["mode"])}
                size="sm"
              />
            )}
          </div>
        </Field>

        {/* Optional, and blank is the common case: most positions are entered the day they are
            bought. It matters for the ones that are not — a holding you have had for a year has a
            cost basis today's price cannot supply, and without this box every return figure on the
            page would start life at zero. */}
        {/* Optional for a ticker, and blank is the common case: most positions are entered the day
            they are bought. It matters for the ones that are not — a holding you have had for a
            year has a cost basis today's price cannot supply, and without this box every return
            figure on the page would start life at zero. */}
        {!editing && (
          <Field
            label={
              gifted
                ? `Worth when received, per ${manual ? unitNoun(form.assetType) : "share"}`
                : manual
                  ? `What you paid, per ${unitNoun(form.assetType)}`
                  : "Average cost"
            }
            hint={
              gifted
                ? "The cost basis. Every gain is measured from this, even though it cost you nothing."
                : manual
                  ? "Leave blank to treat what it is worth now as the cost."
                  : "Per share. Leave blank to record at today’s price."
            }
          >
            <Input
              value={form.avgCost}
              onChange={(e) => set("avgCost", e.target.value)}
              inputMode="decimal"
              placeholder={manual ? "same as current value" : gifted ? "value on that date" : "today’s price"}
            />
          </Field>
        )}

        {costInvalid && <div className="text-caption text-neg">Average cost has to be a price above zero.</div>}

        {/* How it arrived, and what it actually cost you. Two questions the rest of the app used to
            answer with one number: a gift has a real basis every gain is measured from, and a cash
            cost of nothing. Collapsing them makes the portfolio claim you spent money you did not. */}
        {!editing && (
          <div className="grid gap-3.5 border-t border-line-soft pt-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="How you got it">
                <Select
                  value={form.acquisition}
                  onChange={(e) => {
                    const next = e.target.value as AcquisitionType;
                    setForm((f) => ({
                      ...f,
                      acquisition: next,
                      // A gift cost nothing, so the field is filled in rather than left for you to
                      // zero by hand. Going back to a purchase clears it, because the blank there
                      // means "all of it", not "none of it" — leaving the 0 behind would silently
                      // record a free purchase.
                      amountInvested: next === "gift" ? "0" : next === "purchase" ? "" : f.amountInvested,
                    }));
                  }}
                >
                  {(["purchase", "gift", "other"] as AcquisitionType[]).map((a) => (
                    <option key={a} value={a}>
                      {ACQUISITION_LABEL[a]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Date acquired" hint={form.acquiredAt ? undefined : "Today"}>
                <Input type="date" value={form.acquiredAt} onChange={(e) => set("acquiredAt", e.target.value)} max={today} />
              </Field>
            </div>

            <Field
              label="Amount invested"
              hint={
                gifted
                  ? "A gift cost you nothing. The basis above is still what gains are measured from."
                  : form.acquisition === "other"
                    ? "Cash you actually put in. Leave blank if it was the full cost above."
                    : "Total cash out of your pocket. Blank means the full cost above."
              }
            >
              <Input
                value={form.amountInvested}
                onChange={(e) => set("amountInvested", e.target.value)}
                inputMode="decimal"
                placeholder={gifted ? "0" : "the full cost"}
                // Not disabled: a gift can still have cash in it — you were given the coins but
                // paid the shipping, or split the cost with someone. The default is the common
                // case, not a rule.
              />
            </Field>
          </div>
        )}

        {investedInvalid && <div className="text-caption text-neg">Amount invested cannot be negative.</div>}
        {basisMissing && (
          <div className="text-caption text-neg leading-relaxed">
            Enter what {form.symbol || "it"} was worth on {form.acquiredAt} — the price feed only quotes today, so a
            past date cannot be looked up.
          </div>
        )}

        {/* The current value, for the things nothing will quote. Required rather than optional:
            without it the holding sits in the table as a permanent dash, and a portfolio total
            that silently omits your gold is worse than one that made you type a number. */}
        {manual && (
          <Field
            label={`Worth now, per ${unitNoun(form.assetType)}`}
            hint={
              form.assetType === "cash"
                ? "1.00 for a plain dollar balance."
                : "You set this, and update it whenever you want. Nothing changes it for you."
            }
          >
            <Input
              value={form.manualPrice}
              onChange={(e) => set("manualPrice", e.target.value)}
              inputMode="decimal"
              placeholder={form.assetType === "cash" ? "1.00" : "4400"}
            />
          </Field>
        )}

        {valueInvalid && <div className="text-caption text-neg">Current value has to be a number above zero.</div>}

        {/* What is about to be recorded, spelled out: the price, the share count it implies, and
            the resulting cost basis. A number you cannot see is a number you cannot check. */}
        {form.symbol && !editing && !manual && (
          <BuyPreview symbol={form.symbol} quantity={form.quantity} mode={form.mode} avgCost={costInvalid ? null : costValue} />
        )}

        {manual && !editing && !valueInvalid && Number(form.quantity) > 0 && (valueNum ?? costValue) && (
          <div className="text-caption text-ink-3 leading-relaxed bg-base border border-line rounded-sm px-2.5 py-2">
            Recording <span className="text-ink tnum">{num(Number(form.quantity), 4)}</span>{" "}
            {(unit?.plural ?? "units").toLowerCase()} worth{" "}
            <span className="text-ink tnum">{money(Number(form.quantity) * ((valueNum ?? costValue) as number))}</span> in
            total. No price feed touches this — it stays at what you set until you change it.
          </div>
        )}

        {!editing && (
          <div className="text-caption text-ink-3 leading-relaxed border-t border-line-soft pt-3">
            {manual
              ? "Reusing a label you already have adds to that holding rather than making a second one."
              : "Adding a symbol you already hold adds to that position and recalculates the average cost, the way a broker would."}
          </div>
        )}

        {error && <div className="text-body text-neg">{error}</div>}
      </div>
    </Modal>
  );
}


/**
 * What this add is about to record.
 *
 * The price going into your cost basis has to be visible before you commit — a number you cannot
 * see is a number you cannot check. It also surfaces a bad ticker here, at the point of entry,
 * rather than as a dash in the table afterwards.
 *
 * `avgCost` is the cost typed into the form, or null to use today's price. When it is given it
 * governs the arithmetic shown here, because it is what the server will record: an amount is
 * divided by the cost you entered, not by the live quote. Showing the live figure in that case
 * would be a preview of something that is not going to happen.
 */
function BuyPreview({ symbol, quantity, mode, avgCost }: {
  symbol: string;
  quantity: string;
  mode: "shares" | "amount";
  avgCost: number | null;
}) {
  const [state, setState] = useState<{ quote: Quote | null; pricingEnabled: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let live = true;
    setState(null);
    setFailed(false);
    api
      .quote(symbol)
      .then((r) => live && setState({ quote: r.quote, pricingEnabled: r.pricingEnabled }))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [symbol]);

  // A cost you typed needs no quote, so none of the price-feed failures below are reasons to stop.
  // Warning that live prices are off would be wrong here: the server will record your number and
  // never look at the feed.
  const manual = avgCost !== null && Number.isFinite(avgCost) && avgCost > 0;

  if (!manual) {
    if (failed) return <div className="text-caption text-neg">Could not reach the price feed.</div>;
    if (!state) return <div className="text-caption text-ink-3">Checking price…</div>;

    if (!state.pricingEnabled) {
      return (
        <div className="text-caption text-warn leading-relaxed">
          Live prices are off, so there is no price to record this at. Set FINNHUB_API_KEY and restart, or enter an
          average cost above.
        </div>
      );
    }
    if (!state.quote) {
      return <div className="text-caption text-warn">No price found for {symbol}. Check the ticker.</div>;
    }
  }

  const price = manual ? (avgCost as number) : state?.quote?.price;
  if (price === undefined || price === null) return null;
  const n = Number(quantity);
  const valid = Number.isFinite(n) && n > 0;

  // The conversion is shown rather than hidden, and the server does the same division against this
  // same price — so what is displayed here is what actually gets recorded.
  const shares = valid ? (mode === "amount" ? n / price : n) : null;
  const total = shares === null ? null : shares * price;

  return (
    <div className="text-caption text-ink-3 leading-relaxed bg-base border border-line rounded-sm px-2.5 py-2">
      Recording at <span className="text-ink tnum">{money(price)}</span> a share,{" "}
      {manual ? "the cost you entered" : "today’s price"}.
      {shares !== null && total !== null && (
        <>
          {" "}
          {mode === "amount" ? (
            <>
              That is <span className="text-ink tnum">{num(shares, 4)}</span> shares.
            </>
          ) : (
            <>
              Cost basis <span className="text-ink tnum">{money(total)}</span>.
            </>
          )}
          {/* The live price is still worth saying when a cost was typed: it is the difference
              between the two that becomes the position's return the moment it is added. */}
          {manual && state?.quote && (
            <>
              {" "}
              Trading at <span className="text-ink tnum">{money(state.quote.price)}</span> now.
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------- detail modal -------------------------------- */

function HoldingDetail({ position, onClose, onEdit, onRemove, onChanged, onUndoable, shortcut }: {
  position: Position;
  onClose: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onChanged: () => void;
  onUndoable: (e: UndoEntry) => void;
  shortcut: string;
}) {
  const toast = useToast();
  const p = position;
  const [txs, setTxs] = useState<PortfolioTransaction[] | null>(null);
  const [adding, setAdding] = useState(false);
  const manual = isManuallyValued(p.holding.assetType);
  const [value, setValue] = useState(p.holding.manualPrice === null ? "" : String(p.holding.manualPrice));
  const [revaluing, setRevaluing] = useState(false);
  const [tx, setTx] = useState({
    kind: "buy",
    qty: "",
    mode: "amount" as "shares" | "amount",
    price: "",
    acquisition: "purchase" as AcquisitionType,
    date: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    let live = true;
    api.listTransactions(p.holding.symbol).then((t) => live && setTxs(t)).catch(() => live && setTxs([]));
    return () => {
      live = false;
    };
  }, [p.holding.symbol]);

  /**
   * Mark a hand-valued holding to what it is worth today.
   *
   * Separate from editing the position because it is a different act: the share count and the cost
   * basis are history and should not move, while the valuation is a current opinion you will
   * revise repeatedly. Undo restores the previous figure, not the previous holding.
   */
  const revalue = async () => {
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0) {
      toast("Enter a value above zero", "error");
      return;
    }
    setRevaluing(true);
    try {
      const previous = p.holding.manualPrice;
      await api.updateHolding(p.holding.id, { manualPrice: next });
      onUndoable({
        label: `Revalued ${p.holding.symbol}`,
        run: async () => {
          await api.updateHolding(p.holding.id, { manualPrice: previous });
        },
      });
      toast(`${p.holding.symbol} valued at ${money(next)} per ${unitNoun(p.holding.assetType)}`, "success");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update the value", "error");
    } finally {
      setRevaluing(false);
    }
  };

  const addTx = async () => {
    try {
      const { transaction } = await api.addTransaction({
        symbol: p.holding.symbol,
        kind: tx.kind,
        ...(tx.mode === "amount" ? { amount: Number(tx.qty) } : { shares: Number(tx.qty) }),
        // Omitted rather than sent as 0 when blank, so the server knows to stamp today's price.
        ...(tx.price.trim() ? { price: Number(tx.price) } : {}),
        acquisition: tx.acquisition,
        date: tx.date,
      });
      onUndoable({
        label: `${tx.kind === "buy" ? "Bought" : "Sold"} ${tx.mode === "amount" ? money(Number(tx.qty)) + " of" : tx.qty} ${p.holding.symbol}`,
        run: async () => {
          await api.deleteTransaction(transaction.id);
        },
      });
      setTx({ kind: "buy", qty: "", mode: tx.mode, price: "", acquisition: "purchase", date: new Date().toISOString().slice(0, 10) });
      setAdding(false);
      setTxs(await api.listTransactions(p.holding.symbol));
      toast(tx.kind === "buy" ? "Buy recorded" : "Sale recorded", "success");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not record it", "error");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={p.holding.symbol}
      subtitle={p.holding.name ?? ASSET_LABEL[p.holding.assetType]}
      width={560}
      footer={
        <>
          {/* Destructive, but reversible — so it sits here plainly rather than behind a dialog. */}
          <Button variant="danger" onClick={onRemove} title={`Undo with ${shortcut}`}>
            Remove {p.holding.symbol}
          </Button>
          <span className="flex-1" />
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onEdit}>
            Edit holding
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <StatRow cols={4}>
          <Stat label="Market value" value={p.marketValue === null ? "—" : money(p.marketValue)} />
          <Stat label="Today" value={signed(p.dayChange)} tone={toneOf(p.dayChange)} sub={signedPct(p.dayChangePct)} />
          <Stat label="Total return" value={signed(p.unrealised)} tone={toneOf(p.unrealised)} sub={signedPct(p.unrealisedPct)} />
          <Stat
            label="Last price"
            value={p.quote ? money(p.quote.price) : "—"}
            sub={p.quote ? (p.quote.stale ? `${agoLabel(p.quote.fetchedAt)} · stale` : agoLabel(p.quote.fetchedAt)) : "no price"}
          />
        </StatRow>

        <div>
          <KeyValue
            label={manual ? (UNIT_LABEL[p.holding.assetType]?.plural ?? "Quantity") : "Shares"}
            value={num(p.holding.shares, p.holding.shares % 1 === 0 ? 0 : 4)}
          />
          {/* "Cost" is the wrong word for something you were given — the number is the basis, and
              calling it a cost is exactly the conflation this whole distinction exists to undo. */}
          <KeyValue
            label={
              p.holding.acquisition === "gift"
                ? `Worth when received, per ${unitNoun(p.holding.assetType)}`
                : manual
                  ? `Cost per ${unitNoun(p.holding.assetType)}`
                  : "Average cost"
            }
            value={money(p.holding.avgCost)}
          />
          <KeyValue label="Buys recorded" value={txs === null ? "\u2026" : txs.filter((x) => x.kind === "buy").length} />
          <KeyValue label="Cost basis" value={money(p.costBasis)} />
          {/* Shown only when it differs from the basis. On an ordinary purchase the two are the
              same number and a second row saying so is noise; on a gift the gap is the point. */}
          {p.invested !== p.costBasis && (
            <KeyValue
              label="Amount invested"
              value={
                <>
                  {money(p.invested)}
                  <span className="text-ink-4 ml-1.5 text-caption">
                    {p.invested === 0 ? "nothing out of pocket" : `${money(p.costBasis - p.invested)} of it a gift`}
                  </span>
                </>
              }
            />
          )}
          {p.holding.acquisition && p.holding.acquisition !== "purchase" && (
            <KeyValue label="How you got it" value={ACQUISITION_LABEL[p.holding.acquisition]} />
          )}
          {p.holding.acquiredAt && <KeyValue label="Acquired" value={p.holding.acquiredAt} />}
          <KeyValue label="Share of portfolio" value={p.weight === null ? "—" : pct(p.weight, 1)} />
        </div>

        {/* Nothing updates this on its own, so the control to update it lives on the screen where
            you would notice it is out of date — next to the age of the figure. */}
        {manual && (
          <div className="p-3 bg-base border border-line rounded-sm grid gap-2.5">
            <div className="flex items-end gap-2">
              <Field label={`Worth now, per ${unitNoun(p.holding.assetType)}`} className="flex-1">
                <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="4400" />
              </Field>
              <Button
                variant="primary"
                onClick={() => void revalue()}
                disabled={revaluing || value.trim() === "" || Number(value) === p.holding.manualPrice}
              >
                {revaluing ? "Saving…" : "Update"}
              </Button>
            </div>
            <div className="text-caption text-ink-3 leading-relaxed">
              {p.holding.manualPriceAt
                ? `You valued this ${agoLabel(Date.parse(p.holding.manualPriceAt))}. Nothing re-prices it for you — there is no feed for ${p.holding.symbol}.`
                : `No value recorded yet, so ${p.holding.symbol} is missing from the portfolio total.`}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="eyebrow">Transactions</span>
            <Button size="sm" onClick={() => setAdding((v) => !v)}>
              {adding ? "Cancel" : "Buy or sell"}
            </Button>
          </div>

          {adding && (
            <div className="mb-3 p-3 bg-base border border-line rounded-sm grid gap-2.5">
              <div className="grid grid-cols-[86px_1fr_1fr_1fr_auto] gap-2 items-end">
                <Field label="Side">
                  <Select value={tx.kind} onChange={(e) => setTx({ ...tx, kind: e.target.value })}>
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </Select>
                </Field>
                <Field label={tx.mode === "amount" ? "Amount" : manual ? (UNIT_LABEL[p.holding.assetType]?.plural ?? "Units") : "Shares"}>
                  <div className="flex items-center gap-1.5">
                    <Input value={tx.qty} onChange={(e) => setTx({ ...tx, qty: e.target.value })} inputMode="decimal" autoFocus className="flex-1" />
                    <Segmented
                      value={tx.mode}
                      options={[
                        { value: "amount", label: "$" },
                        { value: "shares", label: "sh" },
                      ]}
                      onChange={(v) => setTx({ ...tx, mode: v as "shares" | "amount" })}
                      size="xs"
                    />
                  </div>
                </Field>
                <Field label={manual ? "Price paid" : "Price"} hint={manual ? `Per ${unitNoun(p.holding.assetType)}` : "Blank = today"}>
                  <Input
                    value={tx.price}
                    onChange={(e) => setTx({ ...tx, price: e.target.value })}
                    inputMode="decimal"
                    placeholder="today\u2019s"
                  />
                </Field>
                <Field label="Date">
                  <Input type="date" value={tx.date} onChange={(e) => setTx({ ...tx, date: e.target.value })} />
                </Field>
                <Button variant="primary" onClick={addTx} disabled={!tx.qty}>
                  Add
                </Button>
              </div>

              {/* Per lot, not per holding: two ounces given to you and three you bought are the
                  same position but not the same acquisition, and only the lot knows which. */}
              {tx.kind === "buy" && (
                <Field
                  label="How you got it"
                  hint={
                    tx.acquisition === "gift"
                      ? "Recorded with a cost basis of the price above and nothing invested."
                      : undefined
                  }
                >
                  <Select
                    value={tx.acquisition}
                    onChange={(e) => setTx({ ...tx, acquisition: e.target.value as AcquisitionType })}
                  >
                    {(["purchase", "gift", "other"] as AcquisitionType[]).map((a) => (
                      <option key={a} value={a}>
                        {ACQUISITION_LABEL[a]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <div className="text-caption text-ink-3 leading-relaxed">
                {manual ? (
                  <>
                    Enter how many {(UNIT_LABEL[p.holding.assetType]?.plural ?? "units").toLowerCase()} and what you
                    paid per {unitNoun(p.holding.assetType)}. Nothing is looked up — {p.holding.symbol} has no price
                    feed — so the price is required here. The cost above recalculates from every transaction.
                  </>
                ) : (
                  <>
                    Enter a dollar amount or a share count. Leave the price blank and it is recorded at what{" "}
                    {p.holding.symbol} is trading at now; fill it in for something that happened on a different day.
                    Either way the average cost above recalculates from every transaction here.
                  </>
                )}
              </div>
            </div>
          )}

          {txs === null ? (
            <div className="py-5 flex justify-center">
              <Spinner />
            </div>
          ) : txs.length === 0 ? (
            <div className="text-body text-ink-3 py-2 leading-relaxed">
              No transactions recorded for this position. Anything you add here becomes the source of the share count
              and average cost above.
            </div>
          ) : (
            <div className="text-body">
              {txs.map((t) => (
                <div key={t.id} className="flex items-baseline justify-between gap-3 py-[6px] border-b border-line-soft last:border-0">
                  <span className={t.kind === "buy" ? "text-pos" : "text-neg"}>
                    {t.kind === "buy" ? (t.acquisition === "purchase" ? "Buy" : ACQUISITION_LABEL[t.acquisition]) : "Sell"}
                  </span>
                  <span className="tnum text-ink-3 flex-1">
                    {num(t.shares, t.shares % 1 === 0 ? 0 : 4)} @ {money(t.price)}
                  </span>
                  <span className="tnum text-ink-3">{t.date}</span>
                  <button
                    className="text-ink-3 hover:text-neg text-caption"
                    title={`Undo with ${shortcut}`}
                    onClick={async () => {
                      await api.deleteTransaction(t.id);
                      onUndoable({
                        label: `Deleted a ${t.kind} of ${p.holding.symbol}`,
                        run: async () => {
                          await api.addTransaction({ symbol: t.symbol, kind: t.kind, shares: t.shares, price: t.price, fees: t.fees, date: t.date, note: t.note });
                        },
                      });
                      setTxs(await api.listTransactions(p.holding.symbol));
                      onChanged();
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------- movers ----------------------------------- */

/**
 * What moved today, biggest percentage first.
 *
 * Sorted by percent rather than dollars deliberately: dollars just re-sorts the holdings table by
 * position size, and tells you that your largest holding is your largest holding. Percent tells
 * you what actually happened.
 */
function Movers({ positions, onOpen }: { positions: Position[]; onOpen: (p: Position) => void }) {
  const moved = useMemo(
    () =>
      positions
        .filter((p) => p.dayChangePct !== null)
        .sort((a, b) => (b.dayChangePct as number) - (a.dayChangePct as number)),
    [positions]
  );

  if (moved.length === 0) {
    return (
      <div className="text-body text-ink-3 py-3 leading-relaxed">
        No day change available yet. It needs the previous session&apos;s close, which arrives with the next price
        refresh.
      </div>
    );
  }

  const biggest = Math.max(...moved.map((m) => Math.abs(m.dayChangePct as number)), 0.01);

  return (
    <div className="grid gap-1.5">
      {moved.map((p) => {
        const pctv = p.dayChangePct as number;
        const up = pctv >= 0;
        return (
          <button
            key={p.holding.id}
            onClick={() => onOpen(p)}
            className="w-full text-left grid grid-cols-[64px_1fr_82px_86px] items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-raised transition-colors"
          >
            <span className="font-medium text-body truncate">{p.holding.symbol}</span>
            {/* A bar from the centre, so up and down are read at a glance rather than by sign. */}
            <span className="relative h-[5px] bg-line-soft rounded-full overflow-hidden">
              <span
                className={`absolute top-0 bottom-0 ${up ? "bg-pos left-1/2" : "bg-neg right-1/2"}`}
                style={{ width: `${(Math.abs(pctv) / biggest) * 50}%`, opacity: 0.9 }}
              />
            </span>
            <span className={`text-right text-body tnum ${up ? "text-pos" : "text-neg"}`}>{signedPct(pctv)}</span>
            <span className={`text-right text-body tnum ${up ? "text-pos" : "text-neg"}`}>{signed(p.dayChange)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------- watchlist --------------------------------- */

function Watchlist({ onBuy, onUndoable, shortcut }: { onBuy: (symbol: string, name: string | null) => void; onUndoable: (e: UndoEntry) => void; shortcut: string }) {
  const toast = useToast();
  const [items, setItems] = useState<WatchlistItem[] | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.watchlist();
      setItems(r.items);
      setQuotes(r.quotes);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (symbol: string, name: string | null) => {
    try {
      await api.addWatch(symbol, name);
      setPick("");
      setAdding(false);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add it", "error");
    }
  };

  return (
    <Panel
      title="Watchlist"
      subtitle="Tracking, not owned"
      actions={
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add"}
        </Button>
      }
    >
      {adding && (
        <div className="mb-3">
          <SymbolPicker
            value={pick}
            onChange={(symbol, info) => {
              if (symbol) add(symbol, info?.name ?? null);
            }}
            autoFocus
            placeholder="Search a symbol…"
          />
        </div>
      )}

      {items === null ? (
        <div className="py-6 flex justify-center">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <div className="text-body text-ink-3 py-2 leading-relaxed">
          Nothing on the watchlist. Add symbols you are following but do not own yet.
        </div>
      ) : (
        <div className="grid gap-1">
          {items.map((w) => {
            const q = quotes[w.symbol];
            const dayPct =
              q && q.previousClose ? ((q.price - q.previousClose) / q.previousClose) * 100 : null;
            return (
              <div key={w.id} className="group grid grid-cols-[1fr_auto_auto] items-baseline gap-2 py-[5px] border-b border-line-soft last:border-0">
                <div className="min-w-0">
                  <div className="text-body font-medium">{w.symbol}</div>
                  {w.name && <div className="text-caption text-ink-3 truncate">{w.name}</div>}
                </div>
                <div className="text-right">
                  <div className="text-body tnum">{q ? money(q.price) : "—"}</div>
                  {dayPct !== null && (
                    <div className={`text-caption tnum ${dayPct >= 0 ? "text-pos" : "text-neg"}`}>{signedPct(dayPct)}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="text-caption text-accent hover:underline"
                    title={`Add ${w.symbol} as a holding`}
                    onClick={() => onBuy(w.symbol, w.name)}
                  >
                    bought
                  </button>
                  <button
                    className="text-ink-3 hover:text-neg text-ui leading-none px-1"
                    title={`Remove — undo with ${shortcut}`}
                    onClick={async () => {
                      await api.removeWatch(w.id);
                      onUndoable({
                        label: `Removed ${w.symbol} from the watchlist`,
                        run: async () => {
                          await api.addWatch(w.symbol, w.name);
                        },
                      });
                      await load();
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}


/* ----------------------------------- reset ----------------------------------- */

/**
 * Clear the portfolio back to nothing.
 *
 * Shows real counts rather than a generic warning, because "this will delete your data" tells you
 * nothing about whether you mind. "3 holdings, 7 transactions, 41 recorded values" tells you
 * exactly what you are about to lose.
 *
 * Value history is the one part unticked by default: positions can be retyped and prices refetched,
 * but what the portfolio was worth last Tuesday cannot be reconstructed from anywhere once gone.
 */
function ResetDialog({ open, onClose, onDone, onUndoable, shortcut }: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  onUndoable: (e: UndoEntry) => void;
  shortcut: string;
}) {
  const toast = useToast();
  const [counts, setCounts] = useState<{ holdings: number; transactions: number; snapshots: number; watchlist: number; cash: number } | null>(null);
  const [parts, setParts] = useState({ holdings: true, history: false, cash: true, watchlist: true });
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setParts({ holdings: true, history: false, cash: true, watchlist: true });
    api.resetPreview().then(setCounts).catch(() => setCounts(null));
  }, [open]);

  const nothingSelected = !parts.holdings && !parts.history && !parts.cash && !parts.watchlist;

  const run = async () => {
    setWorking(true);
    try {
      const { removed } = await api.resetPortfolio(parts);
      onUndoable({ label: "Reset the portfolio", run: () => api.restoreBundle(removed).then(() => undefined) });
      toast(`Portfolio reset — ${shortcut} to undo`, "success");
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not reset it", "error");
    } finally {
      setWorking(false);
    }
  };

  const Row = ({ k, label, count }: { k: keyof typeof parts; label: string; count: React.ReactNode }) => (
    <label className="flex items-center gap-2.5 py-[7px] border-b border-line-soft last:border-0 cursor-pointer">
      <input
        type="checkbox"
        checked={parts[k]}
        onChange={(e) => setParts((s) => ({ ...s, [k]: e.target.checked }))}
        className="accent-[var(--color-accent)]"
      />
      <span className="text-body flex-1">{label}</span>
      <span className="text-caption text-ink-3 tnum">{count}</span>
    </label>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reset the portfolio"
      subtitle="Back to a clean slate. Reversible."
      width={440}
      footer={
        <>
          <Button onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button variant="danger" onClick={run} disabled={working || nothingSelected}>
            {working ? "Clearing…" : "Reset"}
          </Button>
        </>
      }
    >
      {counts === null ? (
        <div className="py-6 flex justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-3.5">
          <div>
            <Row k="holdings" label="Holdings and their transactions" count={`${counts.holdings} · ${counts.transactions} tx`} />
            <Row k="cash" label="Cash balance" count={money(counts.cash)} />
            <Row k="watchlist" label="Watchlist" count={counts.watchlist} />
            <Row k="history" label="Recorded value history (the chart)" count={counts.snapshots} />
          </div>

          {parts.history && counts.snapshots > 0 && (
            <div className="text-caption text-warn leading-relaxed">
              Clearing the value history restarts the chart from today. Positions can be retyped and prices refetched,
              but what the portfolio was worth on a past day cannot be reconstructed.
            </div>
          )}

          <div className="text-caption text-ink-3 leading-relaxed border-t border-line-soft pt-3">
            Your trades, accounts and backtests are untouched — this only clears the Portfolio page. Press {shortcut}
            {" "}afterwards to put it all back.
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ----------------------------------- page ------------------------------------ */

type SortKey = "symbol" | "value" | "return" | "day";

function PortfolioContents() {
  const toast = useToast();
  const [state, setState] = useState<PortfolioState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<Range>("ALL");
  const [sort, setSort] = useState<SortKey>("value");
  const [dialog, setDialog] = useState<{ open: boolean; editing: Position | null; seed?: { symbol: string; name: string | null } | null }>({
    open: false,
    editing: null,
  });
  const [detail, setDetail] = useState<Position | null>(null);

  /**
   * The open holding, re-read from the latest load rather than the snapshot it was opened with.
   *
   * Without this the modal freezes at the moment you clicked: revalue your gold or record a buy
   * and the figures directly above the control you just used go on showing the old numbers, which
   * reads as the action having failed. Falls back to the captured position for the instant between
   * a delete and the modal closing, when it is no longer in the list.
   */
  const detailLive = useMemo(
    () => (detail ? (state?.positions.find((p) => p.holding.id === detail.holding.id) ?? detail) : null),
    [detail, state]
  );
  /**
   * Which asset classes the page is reporting on. Null means all of them.
   *
   * Held as a set of class keys rather than a preset name so that "stocks and my gold" is as
   * expressible as "just stocks". Persisted, because a filter you have to re-apply on every visit
   * is a filter you stop using.
   */
  const [classes, setClasses] = useState<string[] | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("portfolio.classes");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) setClasses(parsed as string[]);
      }
    } catch {
      /* storage unavailable, or a stale value: fall back to showing everything */
    }
  }, []);

  const applyClasses = useCallback((next: string[] | null) => {
    setClasses(next);
    try {
      if (next === null) window.localStorage.removeItem("portfolio.classes");
      else window.localStorage.setItem("portfolio.classes", JSON.stringify(next));
    } catch {
      /* the choice simply will not persist */
    }
  }, []);

  const [cashDraft, setCashDraft] = useState<string | null>(null);
  // Bumped after an undo so the watchlist, which loads its own data, refetches too.
  const [watchKey, setWatchKey] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api.portfolio(false));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the portfolio");
    }
  }, []);

  const undo = useUndo(async () => {
    await load();
    setWatchKey((k) => k + 1);
  });
  const [shortcut, setShortcut] = useState("Ctrl+Z");
  // Read the platform after mount: doing it during render would make the server and the browser
  // disagree about the label and React would complain about the mismatch.
  useEffect(() => setShortcut(undoShortcutLabel()), []);

  /** Remove a position. No confirmation — undo is the safety net, and it is a keystroke away. */
  const removeHolding = useCallback(
    async (p: Position) => {
      const symbol = p.holding.symbol;
      try {
        const { holding, transactions } = await api.deleteHolding(p.holding.id);
        undo.push({
          label: `Removed ${symbol}`,
          run: async () => {
            await api.restoreHolding(holding, transactions);
          },
        });
        toast(`${symbol} removed — ${undoShortcutLabel()} to undo`, "success");
        await load();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not remove it", "error");
      }
    },
    [undo, toast, load]
  );

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setState(await api.portfolio(true));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Refresh failed", "error");
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * The portfolio as filtered, recomputed through the same arithmetic the server uses.
   *
   * Everything downstream — the tiles, the movers, the table, the allocation, the chart — reads
   * from here rather than from `state` directly, so a filter cannot end up applied to some figures
   * and not others. That inconsistency is the whole risk in a feature like this: a "Total return"
   * for the whole portfolio sitting above a table showing only metals is worse than no filter.
   */
  const view = useMemo(() => {
    if (!state) return null;
    if (classes === null) {
      return { positions: state.positions, totals: state.totals, cash: state.totals.cash };
    }
    const kept = state.positions.filter((p) => classes.includes(p.holding.assetType));
    // The loose cash balance is its own class, so it only counts when it was ticked.
    const cash = classes.includes(CASH_CLASS) ? state.totals.cash : 0;
    const { positions: repriced, totals } = totalsOf(kept, cash);
    return { positions: repriced, totals, cash };
  }, [state, classes]);

  /** Classes actually present, so the filter never offers a cut that returns nothing. */
  const availableClasses = useMemo(() => {
    if (!state) return [];
    const held = new Set(state.positions.map((p) => p.holding.assetType as string));
    const ordered = (Object.keys(ASSET_LABEL) as PortfolioAssetType[]).filter((t) => held.has(t));
    return state.totals.cash > 0 ? [...ordered, CASH_CLASS] : ordered;
  }, [state]);

  const classLabel = useCallback(
    (c: string) => (c === CASH_CLASS ? "Cash balance" : ASSET_LABEL[c as PortfolioAssetType] ?? c),
    []
  );

  const positions = useMemo(() => {
    if (!view) return [];
    const rows = [...view.positions];
    // Unpriced rows sort to the bottom of every value-based sort rather than to the top as zeros.
    const byNum = (a: number | null, b: number | null) => (a === null ? 1 : b === null ? -1 : b - a);
    switch (sort) {
      case "symbol":
        return rows.sort((a, b) => a.holding.symbol.localeCompare(b.holding.symbol));
      case "return":
        return rows.sort((a, b) => byNum(a.unrealised, b.unrealised));
      case "day":
        return rows.sort((a, b) => byNum(a.dayChangePct, b.dayChangePct));
      default:
        return rows.sort((a, b) => byNum(a.marketValue, b.marketValue));
    }
  }, [view, sort]);

  /**
   * The recorded history that can answer for the current filter.
   *
   * A snapshot written before per-class values were stored knows its total and nothing else, so it
   * is dropped rather than plotted: showing the whole portfolio's line under a "metals only" filter
   * would answer a question nobody asked.
   */
  const history = useMemo(() => (state ? filterable(state.snapshots, classes) : []), [state, classes]);

  // Recomputed rather than taken from the server so the slices add up to what is on screen. Server
  // percentages are of the whole portfolio, which under a filter would leave the bars summing to
  // some arbitrary fraction and quietly misrepresenting every weight.
  const alloc = useMemo(
    () => (view ? (classes === null ? state!.allocation : allocation(view.positions, view.cash, view.totals.total)) : []),
    [view, classes, state]
  );

  /** How much recorded history the filter costs, so the gap can be named rather than just appear. */
  const hiddenPoints = (state?.snapshots.length ?? 0) - history.length;

  const ranges = useMemo(() => availableRanges(history), [history]);

  const chart: LinePoint[] = useMemo(
    () =>
      inRange(history, range).map((s, i) => ({
        x: i,
        value: snapshotValue(s, classes) as number,
        label: new Date(s.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
        subValue: classes === null || classes.includes(CASH_CLASS) ? s.cash : 0,
      })),
    [history, range, classes]
  );

  /**
   * "Since you started", for whatever is being shown.
   *
   * Unfiltered this is the server's figure. Filtered, it is recomputed here from the filtered
   * history and only the lots belonging to those classes — through the same function, so buying
   * gold still counts as money paid in rather than as a gain on the metals line.
   */
  const sinceStart = useMemo(() => {
    if (!state) return null;
    if (classes === null) return state.performance;
    const lots = state.lots.filter((l) => classes.includes(l.assetType));
    return performanceSinceStart(
      history.map((s) => ({ ...s, total: snapshotValue(s, classes) as number })),
      lots
    );
  }, [state, classes, history]);

  const [rebaselining, setRebaselining] = useState(false);

  /** Throw away the history of data entry and measure from what it is worth now. */
  const rebaseline = useCallback(async () => {
    setRebaselining(true);
    try {
      const { total, removed } = await api.rebaselinePortfolio();
      undo.push({
        label: "Set today as the starting point",
        run: () => api.restoreBundle({ snapshots: removed }).then(() => undefined),
      });
      toast(`Starting balance set to ${money(total)} — ${undoShortcutLabel()} to undo`, "success");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not set the starting point", "error");
    } finally {
      setRebaselining(false);
    }
  }, [undo, toast, load]);

  const saveCash = async () => {
    if (cashDraft === null || !state) return;
    const v = Number(cashDraft);
    if (!Number.isFinite(v)) return toast("Cash must be a number", "error");
    const previous = state.totals.cash;
    if (v === previous) return setCashDraft(null);
    try {
      await api.saveCash(v);
      undo.push({ label: `Cash set to ${money(v)}`, run: () => api.saveCash(previous).then(() => undefined) });
      setCashDraft(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save it", "error");
    }
  };

  if (loadError) {
    return (
      <Page>
        <PageHeader title="Portfolio" />
        <Panel>
          <EmptyState title="The portfolio could not be loaded" body={loadError} action={<Button onClick={load}>Try again</Button>} />
        </Panel>
      </Page>
    );
  }

  if (!state) {
    return (
      <Page>
        <PageHeader title="Portfolio" />
        <div className="py-20 flex justify-center">
          <Spinner />
        </div>
      </Page>
    );
  }

  // Every figure below reads from the filtered view; `state` is only for things the filter does
  // not apply to, like when prices were last fetched.
  const t = view!.totals;
  const empty = state.positions.length === 0;
  const filtered = classes !== null;
  // A filter that hides everything is a mistake worth naming rather than an empty page.
  const filteredEmpty = filtered && view!.positions.length === 0 && view!.cash === 0;

  return (
    <Page>
      <PageHeader
        title="Portfolio"
        meta={
          state.pricingEnabled ? (
            <span>
              Prices updated {agoLabel(state.lastFetchedAt)}
              {state.priceErrors.length > 0 && <span className="text-warn"> · {state.priceErrors.length} could not be refreshed</span>}
            </span>
          ) : (
            <span className="text-warn">Live prices are off — set FINNHUB_API_KEY to switch them on</span>
          )
        }
        actions={
          <>
            {undo.next && (
              <Button onClick={() => void undo.undo()} disabled={undo.busy} title={`${undo.next.label} — ${shortcut}`}>
                {undo.busy ? "Undoing…" : `Undo ${shortcut}`}
              </Button>
            )}
            <Button onClick={refresh} disabled={refreshing || !state.pricingEnabled}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="primary" onClick={() => setDialog({ open: true, editing: null })}>
              Add holding
            </Button>
          </>
        }
      />

      {/* The filter sits above the figures it governs, so it reads as the scope of everything below
          rather than as a control belonging to any one panel. Only classes you actually hold are
          offered — a cut that can only return nothing is not a choice worth presenting. */}
      {availableClasses.length > 1 && (
        <Panel className="mb-4" bodyClass="py-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="eyebrow mr-0.5">Showing</span>

            <Chip active={!filtered} onClick={() => applyClasses(null)}>
              Everything
            </Chip>

            {FILTER_PRESETS.filter((preset) => preset.types.some((t2) => availableClasses.includes(t2))).map((preset) => {
              const types = preset.types.filter((t2) => availableClasses.includes(t2));
              const on = filtered && types.every((t2) => classes!.includes(t2)) && classes!.length === types.length;
              return (
                <Chip key={preset.label} active={on} onClick={() => applyClasses(on ? null : types)}>
                  {preset.label}
                </Chip>
              );
            })}

            <span className="w-px h-4 bg-line mx-1" />

            {availableClasses.map((c) => {
              const on = filtered && classes!.includes(c);
              return (
                <Chip
                  key={c}
                  active={on}
                  subtle
                  onClick={() => {
                    // Building a selection from "everything" starts with just what you clicked,
                    // rather than from all-but-one — clicking "Precious metal" plainly means
                    // "show me the metals".
                    const base = filtered ? classes! : [];
                    const next = on ? base.filter((x) => x !== c) : [...base, c];
                    applyClasses(next.length === 0 || next.length === availableClasses.length ? null : next);
                  }}
                >
                  {classLabel(c)}
                </Chip>
              );
            })}
          </div>
        </Panel>
      )}

      {filteredEmpty && (
        <Panel className="mb-4">
          <div className="text-body text-ink-3 py-2 leading-relaxed">
            Nothing in {classes!.map(classLabel).join(", ")}.{" "}
            <button className="text-ink underline underline-offset-2" onClick={() => applyClasses(null)}>
              Show everything
            </button>
          </div>
        </Panel>
      )}

      <Panel className="mb-4">
        <StatRow cols={4}>
          <Stat label="Total value" value={money(t.total)} size="lg" sub={`${money(t.marketValue)} invested · ${money(t.cash)} cash`} />
          <Stat
            label="Today"
            value={signed(t.dayChange)}
            tone={toneOf(t.dayChange)}
            sub={t.dayChangePct === null ? "needs the previous close" : signedPct(t.dayChangePct)}
            size="lg"
          />
          <Stat
            label="Total return"
            value={signed(t.unrealised)}
            tone={toneOf(t.unrealised)}
            sub={t.unrealisedPct === null ? "—" : `${signedPct(t.unrealisedPct)} on ${money(t.costBasis)}`}
            size="lg"
            // Named precisely, because with gifts in the portfolio "what you paid" and "what it is
            // measured from" stop being the same number.
            hint={
              t.invested === t.costBasis
                ? "Against the cost basis of what you hold."
                : `Against the cost basis of what you hold. ${money(t.invested)} of that ${money(t.costBasis)} is your own money; the rest arrived as gifts.`
            }
          />
          <Stat
            label="Cash"
            value={
              cashDraft === null ? (
                <button className="hover:text-accent transition-colors" onClick={() => setCashDraft(String(t.cash))} title="Click to edit">
                  {money(t.cash)}
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={cashDraft}
                    onChange={(e) => setCashDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveCash();
                      if (e.key === "Escape") setCashDraft(null);
                    }}
                    className="h-7 w-28 text-section"
                    inputMode="decimal"
                    autoFocus
                  />
                  <Button size="sm" variant="primary" onClick={saveCash}>
                    Save
                  </Button>
                </div>
              )
            }
            size="lg"
            sub={cashDraft === null ? "click to edit" : "enter to save"}
          />
        </StatRow>

        {(t.missingPrices.length > 0 || t.stalePrices.length > 0) && (
          <div className="mt-4 pt-3.5 border-t border-line-soft text-body leading-relaxed">
            {t.missingPrices.length > 0 && (
              <div className="text-warn">
                No price for {t.missingPrices.join(", ")} — {t.missingPrices.length === 1 ? "it is" : "they are"} excluded from
                the totals rather than counted as zero.
              </div>
            )}
            {t.stalePrices.length > 0 && (
              <div className="text-ink-3">Priced from cache: {t.stalePrices.join(", ")}. The last refresh did not reach the market.</div>
            )}
          </div>
        )}
      </Panel>

      {empty ? (
        <Panel>
          <EmptyState
            title="No holdings yet"
            body="Add what you own. Nothing connects to a broker — you enter the position, Overwatch prices it and tracks it from here on."
            action={
              <Button variant="primary" onClick={() => setDialog({ open: true, editing: null })}>
                Add your first holding
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-4 min-w-0">
            <Panel title="Today" subtitle="Biggest movers first, by percent">
              <Movers positions={view!.positions} onOpen={setDetail} />
            </Panel>

            <Panel
              title={filtered ? `Value — ${classes!.map(classLabel).join(", ")}` : "Portfolio value"}
              subtitle={
                sinceStart
                  ? // The baseline is named, not just dated. Anyone looking at a gain figure needs
                    // to see the number it is measured from before they can judge whether it is right.
                    `Starting balance ${money(sinceStart.startTotal)} — set ${new Date(sinceStart.from).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`
                  : "Recorded as you use the app"
              }
              actions={
                <div className="flex items-center gap-2 shrink-0">
                  {ranges.length > 1 && (
                    <Segmented
                      value={ranges.includes(range) ? range : ranges[ranges.length - 1]}
                      options={ranges.map((r) => ({ value: r, label: r === "ALL" ? "All" : r }))}
                      onChange={setRange}
                      size="xs"
                    />
                  )}
                </div>
              }
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {sinceStart ? (
                    <>
                      <div className="flex items-baseline gap-2.5 flex-wrap">
                        <span className={`text-figure-sm font-medium tnum tracking-[-0.025em] ${sinceStart.gain >= 0 ? "text-pos" : "text-neg"}`}>
                          {signed(sinceStart.gain)}
                        </span>
                        <span className="text-body text-ink-3 tnum">{signedPct(sinceStart.pct)} since you started</span>
                      </div>
                  {/* Named explicitly. Without this the figure above looks wrong to anyone who
                      just added a position and watched the total jump without the gain moving. */}
                      {Math.abs(sinceStart.contributions) >= 0.01 && (
                        <div className="text-caption text-ink-4 mt-1.5">
                          {sinceStart.contributions > 0 ? "Excludes " : "Adjusted for "}
                          <span className="tnum">{money(Math.abs(sinceStart.contributions))}</span>
                          {sinceStart.contributions > 0 ? " paid in since then" : " taken out since then"}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-body text-ink-3">Measured from the starting balance below.</div>
                  )}
                </div>

                {/* Anchors the baseline to what the portfolio is worth right now. The first hour of
                    history is a record of you typing holdings in, not of the market. A real button
                    rather than the caption this used to be: grey text next to a chart reads as a
                    label, and this is the only way to fix a starting balance captured mid entry. */}
                <Button
                  variant="ghost"
                  className="shrink-0"
                  title="Replace the starting balance with what the portfolio is worth right now, and start the chart here"
                  onClick={() => void rebaseline()}
                  disabled={rebaselining}
                >
                  {rebaselining ? "Setting…" : "Reset baseline to now"}
                </Button>
              </div>

              {chart.length < 2 ? (
                <div className="py-12 text-center text-body text-ink-3 leading-relaxed">
                  {/* One recorded value is not a line, but it is a starting balance — and after a
                      reset that number is the whole point of the screen, so it is said out loud
                      rather than left implicit in an empty chart. */}
                  {filtered && hiddenPoints > 0 ? (
                    <>
                      This line starts now.
                      <br />
                      <span className="text-ink-4">
                        Earlier values were recorded as a single total, with no record of how much of it was{" "}
                        {classes!.map(classLabel).join(" or ").toLowerCase()}. Splitting them now would be a guess, so
                        the filtered line begins here and fills in from this point.{" "}
                        <button className="text-ink-3 underline underline-offset-2" onClick={() => applyClasses(null)}>
                          Show everything
                        </button>{" "}
                        for the full history.
                      </span>
                    </>
                  ) : (
                    <>
                      The chart starts here
                      {chart.length === 1 && <span className="text-ink tnum">, at {money(chart[0].value)}</span>}.
                      <br />
                      <span className="text-ink-4">
                        Your portfolio&apos;s value is recorded each time you open this page. Nothing before today is
                        estimated or back-filled, so the line begins now and fills in from here.
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <LineChart
                  points={chart}
                  baseline={chart[0].value}
                  height={220}
                  format={(v) => money(v)}
                  formatDelta={(v) => signed(v)}
                  formatSub={(v) => money(v)}
                  subLabel="Cash"
                />
              )}

              {/* A shorter line under a filter is not a bug, and saying so beats letting it look
                  like one. Named only when history was actually dropped. */}
              {filtered && hiddenPoints > 0 && chart.length >= 2 && (
                <div className="text-caption text-ink-4 leading-relaxed mt-3 pt-3 border-t border-line-soft">
                  {hiddenPoints} earlier {hiddenPoints === 1 ? "value was" : "values were"} recorded as a single total,
                  before the split by asset class was kept, so this line starts after them.
                </div>
              )}
            </Panel>

            <Panel
              title="Holdings"
              subtitle={
                filtered
                  ? `${view!.positions.length} of ${state.positions.length} ${state.positions.length === 1 ? "position" : "positions"}`
                  : `${state.positions.length} ${state.positions.length === 1 ? "position" : "positions"}`
              }
              flush
              actions={
                <Segmented
                  value={sort}
                  options={[
                    { value: "value", label: "Value" },
                    { value: "day", label: "Today" },
                    { value: "return", label: "Return" },
                    { value: "symbol", label: "A–Z" },
                  ]}
                  onChange={(v) => setSort(v as SortKey)}
                  size="xs"
                />
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-body">
                  <thead>
                    <tr className="eyebrow border-b border-line">
                      <th className="text-left font-medium px-4 py-2.5">Symbol</th>
                      <th className="text-right font-medium px-3 py-2.5">Quantity</th>
                      <th className="text-right font-medium px-3 py-2.5">Price</th>
                      <th className="text-right font-medium px-3 py-2.5">Value</th>
                      <th className="text-right font-medium px-3 py-2.5">Today</th>
                      <th className="text-right font-medium px-3 py-2.5">Total return</th>
                      <th className="text-right font-medium px-4 py-2.5">Weight</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr
                        key={p.holding.id}
                        data-clickable
                        className="cursor-pointer"
                        onClick={() => setDetail(p)}
                      >
                        <td className="px-[18px] py-3">
                          <div className="font-medium">{p.holding.symbol}</div>
                          {p.holding.name && <div className="text-caption text-ink-3 truncate max-w-[160px]">{p.holding.name}</div>}
                        </td>
                        <td className="num px-3 py-3 text-ink-3">
                          {num(p.holding.shares, p.holding.shares % 1 === 0 ? 0 : 4)}
                          {/* One column serves shares, ounces and dollar balances, so a bare
                              number is ambiguous where it matters most: 6 shares and 6 ounces of
                              gold are not the same kind of thing. */}
                          {UNIT_LABEL[p.holding.assetType]?.suffix && (
                            <span className="text-ink-4 ml-1">{UNIT_LABEL[p.holding.assetType]?.suffix}</span>
                          )}
                        </td>
                        <td className="num px-3 py-3">
                          {p.quote ? (
                            <span className={p.quote.stale ? "text-ink-3" : ""} title={p.quote.stale ? `From cache, ${agoLabel(p.quote.fetchedAt)}` : undefined}>
                              {money(p.quote.price)}
                            </span>
                          ) : (
                            <span className="figure-none" title="No price available">
                              —
                            </span>
                          )}
                        </td>
                        <td className="num px-3 py-3">
                          {p.marketValue === null ? <span className="figure-none">—</span> : money(p.marketValue)}
                        </td>
                        <td className="num px-3 py-3">
                          <Delta value={p.dayChange} valuePct={p.dayChangePct} />
                        </td>
                        <td className="num px-3 py-3">
                          <Delta value={p.unrealised} valuePct={p.unrealisedPct} />
                        </td>
                        <td className="num px-[18px] py-3 text-ink-3">{p.weight === null ? "—" : pct(p.weight, 1)}</td>
                        <td className="px-2 py-3">
                          <button
                            className="text-ink-3 hover:text-neg text-title leading-none px-1"
                            title={`Remove ${p.holding.symbol} — undo with ${shortcut}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeHolding(p);
                            }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 content-start">
            <Panel
              title="Allocation"
              subtitle={filtered ? "Share of what is shown, by market value" : "Share of total value, cash included"}
            >
              {alloc.length === 0 ? (
                <div className="text-body text-ink-3 py-4">Nothing priced yet.</div>
              ) : (
                <div className="grid gap-2.5">
                  {alloc.map((s) => (
                    <div key={s.label}>
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="text-body truncate">{s.label}</span>
                        <span className="text-caption tnum text-ink-3 shrink-0">
                          {pct(s.pct, 1)} · {money(s.value, "USD", { compact: true })}
                        </span>
                      </div>
                      <div className="h-[4px] bg-line-soft rounded-full overflow-hidden">
                        <div
                          className={`h-full ${s.label === "Cash" ? "bg-ink-4" : "bg-accent"}`}
                          style={{ width: `${Math.min(100, s.pct)}%`, opacity: 0.9 }}
                        />
                      </div>
                    </div>
                  ))}
                  {t.missingPrices.length > 0 && (
                    <div className="text-caption text-ink-3 pt-2 border-t border-line-soft leading-relaxed">
                      {t.missingPrices.join(", ")} {t.missingPrices.length === 1 ? "has" : "have"} no slice — an unpriced
                      holding is unknown, not 0%.
                    </div>
                  )}
                </div>
              )}
            </Panel>

            <Watchlist
              key={watchKey}
              onBuy={(symbol, name) => setDialog({ open: true, editing: null, seed: { symbol, name } })}
              onUndoable={undo.push}
              shortcut={shortcut}
            />
          </div>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-line-soft flex items-center justify-between gap-4">
        <span className="text-caption text-ink-3">
          Starting over? Clear the portfolio back to nothing. Your trades and backtests are not affected.
        </span>
        <button className="text-caption text-ink-3 hover:text-neg transition-colors shrink-0" onClick={() => setResetOpen(true)}>
          Reset portfolio
        </button>
      </div>

      <ResetDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onDone={() => {
          void load();
          setWatchKey((k) => k + 1);
        }}
        onUndoable={undo.push}
        shortcut={shortcut}
      />

      <HoldingDialog
        open={dialog.open}
        editing={dialog.editing}
        seed={dialog.seed}
        onClose={() => setDialog({ open: false, editing: null })}
        onSaved={load}
        onUndoable={undo.push}
      />

      {detailLive && (
        <HoldingDetail
          position={detailLive}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setDialog({ open: true, editing: detail });
            setDetail(null);
          }}
          onRemove={() => {
            const p = detailLive;
            setDetail(null);
            void removeHolding(p);
          }}
          onChanged={load}
          onUndoable={undo.push}
          shortcut={shortcut}
        />
      )}

    </Page>
  );
}

/**
 * The page is the contents behind the lock.
 *
 * Wrapping here rather than inside the contents means the component that fetches holdings never
 * mounts while locked, so no request for your positions is made at all — not one that gets refused,
 * one that never happens.
 */
export default function PortfolioPage() {
  return (
    <PortfolioLock>
      <PortfolioContents />
    </PortfolioLock>
  );
}
