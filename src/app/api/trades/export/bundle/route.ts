import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getSettings, listAccounts, listTrades, uploadDir } from "@/lib/db";
import { exportBundle } from "@/lib/trade-export";
import { buildZip, type ZipEntry } from "@/lib/zip";
import { isROnly } from "@/lib/account-groups";
import { isoDate } from "@/lib/format";
import { requireScope, unauthorized } from "@/lib/current-user";

export const dynamic = "force-dynamic";

/**
 * The trades in view, as one .zip to hand to someone else to analyse: a report written to be read
 * cold, the same trades as a CSV, and the screenshots. See `exportBundle` for what goes in each.
 *
 * POST rather than GET because the body is a list of trade ids, and a few hundred of those no
 * longer fit in a URL.
 */
export async function POST(req: NextRequest) {
  const auth = await requireScope();
  if (!auth) return unauthorized();
  const u = auth.scope;

  const body = (await req.json().catch(() => ({}))) as { tradeIds?: unknown; filtered?: unknown };
  const ids = new Set(Array.isArray(body.tradeIds) ? body.tradeIds.filter((v): v is string => typeof v === "string") : []);
  const trades = listTrades(u).filter((t) => ids.has(t.id));
  if (!trades.length) return NextResponse.json({ error: "No trades to export." }, { status: 400 });

  const accounts = listAccounts(u);
  const rAccounts = new Set(accounts.filter(isROnly).map((a) => a.id));
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));

  // Only screenshots whose file is still on disk. The report names every picture it lists, and
  // naming one the archive does not contain would send the reader looking for nothing.
  const dir = uploadDir(u);
  const images = new Map<string, Buffer>();
  for (const t of trades) {
    for (const s of t.screenshots ?? []) {
      // The filename comes from the database, but it still must not reach outside the uploads folder.
      if (path.basename(s.filename) !== s.filename) continue;
      try {
        images.set(s.filename, await fs.readFile(path.join(dir, s.filename)));
      } catch {
        /* missing file: left out below */
      }
    }
    t.screenshots = (t.screenshots ?? []).filter((s) => images.has(s.filename));
  }

  const today = isoDate(new Date());
  const bundle = exportBundle(trades, {
    settings: getSettings(u),
    accountNames,
    rOnly: trades.every((t) => rAccounts.has(t.accountId)),
    filtered: body.filtered === true,
    exportedOn: today,
  });

  // One folder inside the zip, so unzipping gives a single tidy folder rather than loose files.
  const names = [...new Set(trades.map((t) => accountNames.get(t.accountId) ?? ""))];
  const slug = (names.length === 1 ? names[0] : "trades").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trades";
  const folder = `overwatch-${slug}-${today}`;
  const entries: ZipEntry[] = [
    { path: `${folder}/report.md`, data: bundle.report },
    { path: `${folder}/trades.csv`, data: bundle.csv },
    ...bundle.screenshots.map((s) => ({ path: `${folder}/${s.path}`, data: images.get(s.filename)! })),
  ];

  return new Response(new Uint8Array(buildZip(entries)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${folder}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
