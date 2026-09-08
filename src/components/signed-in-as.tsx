"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Who you are, and the way out.
 *
 * Sits under the account switcher, which is a different thing entirely despite the name: that one
 * switches *trading* accounts inside one journal, this one says which *person's* journal is open.
 * Keeping them adjacent but visually separated is deliberate — confusing the two is how someone
 * ends up believing their trades are in a different place than they are.
 *
 * Renders nothing at all when the server has no accounts configured (a development checkout with no
 * AUTH_SECRET), rather than showing a sign-out control that would do nothing.
 */
export function SignedInAs() {
  const router = useRouter();
  const [user, setUser] = useState<{ username: string; email: string } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setUser(data.user);
        setEnabled(!!data.accountsEnabled);
      })
      .catch(() => {
        // The shell must render whether or not this resolves; a failed identity lookup is not worth
        // an error state in the sidebar.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled || !user) return null;

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/account/logout", { method: "POST" });
      // replace, not push: signing out should not leave the app one Back press away.
      router.replace("/account");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3 pb-3 pt-2 border-t border-line-soft flex items-center justify-between gap-2">
      <span className="text-body text-ink-3 truncate" title={user.email}>
        {user.username}
      </span>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="text-body text-ink-3 hover:text-ink transition-colors shrink-0 disabled:opacity-40"
      >
        {busy ? "…" : "Log out"}
      </button>
    </div>
  );
}
