import { NextRequest, NextResponse } from "next/server";
import { isAccountType } from "@/lib/types";
import { createAccount, listAccounts } from "@/lib/db";
import { jsonError } from "@/lib/validate";
import { requireScope, unauthorized } from "@/lib/current-user";

const nullableNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  return NextResponse.json(listAccounts(u));
}

export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  try {
    const b = await req.json();
    const name = String(b.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Account name is required" }, { status: 400 });
    const sb = Number(b.startingBalance);
    const acc = createAccount(u, {
      name,
      type: isAccountType(b.type) ? b.type : "personal",
      startingBalance: Number.isFinite(sb) ? sb : 0,
      currency: String(b.currency ?? "USD"),
      defaultRiskPct: nullableNumber(b.defaultRiskPct),
      archived: 0,
      profitTarget: nullableNumber(b.profitTarget),
      maxDrawdown: nullableNumber(b.maxDrawdown),
      drawdownType: b.drawdownType === "trailing" ? "trailing" : "static",
      dailyLossLimit: nullableNumber(b.dailyLossLimit),
    });
    return NextResponse.json(acc, { status: 201 });
  } catch (e) {
    const { error, status } = jsonError(e);
    return NextResponse.json({ error }, { status });
  }
}
