import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const MAX = 20000;

/** The tail of a background run's output, so a failure can be read without opening a terminal. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const dir = path.join(process.env.TJ_DATA_DIR ?? path.join(process.cwd(), "data"), "engine-runs");
  const file = path.join(dir, `${id}.log`);
  if (!file.startsWith(dir)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  try {
    const text = fs.readFileSync(file, "utf8");
    const stat = fs.statSync(file);
    return NextResponse.json({ log: text.slice(-MAX), bytes: stat.size, updatedAt: stat.mtime.toISOString() });
  } catch {
    return NextResponse.json({ log: "", bytes: 0, updatedAt: null, note: "No output yet." });
  }
}
