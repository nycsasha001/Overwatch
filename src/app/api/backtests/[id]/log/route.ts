import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { engineRunsDir } from "@/lib/db";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

const MAX = 20000;

/** The tail of a background run's output, so a failure can be read without opening a terminal. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireScope();
  if (!auth) return unauthorized();

  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  // Resolved from the session, never from the URL: an id belonging to someone else names a file
  // in their directory, which this path cannot reach.
  const dir = engineRunsDir(auth.scope);
  const file = path.join(dir, `${id}.log`);
  if (!file.startsWith(dir + path.sep)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  try {
    const text = fs.readFileSync(file, "utf8");
    const stat = fs.statSync(file);
    return NextResponse.json({ log: text.slice(-MAX), bytes: stat.size, updatedAt: stat.mtime.toISOString() });
  } catch {
    return NextResponse.json({ log: "", bytes: 0, updatedAt: null, note: "No output yet." });
  }
}
