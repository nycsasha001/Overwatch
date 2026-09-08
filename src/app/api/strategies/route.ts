import { NextRequest, NextResponse } from "next/server";
import { createStrategy, listStrategies } from "@/lib/db";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  return NextResponse.json(listStrategies(u));
}

export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const b = await req.json();
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Strategy name is required" }, { status: 400 });
  return NextResponse.json(createStrategy(u, name, b.description ? String(b.description) : null), { status: 201 });
}
