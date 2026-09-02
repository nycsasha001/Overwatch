import { NextRequest, NextResponse } from "next/server";
import type { ScreenshotPhase } from "@/lib/types";
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR, addScreenshot, getTrade, uid } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const tradeId = String(form.get("tradeId") ?? "");
  const phase = String(form.get("phase") ?? "trade");
  const caption = form.get("caption") ? String(form.get("caption")) : null;
  const file = form.get("file");

  if (!tradeId || !getTrade(tradeId)) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!["trade", "before", "during", "after"].includes(phase)) return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "Only PNG, JPEG, WebP or GIF images are supported" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image exceeds the 12 MB limit" }, { status: 400 });

  const filename = `${uid("img")}${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buf);
  const shot = addScreenshot({ tradeId, phase: phase as ScreenshotPhase, filename, mime: file.type, caption });
  return NextResponse.json(shot, { status: 201 });
}
