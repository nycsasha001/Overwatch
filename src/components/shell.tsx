"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./app-context";
import { Button, Popover, Spinner } from "./ui";
import { FilterBar } from "./filter-bar";
import { AccountSetup } from "./account-setup";
import { useTradeEditor } from "./trade-editor";
import { money } from "@/lib/format";
import { ACCOUNT_TYPE_LABEL, ACCOUNT_GROUPS } from "@/lib/account-groups";

/**
 * The sidebar is for the four places you read every day. Everything else — choosing an account,
 * the account overview, the backtesting journal, market data, settings, and replay — lives in the
 * menu at the bottom of the sidebar. A rail with nine entries makes the two you actually use
 * hard to find; four does not.
 */
const NAV = [
  { href: "/", label: "Dashboard", icon: "M2 11.5l4.5-5 3.5 3.5L14 4" },
  { href: "/calendar", label: "Calendar", icon: "M3 4.5h10v9H3zM3 7h10M6 3v3M10 3v3" },
  { href: "/journal", label: "Journal", icon: "M4 3h8v10H4zM6 6h4M6 8.5h4" },
  { href: "/analytics", label: "Analytics", icon: "M3 13V8M7 13V4M11 13v-3" },
];

/** Reached from the account menu rather than the rail. Replay is handled separately, as a mode. */
const SECTIONS = [
  { href: "/accounts", label: "Accounts", hint: "Compare every account", icon: "M2.5 5.5h11v7h-11zM2.5 8h11M5 10.5h2" },
  { href: "/backtesting", label: "Backtesting journal", hint: "Engine runs and write-ups", icon: "M3 8h3l2-4 2 8 2-4h1" },
  { href: "/market", label: "Market data", hint: "Stored candles and imports", icon: "M2.5 12.5h11M4.5 10V5M7.5 10V3M10.5 10V6.5M13 10V4" },
  { href: "/settings", label: "Settings", hint: "Accounts, engine, preferences", icon: "M8 5.5A2.5 2.5 0 108 10.5 2.5 2.5 0 008 5.5zM8 2v1.5M8 12.5V14M14 8h-1.5M3.5 8H2" },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d={d} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const pathname = usePathname();
  const editor = useTradeEditor();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => setNavOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
      if (typing) return;
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && app.accounts.length) {
        e.preventDefault();
        editor.open(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, app.accounts.length]);

  /**
   * The login screen is not part of the app.
   *
   * Everything below assumes a signed-in session: the shell asks for the journal, and when that
   * request comes back 401 it reports "cannot reach the local database" — which is a lie, and the
   * first thing you see after setting a password. The login route renders on its own.
   */
  if (pathname === "/login") return <>{children}</>;

  if (app.loading && !app.accounts.length) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Spinner label="Loading journal…" />
      </div>
    );
  }

  if (app.error && !app.accounts.length) {
    return (
      <div className="h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-[15px] font-medium">Cannot reach the local database</h1>
          <p className="text-[13px] text-ink-3 mt-2 leading-relaxed">{app.error}</p>
          <Button className="mt-4" onClick={() => location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!app.accounts.length) return <AccountSetup />;

  // Replay takes the whole window. Backtesting wants every pixel for the chart, and stripping the
  // rail and header is what makes entering it feel like changing mode rather than following a
  // link. The page supplies its own way back out.
  if (pathname.startsWith("/replay")) return <div className="h-screen overflow-hidden">{children}</div>;

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`fixed lg:static z-40 h-full w-[204px] shrink-0 bg-surface border-r border-line flex flex-col transition-transform duration-150 ${
          navOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-[46px] flex items-center px-4 border-b border-line-soft">
          <span className="display text-[13.5px] font-semibold tracking-[-0.02em]">Overwatch</span>
          <span className="ml-1.5 text-[11px] text-ink-3">Trading Journal</span>
        </div>

        <nav className="p-2 flex flex-col gap-[1px]">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`relative flex items-center gap-2.5 h-9 px-2.5 rounded-sm text-[13px] transition-colors ${
                  active ? "bg-hover text-ink" : "text-ink-2 hover:text-ink hover:bg-hover/60"
                }`}
              >
                {/* A red rule against the left edge marks the current section. It replaces
                    tinting the icon: one small saturated mark reads as deliberate where a
                    coloured glyph in a list of glyphs just reads as noise. */}
                {active && (
                  <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-accent" aria-hidden />
                )}
                <span className={active ? "text-ink" : "text-ink-3"}>
                  <NavIcon d={n.icon} />
                </span>
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto p-3 border-t border-line-soft">
          <AccountSwitcher />
        </div>
      </aside>

      {navOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setNavOpen(false)} />}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[46px] shrink-0 border-b border-line flex items-center gap-3 px-3 sm:px-4 bg-surface">
          <button className="lg:hidden text-ink-2 p-1" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <FilterBar />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="primary" onClick={() => editor.open(null)} title="Add trade (N)">
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              Add trade
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function AccountSwitcher() {
  const app = useApp();
  const pathname = usePathname();
  const active = app.accountId === "all" ? null : app.account;
  const label = app.accountId === "all" ? "All accounts" : active?.name ?? "Select account";
  const balance =
    app.accountId === "all"
      ? app.activeAccounts.reduce((s, a) => s + a.startingBalance, 0) + app.trades.reduce((s, t) => s + t.pnl, 0)
      : (active?.startingBalance ?? 0) + app.trades.reduce((s, t) => s + t.pnl, 0);

  return (
    <Popover
      width={268}
      // The switcher is pinned to the bottom of the sidebar, so a menu opening downwards ran off
      // the window and the account list could not be seen at all. It opens upwards instead.
      side="top"
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          className={`w-full flex items-center gap-2 h-11 px-2.5 rounded-sm border text-left transition-colors ${
            open ? "border-accent/60 bg-hover" : "border-line hover:bg-hover"
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] truncate">{label}</div>
            <div className="text-[11px] text-ink-3 truncate">
              <span className="tnum">{money(balance, app.currency, { compact: true })}</span>
              {active && <span> · {ACCOUNT_TYPE_LABEL[active.type]}</span>}
            </div>
          </div>
          <svg width="10" height="10" viewBox="0 0 10 10" className="text-ink-3 shrink-0">
            <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    >
      {(close) => (
        <div className="py-1">
          <div className="px-3 pt-1 pb-1 text-[10px] font-medium uppercase tracking-[0.09em] text-ink-3">
            Switch account
          </div>
          {ACCOUNT_GROUPS.map((group) => {
            const members = app.activeAccounts.filter((a) => a.type === group.type);
            if (!members.length) return null;
            return (
              <div key={group.type}>
                <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-ink-3">{group.label}</div>
                {members.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      app.setAccountId(a.id);
                      close();
                    }}
                    className={`w-full text-left pl-4 pr-3 py-1.5 text-[12.5px] hover:bg-hover flex items-center justify-between gap-2 ${
                      a.id === app.accountId ? "text-ink" : "text-ink-2"
                    }`}
                  >
                    <span className="truncate">{a.name}</span>
                    {a.id === app.accountId && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-hidden />
                    )}
                  </button>
                ))}
              </div>
            );
          })}
          <button
            onClick={() => {
              app.setAccountId("all");
              close();
            }}
            className={`w-full text-left pl-4 pr-3 py-1.5 text-[12.5px] hover:bg-hover ${
              app.accountId === "all" ? "text-ink" : "text-ink-2"
            }`}
          >
            All accounts
          </button>

          <hr className="rule my-1.5" />

          {/* Replay is set apart from the ordinary links because it behaves differently: it takes
              over the window. Making it look like the other rows would misrepresent that. */}
          <Link
            href="/replay"
            onClick={close}
            className="flex items-center gap-2.5 mx-1 px-2.5 py-2 rounded-sm border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/70 transition-colors"
          >
            <span className="text-accent shrink-0">
              <NavIcon d="M3 3.5l8 4.5-8 4.5zM13 3v10" />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] text-ink">Replay mode</span>
              <span className="block text-[11px] text-ink-3">Step bars and backtest by hand</span>
            </span>
          </Link>

          <hr className="rule my-1.5" />

          <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.09em] text-ink-3">Go to</div>
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              onClick={close}
              className={`flex items-center gap-2.5 px-3 py-1.5 hover:bg-hover transition-colors ${
                pathname.startsWith(s.href) && s.href !== "/" ? "text-ink" : "text-ink-2"
              }`}
            >
              <span className="text-ink-3 shrink-0">
                <NavIcon d={s.icon} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] truncate">{s.label}</span>
                <span className="block text-[11px] text-ink-3 truncate">{s.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      {/* More air above the rule than below it, and a heavier title. A cramped header is the
          difference between a page that looks composed and one that looks assembled. */}
      <div className="flex items-end justify-between gap-4 pb-3.5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold tracking-[-0.022em] truncate">{title}</h1>
          {meta && <div className="text-[12px] text-ink-3 mt-1">{meta}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <hr className="rule" />
    </div>
  );
}

export function Page({ children }: { children: React.ReactNode }) {
  return <div className="p-4 sm:p-5 max-w-[1600px] mx-auto anim-fade">{children}</div>;
}
