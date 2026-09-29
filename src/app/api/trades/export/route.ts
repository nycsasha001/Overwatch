import { NextRequest } from "next/server";
import { listTrades } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { TRADE_CSV_COLUMNS, csvCell } from "@/lib/trade-export";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;
  const accountId = req.nextUrl.searchParams.get("accountId");
  const ids = req.nextUrl.searchParams.get("ids");
  let trades = listTrades(u, accountId && accountId !== "all" ? accountId : null);
  if (ids) {
    const set = new Set(ids.split(",").filter(Boolean));
    trades = trades.filter((t) => set.has(t.id));
  }
  const rows: (string | number | null)[][] = [[...TRADE_CSV_COLUMNS]];
  for (const t of trades) rows.push(TRADE_CSV_COLUMNS.map((c) => csvCell(t, c)));
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trades-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
