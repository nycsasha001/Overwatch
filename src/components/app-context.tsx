"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { api, Bootstrap } from "@/lib/client";
import { Account, DEFAULT_SETTINGS, Settings, Setup, Strategy, Trade } from "@/lib/types";

interface AppValue {
  loading: boolean;
  error: string | null;
  accounts: Account[];
  activeAccounts: Account[];
  settings: Settings;
  strategies: Strategy[];
  setups: Setup[];
  trades: Trade[];
  accountId: string; // account id or "all"
  account: Account | null;
  startingBalance: number;
  currency: string;
  setAccountId: (id: string) => void;
  refresh: () => Promise<void>;
  patchSettings: (s: Partial<Settings>) => Promise<void>;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}

const STORAGE_KEY = "tj.accountId";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Bootstrap>({ accounts: [], settings: DEFAULT_SETTINGS, strategies: [], setups: [], trades: [] });
  const [accountId, setAccountIdRaw] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    try {
      const data = await api.bootstrap(id || "all");
      setState(data);
      setError(null);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the local server");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Nothing is fetched until there is a session to fetch it with.
   *
   * On the login screen every request comes back 401, and the provider has no way to tell that
   * apart from a real failure — so it reported the journal as unreachable. Not asking is the
   * honest fix; the answer to "what is in the journal" is genuinely unknown until you sign in.
   */
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === "/login") {
      setLoading(false);
      return;
    }
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const initial = stored ?? "";
    (async () => {
      const data = await load(initial);
      if (!data) return;
      const valid = initial === "all" || data.accounts.some((a) => a.id === initial);
      const next = valid ? initial : data.settings.defaultAccountId ?? data.accounts[0]?.id ?? "";
      setAccountIdRaw(next);
      if (next !== initial) await load(next);
    })();
  }, [load, pathname]);

  const setAccountId = useCallback(
    (id: string) => {
      setAccountIdRaw(id);
      window.localStorage.setItem(STORAGE_KEY, id);
      setLoading(true);
      void load(id);
    },
    [load]
  );

  const refresh = useCallback(async () => {
    await load(accountId);
  }, [load, accountId]);

  const patchSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await api.saveSettings({ ...state.settings, ...patch } as Settings);
      setState((s) => ({ ...s, settings: next }));
    },
    [state.settings]
  );

  const value = useMemo<AppValue>(() => {
    const account = state.accounts.find((a) => a.id === accountId) ?? null;
    const activeAccounts = state.accounts.filter((a) => !a.archived);
    const startingBalance =
      accountId === "all" ? activeAccounts.reduce((s, a) => s + a.startingBalance, 0) : account?.startingBalance ?? 0;
    return {
      loading,
      error,
      accounts: state.accounts,
      activeAccounts,
      settings: state.settings,
      strategies: state.strategies,
      setups: state.setups,
      trades: state.trades,
      accountId,
      account,
      startingBalance,
      currency: account?.currency ?? state.settings.currency,
      setAccountId,
      refresh,
      patchSettings,
    };
  }, [state, accountId, loading, error, setAccountId, refresh, patchSettings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
