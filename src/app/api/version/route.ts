import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Which build is running.
 *
 * Deliberately outside the password gate, because it answers the one question you cannot ask a
 * gated app from outside: did my deploy actually land? Every page and every other route returns
 * 401 to a stranger, which is correct — and which also makes a new build indistinguishable from
 * the old one without opening the host's dashboard.
 *
 * Nothing here is a secret. A commit hash for a private repository reveals no code, names no
 * environment variable and grants no access; it is the same forty characters already printed in
 * the deploy log. Nothing about the password state, the data, or any key is reported — if you are
 * tempted to add a field here, remember this response is world-readable.
 *
 * `RAILWAY_GIT_COMMIT_SHA` is injected by Railway at runtime with no configuration. `GIT_SHA` is
 * the fallback for anywhere else: pass it as a build argument or an environment variable. Null
 * rather than a guess when neither exists — a wrong SHA is worse than an absent one, because it
 * would be believed.
 */
export async function GET() {
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || process.env.GIT_SHA?.trim() || null;

  return NextResponse.json(
    {
      commit,
      short: commit ? commit.slice(0, 7) : null,
      branch: process.env.RAILWAY_GIT_BRANCH?.trim() || null,
      // When this container last started, which is what tells you a redeploy happened at all.
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    },
    // Never cached: a stale answer to "what is running right now" is the one useless answer.
    { headers: { "cache-control": "no-store" } }
  );
}
