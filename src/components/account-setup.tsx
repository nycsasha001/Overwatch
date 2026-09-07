"use client";

import React, { useState } from "react";
import { useApp } from "./app-context";
import { Button, Field, Input, Select, useToast } from "./ui";
import { api } from "@/lib/client";

export function AccountSetup() {
  const app = useApp();
  const toast = useToast();
  const [name, setName] = useState("Main");
  const [type, setType] = useState("personal");
  const [balance, setBalance] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [risk, setRisk] = useState("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr("Give the account a name.");
    const sb = Number(balance);
    if (!Number.isFinite(sb) || balance === "") return setErr("Enter the account's starting balance.");
    setBusy(true);
    try {
      await api.createAccount({
        name: name.trim(),
        type: type as "personal",
        startingBalance: sb,
        currency,
        defaultRiskPct: risk === "" ? null : Number(risk),
      });
      await app.refresh();
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the account");
      toast("Could not create the account", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-[420px] anim-rise">
        <div className="mb-5">
          <div className="text-ui font-medium">Overwatch</div>
          <h1 className="text-page font-medium tracking-tight mt-3">Create your first account</h1>
          <p className="text-ui text-ink-3 mt-1.5 leading-relaxed">
            Every trade, note and statistic is stored against an account in a local SQLite database. You can add more accounts later.
          </p>
        </div>

        <div className="bg-surface border border-line rounded-md p-4 grid gap-3.5">
          <Field label="Account name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="personal">Personal</option>
                <option value="evaluation">Evaluation</option>
                <option value="backtest">Backtest (engine)</option>
                <option value="funded">Funded</option>
                <option value="paper">Paper</option>
              </Select>
            </Field>
            <Field label="Currency">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
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
              <Input value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="50000" inputMode="decimal" />
            </Field>
            <Field label="Default risk %" hint="Used to pre-fill new trades">
              <Input value={risk} onChange={(e) => setRisk(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
          {err && <p className="text-body text-neg">{err}</p>}
          <Button type="submit" variant="primary" size="md" disabled={busy} className="mt-1">
            {busy ? "Creating…" : "Create account"}
          </Button>
        </div>
      </form>
    </div>
  );
}
