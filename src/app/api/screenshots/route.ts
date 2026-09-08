import { NextRequest, NextResponse } from "next/server";
import type { ScreenshotPhase } from "@/lib/types";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadDir, addScreenshot, getTrade, uid } from "@/lib/db";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

const ALLOWED: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const form = await req.formData();
  const tradeId = String(form.get("tradeId") ?? "");
  const phase = String(form.get("phase") ?? "trade");
  const caption = form.get("caption") ? String(form.get("caption")) : null;
  const file = form.get("file");

  if (!tradeId || !getTrade(u, tradeId)) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!["trade", "before", "during", "after"].includes(phase)) return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "Only PNG, JPEG, WebP or GIF images are supported" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image exceeds the 12 MB limit" }, { status: 400 });

  const filename = `${uid("img")}${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.mkdir(uploadDir(u), { recursive: true });
  await fs.writeFile(path.join(uploadDir(u), filename), buf);
  const shot = addScreenshot(u, { tradeId, phase: phase as ScreenshotPhase, filename, mime: file.type, caption });
  return NextResponse.json(shot, { status: 201 });
}
