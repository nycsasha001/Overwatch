import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "@/lib/db";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  // Reject anything that is not a plain generated filename (blocks path traversal).
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.includes("..")) return new Response("Not found", { status: 404 });
  const full = path.join(UPLOAD_DIR, name);
  if (!full.startsWith(UPLOAD_DIR)) return new Response("Not found", { status: 404 });
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
