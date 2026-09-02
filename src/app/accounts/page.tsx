"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Page, PageHeader } from "@/components/shell";
import { Button, EmptyState, Panel, Spinner, Tag } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { ACCOUNT_TYPE_LABEL, IS_SIMULATED, groupAccounts } from "@/lib/account-groups";
import { money, pct, r as fmtR } from "@/lib/format";
import type { AccountOverview } from "../api/accounts/overview/route";

/**
 * One bar of an account's rules. Deliberately compact — this page answers "which account is in
 * trouble", and the full breakdown lives on the dashboard once you have switched to it.
 */
function RuleBar({ label, ratio, tone }: { label: string; ratio: number | null; tone: "pos" | "risk" }) {
  if (ratio === null) return null;
  const clamped = Math.max(0, Math.min(1, ratio));
  // A profit target filling up is good news; a drawdown allowance filling up is not.
  const fill =
    tone === "pos" ? "bg-pos" : clamped >= 1 ? "bg-neg" : clamped >= 0.75 ? "bg-warn" : "bg-accent";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-ink-3 truncate">{label}</span>
        <span className="text-[11px] tnum text-ink-3 shrink-0">{pct(clamped * 100, 0)}</span>
      </div>
      <div className="h-[4px] bg-line-soft rounded-full overflow-hidden">
        <div className={`h-full ${fill}`} style={{ width: `${clamped * 100}%`, opacity: 0.9 }} />
      </div>
    </div>
  );
}

function AccountCard({ row, active, onOpen }: { row: AccountOverview; active: boolean; onOpen: () => void }) {
  const { account } = row;
  const up = row.netPnl > 0;
  const flat = row.netPnl === 0;

  return (
    <button
      onClick={onOpen}
      className={`text-left w-full rounded-md border p-3.5 transition-colors elev-1 ${
        active ? "border-accent/60 bg-raised" : "border-line bg-surface hover:bg-raised hover:border-[#332f2b]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13.5px] font-medium truncate">{account.name}</span>
            {active && <Tag tone="accent">Active</Tag>}
          </div>
          <div className="text-[11px] text-ink-3 mt-0.5">
            {ACCOUNT_TYPE_LABEL[account.type]}
            {IS_SIMULATED[account.type] && " · simulated"}
            {row.lastTradeDate ? ` · last ${row.lastTradeDate}` : " · no trades yet"}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[17px] tnum font-medium tracking-[-0.03em] leading-tight">
            {money(row.balance, account.currency, { compact: true })}
          </div>
          <div className={`text-[11.5px] tnum ${flat ? "text-ink-3" : up ? "text-pos" : "text-neg"}`}>
            {money(row.netPnl, account.currency, { sign: true, compact: true })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mt-3 pt-3 border-t border-line-soft">
        {[
          ["Trades", String(row.trades)],
          ["Net R", fmtR(row.netR)],
          ["Win %", row.winRate === null ? "—" : pct(row.winRate, 0)],
          ["Expectancy", row.expectancyR === null ? "—" : `${fmtR(row.expectancyR)}R`],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.09em] text-ink-3 truncate">{label}</div>
            <div className="text-[12.5px] tnum mt-0.5 truncate">{value}</div>
          </div>
        ))}
      </div>

      {row.rules && (
        <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-line-soft">
          <RuleBar label="Target" ratio={row.rules.profitTargetRatio} tone="pos" />
          <RuleBar label="Drawdown" ratio={row.rules.drawdownRatio} tone="risk" />
          <RuleBar label="Daily" ratio={row.rules.dailyRatio} tone="risk" />
        </div>
      )}
      {row.rules?.breached && (
        <div className="mt-2.5 text-[11.5px] text-neg">A limit on this account has been breached.</div>
      )}
    </button>
  );
}

export default function AccountsPage() {
  const app = useApp();
  const router = useRouter();
  const [rows, setRows] = useState<AccountOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts/overview", { cache: "no-store" });
      if (!res.ok) throw new Error(`Overview failed (${res.status})`);
      const json = (await res.json()) as { accounts: AccountOverview[] };
      setRows(json.accounts);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Switching account and going to the dashboard is the point of clicking a card — nobody wants to
  // land back on a list of the thing they just chose.
  const open = (id: string) => {
    app.setAccountId(id);
    router.push("/");
  };

  const live = (rows ?? []).filter((r) => !r.account.archived);
  const groups = groupAccounts(live);
  const realPnl = live.filter((r) => !IS_SIMULATED[r.account.type]).reduce((s, r) => s + r.netPnl, 0);

  return (
    <Page>
      <PageHeader
        title="Accounts"
        meta={
          rows === null
            ? "Loading…"
            : `${live.length} active · ${money(realPnl, app.currency, { sign: true })} across funded and personal`
        }
        actions={
          <>
            <Button onClick={() => void load()}>Refresh</Button>
            <Button variant="primary" onClick={() => router.push("/settings#accounts")}>
              New account
            </Button>
          </>
        }
      />

      {error && (
        <Panel className="mb-4">
          <p className="text-[12.5px] text-neg">{error}</p>
        </Panel>
      )}

      {rows === null ? (
        <Panel>
          <Spinner label="Reading every account…" />
        </Panel>
      ) : live.length === 0 ? (
        <Panel>
          <EmptyState
            title="No accounts yet"
            body="Add an evaluation, a paper account for forward-testing, or let the engine create its own backtest account on its first run."
            action={
              <Button variant="primary" onClick={() => router.push("/settings#accounts")}>
                Add an account
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.type}>
              <div className="flex items-baseline gap-2.5 mb-2.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-2">{g.label}</h2>
                <span className="text-[11px] text-ink-3">{g.blurb}</span>
                <span className="text-[11px] tnum text-ink-3 ml-auto">{g.rows.length}</span>
              </div>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
                {g.rows.map((row) => (
                  <AccountCard
                    key={row.account.id}
                    row={row}
                    active={row.account.id === app.accountId}
                    onOpen={() => open(row.account.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
