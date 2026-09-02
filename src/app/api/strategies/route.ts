import { NextRequest, NextResponse } from "next/server";
import { createStrategy, listStrategies } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listStrategies());
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Strategy name is required" }, { status: 400 });
  return NextResponse.json(createStrategy(name, b.description ? String(b.description) : null), { status: 201 });
}
