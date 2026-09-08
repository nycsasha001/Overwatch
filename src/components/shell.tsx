"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedInAs } from "./signed-in-as";
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
  // Long-term holdings, not trading. It sits in the menu rather than the rail because it is a
  // different question from the day's execution — and because a page that can be separately
  // password-locked should not be one click away from every screen.
  { href: "/portfolio", label: "Portfolio", hint: "Long-term holdings and value", icon: "M2.5 5h11v8h-11zM2.5 7.5h11M6 5V3.5h4V5" },
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
      // Not in portfolio mode: there is no trade to add, and it would yank you into an editor for
      // a different part of the app.
      if (pathname.startsWith("/portfolio")) return;
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && app.accounts.length) {
        e.preventDefault();
        editor.open(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, app.accounts.length, pathname]);

  /**
   * The login screen is not part of the app.
   *
   * Everything below assumes a signed-in session: the shell asks for the journal, and when that
   * request comes back 401 it reports "cannot reach the local database" — which is a lie, and the
   * first thing you see after setting a password. The login route renders on its own.
   */
  if (pathname === "/login" || pathname === "/account") return <>{children}</>;

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
          <h1 className="text-section font-medium">Cannot reach the local database</h1>
          <p className="text-ui text-ink-3 mt-2 leading-relaxed">{app.error}</p>
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

  /**
   * Portfolio is its own mode too, though a gentler one than replay.
   *
   * It keeps the frame — you still need a way back — but everything belonging to the trading
   * journal comes off: the four rail links, the account and date filters, and the Add trade button.
   * None of them mean anything here. Long-term holdings and today's executions are different
   * questions, and a rail offering Calendar and Analytics next to your net worth invites you to
   * read one as commentary on the other.
   */
  const portfolioMode = pathname.startsWith("/portfolio");

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`fixed lg:static z-40 h-full w-[204px] shrink-0 bg-surface border-r border-line flex flex-col transition-transform duration-150 ${
          navOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* The wordmark had the product name and its description on one line, at nearly the same
            weight, which read as a sentence rather than a mark. Stacking them lets the name carry
            the weight and the description recede to what it is — a subtitle. */}
        <div className="h-[56px] flex items-center gap-2.5 px-4 border-b border-line-soft">
          <span
            className="w-[22px] h-[22px] rounded-[5px] bg-accent shrink-0 flex items-center justify-center btn-lit"
            aria-hidden
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1.5 8.5L4.5 5l2.5 2.5L10.5 3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="min-w-0 leading-none">
            <span className="display block text-ui font-semibold tracking-[-0.02em]">Overwatch</span>
            <span className="block text-micro text-ink-4 tracking-[0.06em] uppercase mt-[3px]">Trading Journal</span>
          </span>
        </div>

        <nav className="p-2.5 pt-3 flex flex-col gap-[2px]">
          {portfolioMode ? (
            <>
              <div className="flex items-center gap-2.5 h-10 px-3 rounded-sm text-ui bg-hover text-ink font-medium relative">
                <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-accent" aria-hidden />
                <span className="text-ink">
                  <NavIcon d="M2.5 5h11v8h-11zM2.5 7.5h11M6 5V3.5h4V5" />
                </span>
                Portfolio
              </div>
              <Link
                href="/"
                className="flex items-center gap-2.5 h-10 px-3 rounded-sm text-ui text-ink-3 hover:text-ink hover:bg-hover/50 transition-colors mt-1"
              >
                <NavIcon d="M9 3.5L5 8l4 4.5" />
                Back to journal
              </Link>
            </>
          ) : (
          NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`relative flex items-center gap-2.5 h-10 px-3 rounded-sm text-ui transition-colors ${
                  active ? "bg-hover text-ink font-medium" : "text-ink-3 hover:text-ink hover:bg-hover/50"
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
          }))}
        </nav>

        {/* The account switcher shows a trading balance and a list of prop accounts. Neither
            belongs beside your holdings, and on a page you can password-lock it would rather
            defeat the point. "Back to journal" is the way out; everything else is one click
            further from there. */}
        {!portfolioMode && (
          <div className="mt-auto p-3 border-t border-line-soft">
            <AccountSwitcher />
          </div>
        )}

        {/* Whose journal this is, and how to leave it. Pinned to the bottom on every page,
            including the portfolio, because "which account am I in" is a question you want
            answered wherever you are rather than only on the pages with a sidebar footer. */}
        <div className={portfolioMode ? "mt-auto" : ""}>
          <SignedInAs />
        </div>
      </aside>

      {navOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setNavOpen(false)} />}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[56px] shrink-0 border-b border-line flex items-center gap-3 px-3 sm:px-5 bg-surface">
          <button className="lg:hidden text-ink-2 p-1" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          {portfolioMode ? (
            // No account filter and no Add trade: neither does anything to a portfolio, and an
            // account selector sitting above holdings that ignore it is worse than no selector.
            <span className="text-body text-ink-3">Investments</span>
          ) : (
            <>
              <FilterBar />
              <div className="ml-auto flex items-center gap-2">
                <Button variant="primary" onClick={() => editor.open(null)} title="Add trade (N)">
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  Add trade
                </Button>
              </div>
            </>
          )}
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
            <div className="text-body truncate">{label}</div>
            <div className="text-caption text-ink-3 truncate">
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
          <div className="px-3 pt-1 pb-1 eyebrow">
            Switch account
          </div>
          {ACCOUNT_GROUPS.map((group) => {
            const members = app.activeAccounts.filter((a) => a.type === group.type);
            if (!members.length) return null;
            return (
              <div key={group.type}>
                <div className="px-3 pt-1.5 pb-0.5 text-micro text-ink-3">{group.label}</div>
                {members.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      app.setAccountId(a.id);
                      close();
                    }}
                    className={`w-full text-left pl-4 pr-3 py-1.5 text-body hover:bg-hover flex items-center justify-between gap-2 ${
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
            className={`w-full text-left pl-4 pr-3 py-1.5 text-body hover:bg-hover ${
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
              <span className="block text-body text-ink">Replay mode</span>
              <span className="block text-caption text-ink-3">Step bars and backtest by hand</span>
            </span>
          </Link>

          <hr className="rule my-1.5" />

          <div className="px-3 pb-1 eyebrow">Go to</div>
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
                <span className="block text-body truncate">{s.label}</span>
                <span className="block text-caption text-ink-3 truncate">{s.hint}</span>
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
    <div className="mb-6">
      {/* More air above the rule than below it, and a heavier title. A cramped header is the
          difference between a page that looks composed and one that looks assembled. */}
      <div className="flex items-end justify-between gap-4 pb-4">
        <div className="min-w-0">
          <h1 className="text-page font-semibold tracking-[-0.024em] truncate leading-none">{title}</h1>
          {meta && <div className="text-caption text-ink-3 mt-2">{meta}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <hr className="rule" />
    </div>
  );
}

export function Page({ children }: { children: React.ReactNode }) {
  // Wider gutters and a slightly narrower measure. Content running to the edge of a large display
  // is what makes a dense app feel like a spreadsheet; the margin is doing real work.
  return <div className="px-5 sm:px-7 py-6 max-w-[1560px] mx-auto anim-fade">{children}</div>;
}
