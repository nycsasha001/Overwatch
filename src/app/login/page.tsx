"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * The one screen reachable without a session.
 *
 * The password goes straight to the server and is never held anywhere but this field — no local
 * storage, no query string, nothing that survives the submit.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not sign in.");
        setPassword("");
        return;
      }
      const next = params.get("next");
      const target = next && next.startsWith("/") ? next : "/";
      /*
       * A full page load, not router.replace().
       *
       * The gate is in middleware, so the new cookie only counts on a fresh request to the server.
       * The client router cannot give one reliably here: replace() starts fetching the destination
       * while refresh() re-fetches the route you are still on, and the refresh wins — the login
       * screen re-renders and the completed navigation is thrown away, which looks exactly like the
       * password having been rejected. location.assign leaves the router out of it: one request,
       * middleware runs against the new cookie, nothing cached to race.
       *
       * It also replaces the history entry, so Back does not return to the login screen.
       */
      window.location.replace(target);
      return;
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-[300px]">
        <h1 className="display text-page tracking-tight">Overwatch</h1>
        <hr className="rule my-3" />

        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field"
          disabled={busy}
        />

        {error && <p className="text-body text-neg mt-2">{error}</p>}

        <button
          type="submit"
          disabled={busy || !password}
          className="btn-lit w-full mt-3 h-8 rounded-sm bg-accent text-ink text-ui font-medium disabled:opacity-40"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary, or the whole route opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
