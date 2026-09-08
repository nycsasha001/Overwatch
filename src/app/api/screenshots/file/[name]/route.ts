import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "@/lib/db";
import { requireScope } from "@/lib/current-user";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Serve one uploaded screenshot.
 *
 * Two things stop this being a way to read other people's files. The directory is resolved from the
 * *session*, never from anything in the URL, so the worst a caller can do by guessing filenames is
 * name a file inside their own folder. And the filename is restricted to a plain generated name
 * before it is joined, so it cannot climb out of that folder.
 *
 * Every failure returns the same 404. A 403 here would confirm that a given filename exists in
 * somebody else's account, which is exactly the fact worth keeping quiet.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const auth = await requireScope();
  if (!auth) return new Response("Not found", { status: 404 });

  const { name } = await ctx.params;
  // Reject anything that is not a plain generated filename (blocks path traversal).
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.includes("..")) return new Response("Not found", { status: 404 });

  const dir = uploadDir(auth.scope);
  const full = path.join(dir, name);
  // Belt and braces: the regex above already forbids separators, but the containment check is what
  // makes that a guarantee rather than a property of the regex being right.
  if (!full.startsWith(dir + path.sep)) return new Response("Not found", { status: 404 });

  try {
    const buf = await fs.readFile(full);
    const mime = MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=31536000, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
