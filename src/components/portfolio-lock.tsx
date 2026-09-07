"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Panel, Spinner } from "./ui";
import { Page, PageHeader } from "./shell";
import { api } from "@/lib/client";

/**
 * A second password in front of the Portfolio page.
 *
 * Wraps the page rather than living inside it, so there is one place that decides whether your
 * holdings are on screen. The real enforcement is in middleware — every `/api/portfolio` route
 * answers 423 while locked — and this is the part you actually interact with. A gate implemented
 * only here would be decorative: anyone could type the API URL and read the JSON.
 *
 * "Click out and back means type it again" is made true by locking on the way out, not by hoping
 * a timer expires. Three things can take you away from the page, and all three are covered:
 * navigating within the app (unmount), closing or reloading the tab (`pagehide`), and switching to
 * another app or tab (`visibilitychange`).
 */

export function PortfolioLock({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ enabled: boolean; unlocked: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Read by the unload handlers, which are registered once and must not close over a stale value.
  const enabledRef = useRef(false);

  useEffect(() => {
    let live = true;
    api
      .portfolioLockState()
      .then((s) => {
        if (!live) return;
        setState(s);
        enabledRef.current = s.enabled;
      })
      // A failure here must not leave the page blank forever. Treating it as "no lock configured"
      // is safe because the API is gated independently — an actually-locked portfolio still
      // refuses to hand over any data.
      .catch(() => live && setState({ enabled: false, unlocked: true }));
    return () => {
      live = false;
    };
  }, []);

  /**
   * Lock on the way out.
   *
   * `keepalive` matters: a plain fetch started during unload is cancelled when the page goes away,
   * so the cookie would survive exactly the case this exists to handle.
   */
  const lock = useCallback(() => {
    if (!enabledRef.current) return;
    try {
      fetch("/api/portfolio-lock/lock", { method: "POST", keepalive: true }).catch(() => {});
    } catch {
      // Nothing useful to do while the page is being torn down.
    }
  }, []);

  useEffect(() => {
    const onHide = () => lock();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") lock();
    };
    // pagehide rather than beforeunload: it fires for back/forward navigation and mobile app
    // switches, where beforeunload does not.
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      // Navigating to another page in the app unmounts this, which is the ordinary "clicked out" case.
      lock();
    };
  }, [lock]);

  useEffect(() => {
    if (state?.enabled && !state.unlocked) inputRef.current?.focus();
  }, [state]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password) return;
    setChecking(true);
    setError(null);
    try {
      await api.unlockPortfolio(password);
      setPassword("");
      setState({ enabled: true, unlocked: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That password is not right.");
      setPassword("");
      inputRef.current?.focus();
    } finally {
      setChecking(false);
    }
  };

  if (state === null) {
    return (
      <Page>
        <div className="py-20 flex justify-center">
          <Spinner />
        </div>
      </Page>
    );
  }

  if (!state.enabled || state.unlocked) return <>{children}</>;

  return (
    <Page>
      <PageHeader title="Portfolio" meta="Locked" />
      <Panel>
        <div className="max-w-[340px] mx-auto py-10 text-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="mx-auto mb-4 text-ink-3">
            <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 11V8a4 4 0 118 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>

          <div className="text-title font-medium mb-1">This page is locked</div>
          <p className="text-body text-ink-3 leading-relaxed mb-5">
            Enter the portfolio password. It locks again as soon as you leave the page.
          </p>

          <form onSubmit={submit} className="grid gap-2.5">
            <Input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Portfolio password"
              autoComplete="off"
              className="text-center"
            />
            <Button type="submit" variant="primary" size="md" disabled={checking || !password}>
              {checking ? "Checking…" : "Unlock"}
            </Button>
          </form>

          {error && <div className="text-body text-neg mt-3">{error}</div>}
        </div>
      </Panel>
    </Page>
  );
}
