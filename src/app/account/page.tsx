"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * The second door.
 *
 * Reached only after the shared password, and deliberately built to look like the screen before it:
 * same width, same rule under the wordmark, same field and button styles. Two gates in a row that
 * looked like two different apps would read as something having gone wrong.
 *
 * Nothing typed here is kept anywhere but these fields. The password is posted and the state is
 * cleared on failure.
 */
type Mode = "login" | "signup";

function AccountForms() {
  const params = useSearchParams();

  const [mode, setMode] = useState<Mode>("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setField(null);
    setPassword("");
    setConfirm("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setField(null);

    const url = mode === "login" ? "/api/account/login" : "/api/account/signup";
    const body =
      mode === "login" ? { identifier, password } : { username, email, password, confirm };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? "Could not sign in.");
        setField(payload.field ?? null);
        setPassword("");
        setConfirm("");
        return;
      }
      const next = params.get("next");
      const target = next && next.startsWith("/") ? next : "/";
      // A full load, for the same reason as the shared-password screen: middleware decides this,
      // and only a fresh server request carries the new cookie. See src/app/login/page.tsx.
      window.location.replace(target);
      return;
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    mode === "login"
      ? identifier.length > 0 && password.length > 0
      : username.length > 0 && email.length > 0 && password.length > 0 && confirm.length > 0;

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <form onSubmit={submit} className="w-full max-w-[300px]">
        <h1 className="display text-page tracking-tight">Overwatch</h1>
        <hr className="rule my-3" />

        {/* Two tabs rather than two pages: switching should not cost a navigation or lose what
            has already been typed into the shared fields. */}
        <div className="flex gap-1 mb-4" role="tablist">
          {(["login", "signup"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchTo(m)}
              className={`flex-1 h-7 rounded-sm text-ui transition-colors ${
                mode === m ? "bg-accent text-ink font-medium" : "border border-[var(--rule)] opacity-70 hover:opacity-100"
              }`}
            >
              {m === "login" ? "Log in" : "Create account"}
            </button>
          ))}
        </div>

        {mode === "signup" && (
          <>
            <label className="label" htmlFor="username">
              Display name
            </label>
            <input
              id="username"
              name="username"
              autoFocus
              autoComplete="nickname"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="field"
              disabled={busy}
              aria-invalid={field === "username"}
            />
          </>
        )}

        {mode === "signup" ? (
          <>
            <label className="label mt-3" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              disabled={busy}
              aria-invalid={field === "email"}
            />
          </>
        ) : (
          <>
            <label className="label" htmlFor="identifier">
              Email or display name
            </label>
            <input
              id="identifier"
              name="identifier"
              autoFocus
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="field"
              disabled={busy}
              aria-invalid={field === "identifier"}
            />
          </>
        )}

        <label className="label mt-3" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field"
          disabled={busy}
          aria-invalid={field === "password"}
        />
        {mode === "signup" && !error && (
          <p className="text-body opacity-50 mt-1">At least 10 characters.</p>
        )}

        {mode === "signup" && (
          <>
            <label className="label mt-3" htmlFor="confirm">
              Confirm password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="field"
              disabled={busy}
              aria-invalid={field === "confirm"}
            />
          </>
        )}

        {error && (
          <p className="text-body text-neg mt-2" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !canSubmit}
          className="btn-lit w-full mt-4 h-8 rounded-sm bg-accent text-ink text-ui font-medium disabled:opacity-40"
        >
          {busy ? "Working…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
}

export default function AccountPage() {
  // useSearchParams needs a Suspense boundary, or the route opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <AccountForms />
    </Suspense>
  );
}
