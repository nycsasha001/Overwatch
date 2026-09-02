"use client";

import React from "react";
import { Panel, Tag } from "./ui";
import { useApp } from "./app-context";
import { guardrails, RuleLine } from "@/lib/guardrails";
import { money, num, pct } from "@/lib/format";

function Meter({ rule, currency, invert }: { rule: RuleLine; currency: string; invert?: boolean }) {
  const tone = rule.breached ? "bg-neg" : rule.warn ? "bg-warn" : invert ? "bg-pos" : "bg-accent";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-[12px] text-ink-2">{rule.label}</span>
        <span className={`text-[12px] tnum ${rule.breached ? "text-neg" : rule.warn ? "text-warn" : "text-ink-3"}`}>
          {money(rule.used, currency)} / {money(rule.limit, currency)}
        </span>
      </div>
      <div className="h-[5px] bg-line-soft rounded-full overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${rule.ratio * 100}%`, opacity: 0.85 }} />
      </div>
      <div className="text-[11px] text-ink-3 mt-1 tnum">
        {rule.breached ? "No allowance left" : `${money(rule.remaining, currency)} remaining · ${pct(rule.ratio * 100, 0)} used`}
      </div>
    </div>
  );
}

export function GuardrailsPanel() {
  const app = useApp();
  const account = app.account;
  const g = guardrails(account, app.trades, app.settings);

  if (app.accountId === "all" || !account || !g.configured) return null;

  return (
    <Panel
      title="Account rules"
      subtitle={`${account.name} · ${account.type}${g.drawdown ? ` · ${g.drawdown.type} drawdown` : ""}`}
      actions={
        g.breaches.length ? (
          <Tag tone="neg">Breached</Tag>
        ) : g.drawdown?.warn || g.daily?.warn ? (
          <Tag tone="neg">Close to a limit</Tag>
        ) : (
          <Tag tone="pos">Within rules</Tag>
        )
      }
    >
      {g.breaches.length > 0 && (
        <div className="border border-neg/40 bg-neg-dim/40 rounded-sm px-3 py-2 mb-4">
          {g.breaches.map((b) => (
            <p key={b} className="text-[12.5px] text-neg">
              {b}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {g.profitTarget && <Meter rule={g.profitTarget} currency={app.currency} invert />}
        {g.drawdown && <Meter rule={g.drawdown} currency={app.currency} />}
        {g.daily && <Meter rule={g.daily} currency={app.currency} />}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-4 pt-3 border-t border-line-soft text-[11.5px] text-ink-3 tnum">
        <span>Balance {money(g.balance, app.currency)}</span>
        {g.drawdown && <span>Floor {money(g.drawdown.floor, app.currency)}</span>}
        {g.drawdown?.type === "trailing" && <span>Peak {money(g.peak, app.currency)}</span>}
        {g.headroomInR !== null && (
          <span className={g.headroomInR < 3 ? "text-warn" : ""}>
            {num(g.headroomInR, 1)} losing trades of your usual size from a breach
          </span>
        )}
      </div>
    </Panel>
  );
}
