import { NextRequest, NextResponse } from "next/server";
import { isAccountType } from "@/lib/types";
import { createAccount, listAccounts } from "@/lib/db";
import { jsonError } from "@/lib/validate";

const nullableNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listAccounts());
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const name = String(b.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Account name is required" }, { status: 400 });
    const sb = Number(b.startingBalance);
    const acc = createAccount({
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
