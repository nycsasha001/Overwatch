import type { ReplaySession } from "./replay-session";
import { Account, Backtest, PortfolioHolding, PortfolioTransaction, Screenshot, Settings, Setup, Strategy, Trade, WatchlistItem } from "./types";
import type { Quote } from "./portfolio";
import type { SymbolInfo } from "./symbols";
import type { PortfolioState } from "./portfolio-server";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  /**
   * A session that has expired sends you back to whichever gate can renew it.
   *
   * The gates live in middleware, so an expired cookie turns every request into a 401 while the
   * page carries on looking signed in. Without this the app just stops working, silently, with no
   * indication that signing in again is all it needs.
   *
   * *Which* gate matters. There are two, both answering 401: the shared password (`/login`) and the
   * account (`/account`). Sending an account-level 401 to `/login` is a loop — the shared password
   * is already satisfied, so the login screen bounces straight back to `/account`, whose first
   * request 401s again. The `code` on the response says which one is unsatisfied; the pathname
   * checks stop either gate from redirecting to itself while its own page is loading.
   */
  if (res.status === 401 && typeof window !== "undefined") {
    const path = window.location.pathname;
    const gate = data?.code === "account_session" ? "/account" : "/login";
    if (path !== "/login" && path !== "/account") {
      const here = `${path}${window.location.search}`;
      window.location.href = `${gate}?next=${encodeURIComponent(here)}`;
    }
  }

  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

export interface Bootstrap {
  accounts: Account[];
  settings: Settings;
  strategies: Strategy[];
  setups: Setup[];
  trades: Trade[];
}

export const api = {
  bootstrap: (accountId: string) => req<Bootstrap>(`/api/bootstrap?accountId=${encodeURIComponent(accountId)}`),

  createAccount: (a: Partial<Account>) => req<Account>("/api/accounts", { method: "POST", body: JSON.stringify(a) }),
  updateAccount: (id: string, a: Partial<Account>) => req<Account>(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(a) }),
  deleteAccount: (id: string) => req<{ ok: true }>(`/api/accounts/${id}`, { method: "DELETE" }),

  createTrade: (t: Record<string, unknown>) => req<Trade>("/api/trades", { method: "POST", body: JSON.stringify(t) }),
  updateTrade: (id: string, t: Record<string, unknown>) => req<Trade>(`/api/trades/${id}`, { method: "PUT", body: JSON.stringify(t) }),
  deleteTrade: (id: string) => req<{ ok: true }>(`/api/trades/${id}`, { method: "DELETE" }),
  duplicateTrade: (id: string) => req<Trade>(`/api/trades/${id}/duplicate`, { method: "POST" }),
  importTrades: (accountId: string, trades: Record<string, unknown>[]) =>
    req<{ imported: number; skipped: number; errors: { row: number; message: string }[] }>("/api/trades/import", {
      method: "POST",
      body: JSON.stringify({ accountId, trades }),
    }),

  saveSettings: (s: Settings) => req<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),

  createStrategy: (name: string, description: string | null) =>
    req<Strategy>("/api/strategies", { method: "POST", body: JSON.stringify({ name, description }) }),
  deleteStrategy: (id: string) => req<{ ok: true }>(`/api/strategies/${id}`, { method: "DELETE" }),
  createSetup: (name: string) => req<Setup>("/api/setups", { method: "POST", body: JSON.stringify({ name }) }),
  deleteSetup: (id: string) => req<{ ok: true }>(`/api/setups/${id}`, { method: "DELETE" }),

  uploadScreenshot: (tradeId: string, phase: string, file: File) => {
    const fd = new FormData();
    fd.append("tradeId", tradeId);
    fd.append("phase", phase);
    fd.append("file", file);
    return req<Screenshot>("/api/screenshots", { method: "POST", body: fd });
  },
  deleteScreenshot: (id: string) => req<{ ok: true }>(`/api/screenshots/${id}`, { method: "DELETE" }),

  listBacktests: () => req<Backtest[]>("/api/backtests"),
  createBacktest: (b: Partial<Backtest>) => req<Backtest>("/api/backtests", { method: "POST", body: JSON.stringify(b) }),
  deleteBacktest: (id: string) => req<{ ok: true }>(`/api/backtests/${id}`, { method: "DELETE" }),
  importBacktests: (payload: unknown) =>
    req<{ imported: number; skipped: string[]; errors: string[] }>("/api/backtests/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /* --------------------------------- portfolio -------------------------------- */

  portfolio: (force = false) => req<PortfolioState>(`/api/portfolio${force ? "?refresh=1" : ""}`),
  addHolding: (h: Record<string, unknown>) => req<PortfolioHolding>("/api/portfolio/holdings", { method: "POST", body: JSON.stringify(h) }),
  updateHolding: (id: string, h: Record<string, unknown>) =>
    req<{ holding: PortfolioHolding; previous: PortfolioHolding }>(`/api/portfolio/holdings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(h),
    }),
  // Returns the deleted holding and its transactions, so it can be put back.
  deleteHolding: (id: string) =>
    req<{ ok: true; holding: PortfolioHolding; transactions: PortfolioTransaction[] }>(`/api/portfolio/holdings/${id}`, {
      method: "DELETE",
    }),
  restoreHolding: (holding: PortfolioHolding, transactions: PortfolioTransaction[]) =>
    req<{ ok: true }>("/api/portfolio/restore", { method: "POST", body: JSON.stringify({ holding, transactions }) }),
  restoreBundle: (bundle: unknown) =>
    req<{ ok: true }>("/api/portfolio/restore", { method: "POST", body: JSON.stringify({ bundle }) }),

  /* ----------------------------- replay sessions ---------------------------- */

  listReplaySessions: (symbol?: string) =>
    req<{ sessions: ReplaySession[] }>(`/api/replay/sessions${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`),
  saveReplaySession: (s: Record<string, unknown>) =>
    req<{ session: ReplaySession }>("/api/replay/sessions", { method: "POST", body: JSON.stringify(s) }),
  deleteReplaySession: (id: string) =>
    req<{ ok: true; session: ReplaySession }>(`/api/replay/sessions/${id}`, { method: "DELETE" }),

  rebaselinePortfolio: () =>
    req<{ ok: true; total: number; ts: number; removed: unknown }>("/api/portfolio/rebaseline", { method: "POST" }),

  resetPreview: () =>
    req<{ holdings: number; transactions: number; snapshots: number; watchlist: number; cash: number }>("/api/portfolio/reset"),
  portfolioLockState: () => req<{ enabled: boolean; unlocked: boolean }>("/api/portfolio-lock/state"),
  unlockPortfolio: (password: string) =>
    req<{ ok: true }>("/api/portfolio-lock/unlock", { method: "POST", body: JSON.stringify({ password }) }),
  lockPortfolio: () => req<{ ok: true }>("/api/portfolio-lock/lock", { method: "POST" }),

  resetPortfolio: (parts: { holdings: boolean; history: boolean; cash: boolean; watchlist: boolean }) =>
    req<{ ok: true; removed: unknown }>("/api/portfolio/reset", { method: "POST", body: JSON.stringify(parts) }),
  listTransactions: (symbol?: string) =>
    req<PortfolioTransaction[]>(`/api/portfolio/transactions${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`),
  addTransaction: (t: Record<string, unknown>) =>
    req<{ transaction: PortfolioTransaction; holding: PortfolioHolding | null }>("/api/portfolio/transactions", {
      method: "POST",
      body: JSON.stringify(t),
    }),
  deleteTransaction: (id: string) => req<{ ok: true }>(`/api/portfolio/transactions/${id}`, { method: "DELETE" }),
  saveCash: (cash: number) => req<{ cash: number }>("/api/portfolio/cash", { method: "PUT", body: JSON.stringify({ cash }) }),

  searchSymbols: (q: string) => req<{ groups: string[]; results: SymbolInfo[] }>(`/api/portfolio/symbols?q=${encodeURIComponent(q)}`),
  quote: (symbol: string) => req<{ symbol: string; quote: Quote | null; pricingEnabled: boolean }>(`/api/portfolio/quote?symbol=${encodeURIComponent(symbol)}`),

  watchlist: () => req<{ items: WatchlistItem[]; quotes: Record<string, Quote> }>("/api/portfolio/watchlist"),
  addWatch: (symbol: string, name?: string | null) =>
    req<WatchlistItem>("/api/portfolio/watchlist", { method: "POST", body: JSON.stringify({ symbol, name }) }),
  removeWatch: (id: string) => req<{ ok: true }>(`/api/portfolio/watchlist/${id}`, { method: "DELETE" }),
};
