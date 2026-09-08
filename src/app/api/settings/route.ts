import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  return NextResponse.json(getSettings(u));
}

export async function PUT(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const body = await req.json();
  const current = getSettings(u);
  const next = {
    ...current,
    ...body,
    classification: { ...DEFAULT_SETTINGS.classification, ...current.classification, ...(body.classification ?? {}) },
  };
  return NextResponse.json(saveSettings(u, next));
}
