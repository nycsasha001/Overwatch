import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getSettings());
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const current = getSettings();
  const next = {
    ...current,
    ...body,
    classification: { ...DEFAULT_SETTINGS.classification, ...current.classification, ...(body.classification ?? {}) },
  };
  return NextResponse.json(saveSettings(next));
}
