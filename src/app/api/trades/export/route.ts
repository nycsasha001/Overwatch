import { NextRequest } from "next/server";
import { listTrades } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

const HEADERS = [
  "date","time","instrument","direction","session","strategy","setup","entry","stop","target","exit","size",
  "riskAmount","riskPct","result","pnl","rMultiple","mae","mfe","fees","htfSweep","sweep4h","sweep1h","sweep15m",
  "sessionSweep","mss","fvg","orderBlock","displacement","pdArray","entryModel","liquidityTarget","tags",
  "thesis","execution","review","mistakes","emotions",
];

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
  const rows: (string | number | null)[][] = [HEADERS];
  for (const t of trades) {
    const rec = t as unknown as Record<string, unknown>;
    rows.push(
      HEADERS.map((h) => {
        const v = rec[h];
        if (Array.isArray(v)) return v.join("|");
        if (v === null || v === undefined) return "";
        return v as string | number;
      })
    );
  }
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trades-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
