"use client";

import React, { useEffect, useState } from "react";
import { useApp } from "@/components/app-context";
import { Page, PageHeader } from "@/components/shell";
import { Button, ConfirmDialog, Field, Input, Modal, Panel, Select, Switch, useToast } from "@/components/ui";
import { CsvImport } from "@/components/csv-import";
import { api } from "@/lib/client";
import { Account, Classification, RESULT_CODES, RESULT_LABEL, Settings } from "@/lib/types";
import { DEFAULT_CONTRACT_SPECS, specFor } from "@/lib/contracts";
import { money } from "@/lib/format";

export default function SettingsPage() {
  const app = useApp();
  const toast = useToast();
  const [local, setLocal] = useState<Settings>(app.settings);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLocal(app.settings);
    setDirty(false);
  }, [app.settings]);

  const patch = (p: Partial<Settings>) => {
    setLocal((s) => ({ ...s, ...p }));
    setDirty(true);
  };

  const save = async () => {
    try {
      await app.patchSettings(local);
      setDirty(false);
      toast("Settings saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save settings", "error");
    }
  };

  return (
    <Page>
      <PageHeader
        title="Settings"
        meta="Stored in the local database alongside your trades"
        actions={
          dirty ? (
            <Button variant="primary" onClick={save}>
              Save changes
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 max-w-[900px]">
        <AccountsSection />

        <Panel title="Trading defaults" id="trading">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Default risk %" hint="Pre-fills new trades">
              <Input value={local.defaultRiskPct} onChange={(e) => patch({ defaultRiskPct: Number(e.target.value) || 0 })} inputMode="decimal" />
            </Field>
            <Field label="Default instrument">
              <Input value={local.defaultInstrument} onChange={(e) => patch({ defaultInstrument: e.target.value })} />
            </Field>
            <Field label="Default contracts" hint="Pre-fills the replay ticket">
              <Input value={local.defaultContracts} onChange={(e) => patch({ defaultContracts: Number(e.target.value) || 0 })} inputMode="numeric" />
            </Field>
            <Field label="Default session">
              <Select value={local.defaultSession} onChange={(e) => patch({ defaultSession: e.target.value })}>
                <option value="">—</option>
                {local.sessions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="h-px bg-line-soft my-4" />

          <div className="label">Contract specifications</div>
          <p className="text-caption text-ink-3 mb-3 -mt-1">
            Position size is entered in contracts, so dollar risk is derived: stop distance × point value × contracts.
            Tick size also controls how prices snap when you drag a stop or target on the chart.
          </p>
          <div className="grid gap-1 mb-4">
            {[...new Set([...local.instruments, ...Object.keys(DEFAULT_CONTRACT_SPECS)])].sort().map((sym) => {
              const current = specFor(sym, local.contractSpecs);
              const isDefault = !local.contractSpecs[sym];
              return (
                <div key={sym} className="flex items-center gap-3 py-1 border-b border-line-soft last:border-0">
                  <span className="text-body w-[64px] shrink-0">{sym}</span>
                  <span className="text-caption text-ink-3 flex-1 truncate">{DEFAULT_CONTRACT_SPECS[sym]?.label ?? "Custom"}</span>
                  <label className="flex items-center gap-1.5">
                    <span className="text-caption text-ink-3">$/pt</span>
                    <Input
                      value={current.pointValue}
                      inputMode="decimal"
                      className="h-6! py-0! w-[74px] text-body!"
                      onChange={(e) =>
                        patch({
                          contractSpecs: {
                            ...local.contractSpecs,
                            [sym]: { pointValue: Number(e.target.value) || 0, tickSize: current.tickSize },
                          },
                        })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-caption text-ink-3">tick</span>
                    <Input
                      value={current.tickSize}
                      inputMode="decimal"
                      className="h-6! py-0! w-[74px] text-body!"
                      onChange={(e) =>
                        patch({
                          contractSpecs: {
                            ...local.contractSpecs,
                            [sym]: { pointValue: current.pointValue, tickSize: Number(e.target.value) || 0 },
                          },
                        })
                      }
                    />
                  </label>
                  <span className="text-micro text-ink-3 w-[52px] text-right">{isDefault ? "default" : "custom"}</span>
                </div>
              );
            })}
          </div>

          <div className="grid gap-4">
            <ListEditor label="Instruments" values={local.instruments} onChange={(v) => patch({ instruments: v })} />
            <ListEditor label="Sessions" values={local.sessions} onChange={(v) => patch({ sessions: v })} />
            <ListEditor label="Entry models" values={local.entryModels} onChange={(v) => patch({ entryModels: v })} />
            <ListEditor label="PD arrays" values={local.pdArrays} onChange={(v) => patch({ pdArrays: v })} />
            <ListEditor label="Liquidity targets" values={local.liquidityTargets} onChange={(v) => patch({ liquidityTargets: v })} />
          </div>
        </Panel>

        <Panel title="Statistics" subtitle="How each result classification is counted" id="statistics">
          <div className="grid gap-2">
            {RESULT_CODES.map((rc) => (
              <div key={rc} className="flex items-center justify-between gap-4 py-1.5 border-b border-line-soft last:border-0">
                <div>
                  <div className="text-body">{RESULT_LABEL[rc]}</div>
                  <div className="text-caption text-ink-3">
                    {local.classification[rc] === "excluded"
                      ? "Ignored entirely — not counted in any statistic"
                      : local.classification[rc] === "breakeven"
                      ? "Counted as a trade, but neither a win nor a loss"
                      : `Counted as a ${local.classification[rc]}`}
                  </div>
                </div>
                <Select
                  className="w-[136px]"
                  value={local.classification[rc]}
                  onChange={(e) => patch({ classification: { ...local.classification, [rc]: e.target.value as Classification } })}
                >
                  <option value="win">Win</option>
                  <option value="loss">Loss</option>
                  <option value="breakeven">Break-even</option>
                  <option value="excluded">Exclude</option>
                </Select>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-4 mt-4 pt-3 border-t border-line-soft">
            <div>
              <div className="text-body">Include break-even trades in win rate</div>
              <div className="text-caption text-ink-3">
                {local.breakevenInWinRate ? "Win rate = wins ÷ (wins + losses + break-evens)" : "Win rate = wins ÷ (wins + losses)"}
              </div>
            </div>
            <Switch checked={local.breakevenInWinRate} onChange={(v) => patch({ breakevenInWinRate: v })} />
          </div>
        </Panel>

        <StrategiesSection />

        <Panel title="Replay" subtitle="What happens automatically when you trade in replay">
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-body">Mark trades on the chart</div>
                <div className="text-caption text-ink-3">
                  Draws a long or short position at the entry, and labels it with the result when it closes
                </div>
              </div>
              <Switch
                checked={local.replayOptions?.drawPositions ?? true}
                onChange={(v) => patch({ replayOptions: { ...local.replayOptions, drawPositions: v } })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-body">Screenshot on exit</div>
                <div className="text-caption text-ink-3">
                  Captures the chart as it stood at the exit and files it against the journal entry
                </div>
              </div>
              <Switch
                checked={local.replayOptions?.screenshotOnExit ?? true}
                onChange={(v) => patch({ replayOptions: { ...local.replayOptions, screenshotOnExit: v } })}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Backtesting engine" subtitle="Lets the Run button in Backtesting start your script" id="engine">
          <p className="text-body text-ink-2 leading-relaxed mb-3">
            Point this at the file you would press play on in your editor. The app runs it with your
            interpreter, waits for it to finish, and captures whatever it prints. The path lives here rather
            than in the request, so nothing reaching the API can choose what gets executed.
          </p>
          <div className="grid gap-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Interpreter" hint="python3, or a venv's python">
                <Input value={local.engine?.interpreter ?? "python3"} onChange={(e) => patch({ engine: { ...local.engine, interpreter: e.target.value } })} />
              </Field>
              <Field label="Extra arguments" hint="Optional, passed before the run's own">
                <Input value={local.engine?.args ?? ""} onChange={(e) => patch({ engine: { ...local.engine, args: e.target.value } })} placeholder="--verbose" />
              </Field>
              <Field label="Working directory" hint="Defaults to the script's folder">
                <Input value={local.engine?.workingDir ?? ""} onChange={(e) => patch({ engine: { ...local.engine, workingDir: e.target.value } })} placeholder="optional" />
              </Field>
            </div>
            <Field label="Script" hint="Absolute path to the file you run">
              <Input
                value={local.engine?.script ?? ""}
                onChange={(e) => patch({ engine: { ...local.engine, script: e.target.value } })}
                placeholder="/Users/you/Desktop/Backtesting Engine/main.py"
                className="mono text-body!"
              />
            </Field>
            <div className="border border-line-soft rounded-sm p-3">
              <div className="label">What your script receives</div>
              <pre className="mono text-caption text-ink-3 leading-relaxed whitespace-pre-wrap">{`arguments   --symbol MNQ --start 2026-03-01 --end 2026-04-01 --strategy "…"
environment OVERWATCH_URL, OVERWATCH_RUN_ID, OVERWATCH_RUN_NAME,
            OVERWATCH_SYMBOL, OVERWATCH_START, OVERWATCH_END, OVERWATCH_PARAMS`}</pre>
              <p className="text-caption text-ink-3 mt-2 leading-relaxed">
                Ignore them if you like — argparse will, as long as your script does not reject unknown
                arguments. Results get in either by posting them with engine/overwatch.py, or by printing a
                JSON object with a <span className="mono">trades</span> count as the last thing on stdout.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Obsidian" subtitle="Write trades into your vault as markdown notes" id="obsidian">
          <p className="text-body text-ink-2 leading-relaxed mb-3">
            One note per trade, in the folder below. Everything mechanical goes in the frontmatter — symbol,
            direction, R, P&amp;L, setup — so Dataview and Bases can query it; the notes you wrote stay in the
            body. The screenshot is copied in beside the note, so it keeps working if this app moves.
          </p>
          <p className="text-body text-ink-3 leading-relaxed mb-3">
            One way only, Overwatch into the vault, and it will never overwrite a note it did not write
            itself. Reading notes back would mean deciding which side wins when both changed, and the wrong
            answer to that quietly destroys writing you cannot get back.
          </p>
          <div className="grid gap-3">
            <Field label="Vault folder" hint="Absolute path — the folder containing .obsidian">
              <Input
                value={local.obsidianVault ?? ""}
                onChange={(e) => patch({ obsidianVault: e.target.value || null })}
                placeholder="/Users/you/Documents/My Vault"
                className="mono text-body!"
              />
            </Field>
            <Field label="Notes folder" hint="Inside the vault. Created if it is not there yet">
              <Input
                value={local.obsidianFolder ?? "Trades"}
                onChange={(e) => patch({ obsidianFolder: e.target.value })}
                placeholder="Trades"
                className="mono text-body!"
              />
            </Field>
          </div>
        </Panel>

        <Panel title="Import / export" subtitle="CSV in, CSV out" id="import">
          <CsvImport />
        </Panel>

        <Panel title="Appearance">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-body">Theme</div>
              <div className="text-caption text-ink-3">Overwatch ships a single dark theme tuned for long sessions. No light mode is implemented.</div>
            </div>
            <span className="text-body text-ink-3">Dark</span>
          </div>
        </Panel>

        {dirty && (
          <div className="sticky bottom-4 flex justify-end">
            <div className="bg-raised border border-line rounded-md px-3 py-2 flex items-center gap-3 shadow-lg shadow-black/40">
              <span className="text-body text-ink-2">Unsaved changes</span>
              <Button variant="primary" onClick={save}>
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

function ListEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex flex-wrap gap-1 mb-2">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-xs border border-line text-caption text-ink-2">
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))} className="text-ink-3 hover:text-neg" aria-label={`Remove ${v}`}>
              ×
            </button>
          </span>
        ))}
        {!values.length && <span className="text-caption text-ink-3">None</span>}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={`Add ${label.toLowerCase().replace(/s$/, "")}…`}
          className="max-w-[240px]"
        />
        <Button onClick={add}>Add</Button>
      </div>
    </div>
  );
}

function AccountsSection() {
  const app = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<Account | null>(null);

  const remove = async () => {
    if (!confirm) return;
    try {
      await api.deleteAccount(confirm.id);
      if (app.accountId === confirm.id) app.setAccountId("all");
      await app.refresh();
      toast("Account deleted");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
    } finally {
      setConfirm(null);
    }
  };

  return (
    <Panel
      title="Accounts"
      id="accounts"
      subtitle="Statistics respect the account selected in the sidebar"
      actions={<Button onClick={() => setCreating(true)}>Add account</Button>}
    >
      <div className="grid gap-1">
        {app.accounts.map((a) => {
          const pnl = app.trades.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.pnl, 0);
          return (
            <div key={a.id} className="flex items-center gap-3 py-2 border-b border-line-soft last:border-0">
              <div className="min-w-0 flex-1">
                <div className="text-ui flex items-center gap-2">
                  {a.name}
                  <span className="text-micro uppercase tracking-wide text-ink-3 border border-line rounded-xs px-1">{a.type}</span>
                  {a.archived ? <span className="text-micro text-ink-3">archived</span> : null}
                </div>
                <div className="text-caption text-ink-3 tnum">
                  Start {money(a.startingBalance, a.currency)} · {a.currency}
                  {a.defaultRiskPct !== null ? ` · ${a.defaultRiskPct}% risk` : ""}
                  {app.accountId === a.id || app.accountId === "all" ? ` · P&L ${money(pnl, a.currency, { sign: true })}` : ""}
                </div>
              </div>
              <Button variant="ghost" onClick={() => setEditing(a)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(a)}>
                Delete
              </Button>
            </div>
          );
        })}
      </div>

      <AccountModal
        open={creating || !!editing}
        account={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        title={`Delete ${confirm?.name ?? "account"}?`}
        body="Every trade, note and screenshot recorded against this account will be permanently deleted. This cannot be undone."
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </Panel>
  );
}

function AccountModal({ open, account, onClose }: { open: boolean; account: Account | null; onClose: () => void }) {
  const app = useApp();
  const toast = useToast();
  const [form, setForm] = useState({
    name: "", type: "personal", startingBalance: "", currency: "USD", defaultRiskPct: "", archived: false,
    profitTarget: "", maxDrawdown: "", drawdownType: "static", dailyLossLimit: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      account
        ? {
            name: account.name,
            type: account.type,
            startingBalance: String(account.startingBalance),
            currency: account.currency,
            defaultRiskPct: account.defaultRiskPct === null ? "" : String(account.defaultRiskPct),
            archived: !!account.archived,
            profitTarget: account.profitTarget === null ? "" : String(account.profitTarget),
            maxDrawdown: account.maxDrawdown === null ? "" : String(account.maxDrawdown),
            drawdownType: account.drawdownType ?? "static",
            dailyLossLimit: account.dailyLossLimit === null ? "" : String(account.dailyLossLimit),
          }
        : {
            name: "", type: "personal", startingBalance: "", currency: app.settings.currency,
            defaultRiskPct: String(app.settings.defaultRiskPct), archived: false,
            profitTarget: "", maxDrawdown: "", drawdownType: "static", dailyLossLimit: "",
          }
    );
  }, [open, account, app.settings]);

  const submit = async () => {
    if (!form.name.trim()) return toast("Account name is required", "error");
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type as Account["type"],
        startingBalance: Number(form.startingBalance) || 0,
        currency: form.currency,
        defaultRiskPct: form.defaultRiskPct === "" ? null : Number(form.defaultRiskPct),
        archived: (form.archived ? 1 : 0) as 0 | 1,
        profitTarget: form.profitTarget === "" ? null : Number(form.profitTarget),
        maxDrawdown: form.maxDrawdown === "" ? null : Number(form.maxDrawdown),
        drawdownType: form.drawdownType as Account["drawdownType"],
        dailyLossLimit: form.dailyLossLimit === "" ? null : Number(form.dailyLossLimit),
      };
      if (account) await api.updateAccount(account.id, payload);
      else await api.createAccount(payload);
      await app.refresh();
      toast(account ? "Account updated" : "Account created", "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the account", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={480}
      title={account ? "Edit account" : "New account"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="personal">Personal</option>
              <option value="evaluation">Evaluation</option>
              <option value="backtest">Backtest (engine)</option>
              <option value="funded">Funded</option>
              <option value="paper">Paper</option>
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starting balance">
            <Input value={form.startingBalance} onChange={(e) => setForm({ ...form, startingBalance: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Default risk %">
            <Input value={form.defaultRiskPct} onChange={(e) => setForm({ ...form, defaultRiskPct: e.target.value })} inputMode="decimal" />
          </Field>
        </div>
        <div className="border-t border-line-soft pt-3">
          <div className="label">Account rules</div>
          <p className="text-caption text-ink-3 mb-3 -mt-1">
            Leave a field blank if the rule does not apply. Shown on the dashboard for this account only.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Profit target" hint="Profit needed to pass">
              <Input value={form.profitTarget} onChange={(e) => setForm({ ...form, profitTarget: e.target.value })} inputMode="decimal" placeholder="1500" />
            </Field>
            <Field label="Daily loss limit">
              <Input value={form.dailyLossLimit} onChange={(e) => setForm({ ...form, dailyLossLimit: e.target.value })} inputMode="decimal" placeholder="500" />
            </Field>
            <Field label="Max drawdown">
              <Input value={form.maxDrawdown} onChange={(e) => setForm({ ...form, maxDrawdown: e.target.value })} inputMode="decimal" placeholder="1500" />
            </Field>
            <Field label="Drawdown type" hint={form.drawdownType === "trailing" ? "Measured from your highest balance" : "Measured from the starting balance"}>
              <Select value={form.drawdownType} onChange={(e) => setForm({ ...form, drawdownType: e.target.value })}>
                <option value="static">Static</option>
                <option value="trailing">Trailing</option>
              </Select>
            </Field>
          </div>
        </div>

        {account && (
          <div className="flex items-center justify-between border-t border-line-soft pt-3">
            <div>
              <div className="text-body">Archived</div>
              <div className="text-caption text-ink-3">Hidden from the account switcher, data is kept</div>
            </div>
            <Switch checked={form.archived} onChange={(v) => setForm({ ...form, archived: v })} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function StrategiesSection() {
  const app = useApp();
  const toast = useToast();
  const [name, setName] = useState("");
  const [setupName, setSetupName] = useState("");

  const addStrategy = async () => {
    if (!name.trim()) return;
    try {
      await api.createStrategy(name.trim(), null);
      setName("");
      await app.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add strategy", "error");
    }
  };

  const addSetup = async () => {
    if (!setupName.trim()) return;
    try {
      await api.createSetup(setupName.trim());
      setSetupName("");
      await app.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add setup", "error");
    }
  };

  return (
    <Panel title="Strategies & setups" subtitle="Suggested when logging a trade" id="strategies">
      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <div className="label">Strategies</div>
          <div className="grid gap-1 mb-2">
            {app.strategies.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 py-1 border-b border-line-soft last:border-0">
                <span className="text-body">{s.name}</span>
                <button
                  onClick={async () => {
                    await api.deleteStrategy(s.id);
                    await app.refresh();
                  }}
                  className="text-caption text-ink-3 hover:text-neg"
                >
                  Remove
                </button>
              </div>
            ))}
            {!app.strategies.length && <span className="text-caption text-ink-3">None yet</span>}
          </div>
          <div className="flex gap-1.5">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Silver bullet" onKeyDown={(e) => e.key === "Enter" && addStrategy()} />
            <Button onClick={addStrategy}>Add</Button>
          </div>
        </div>
        <div>
          <div className="label">Setups</div>
          <div className="grid gap-1 mb-2">
            {app.setups.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 py-1 border-b border-line-soft last:border-0">
                <span className="text-body">{s.name}</span>
                <button
                  onClick={async () => {
                    await api.deleteSetup(s.id);
                    await app.refresh();
                  }}
                  className="text-caption text-ink-3 hover:text-neg"
                >
                  Remove
                </button>
              </div>
            ))}
            {!app.setups.length && <span className="text-caption text-ink-3">None yet</span>}
          </div>
          <div className="flex gap-1.5">
            <Input value={setupName} onChange={(e) => setSetupName(e.target.value)} placeholder="e.g. 4H Sweep" onKeyDown={(e) => e.key === "Enter" && addSetup()} />
            <Button onClick={addSetup}>Add</Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
