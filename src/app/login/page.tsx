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
      // Replace, not push: the login screen should not be somewhere Back can return to.
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
      // The gate is in middleware, so the new cookie only takes effect on a fresh request.
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-[300px]">
        <h1 className="display text-[19px] tracking-tight">Overwatch</h1>
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

        {error && <p className="text-[12px] text-neg mt-2">{error}</p>}

        <button
          type="submit"
          disabled={busy || !password}
          className="btn-lit w-full mt-3 h-8 rounded-sm bg-accent text-ink text-[13px] font-medium disabled:opacity-40"
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
