import { NextRequest, NextResponse } from "next/server";
import { createSetup, listSetups } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listSetups());
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Setup name is required" }, { status: 400 });
  return NextResponse.json(createSetup(name), { status: 201 });
}
