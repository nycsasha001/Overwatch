import { Account, Backtest, Screenshot, Settings, Setup, Strategy, Trade } from "./types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  /**
   * A session that has expired sends you back to the login screen.
   *
   * The gate lives in middleware, so an expired cookie turns every request into a 401 while the
   * page carries on looking signed in. Without this the app just stops working, silently, with no
   * indication that signing in again is all it needs.
   */
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/login?next=${encodeURIComponent(here)}`;
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
};
