import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR, getSettings, getTrade, listAccounts, listTrades } from "@/lib/db";
import { accountFolder, noteName, ownedTradeId, tradeNote } from "@/lib/obsidian";
import type { Trade } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Write trades into an Obsidian vault as markdown notes.
 *
 * The vault path comes from settings rather than from the request. That is the same rule the
 * backtest engine follows: nothing arriving over HTTP gets to choose where this server writes on
 * disk, so a stray call cannot turn into files scattered across a home directory.
 */

async function isVault(dir: string): Promise<boolean> {
  // Every vault has a .obsidian folder. Requiring it means a typo fails loudly instead of quietly
  // creating a new tree of markdown somewhere that was never a vault.
  try {
    const s = await fs.stat(path.join(dir, ".obsidian"));
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** Guard against a folder setting like `../../..` climbing out of the vault. */
function insideVault(vault: string, target: string): boolean {
  const rel = path.relative(vault, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function POST(req: NextRequest) {
  const settings = getSettings();
  const vault = (settings.obsidianVault ?? "").trim();
  const folder = (settings.obsidianFolder ?? "Trades").trim() || "Trades";

  if (!vault) {
    return NextResponse.json(
      { error: "No Obsidian vault set. Add its folder in Settings first." },
      { status: 400 }
    );
  }
  if (!path.isAbsolute(vault)) {
    return NextResponse.json({ error: "The vault path must be absolute." }, { status: 400 });
  }
  if (!(await isVault(vault))) {
    return NextResponse.json(
      { error: `No .obsidian folder in "${vault}" — that does not look like a vault.` },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { tradeIds?: string[]; accountId?: string };

  let trades: Trade[] = [];
  if (body.tradeIds?.length) {
    trades = body.tradeIds.map((id) => getTrade(id)).filter((t): t is Trade => !!t);
  } else if (body.accountId) {
    // Re-read each one: listTrades leaves screenshots off, and the image is half the point of a
    // trade note.
    trades = listTrades(body.accountId)
      .map((t) => getTrade(t.id))
      .filter((t): t is Trade => !!t);
  }
  if (!trades.length) return NextResponse.json({ error: "No trades to export." }, { status: 400 });

  const root = path.join(vault, folder);
  if (!insideVault(vault, root)) {
    return NextResponse.json({ error: "That folder resolves outside the vault." }, { status: 400 });
  }

  const accountName = new Map(listAccounts().map((a) => [a.id, a.name]));

  const written: string[] = [];
  const skipped: { note: string; reason: string }[] = [];
  const folders = new Set<string>();

  for (const t of trades) {
    /**
     * Each trade files under the account it was taken on.
     *
     * A vault that mirrors the accounts is one where "how did the 25k eval go" is a folder rather
     * than a query, and where backtests never sit in the same list as live trades.
     */
    const account = accountFolder(accountName.get(t.accountId));
    const notesDir = path.join(root, account);
    const attachDir = path.join(notesDir, "attachments");
    // Re-checked per account: the name comes from the database, and a folder built from it still
    // has to land inside the vault.
    if (!insideVault(vault, notesDir)) {
      skipped.push({ note: t.id, reason: `account folder "${account}" resolves outside the vault` });
      continue;
    }
    await fs.mkdir(attachDir, { recursive: true });
    folders.add(`${folder}/${account}`);

    const base = noteName(t);
    const file = path.join(notesDir, `${base}.md`);

    // Never overwrite a note this exporter did not write. A file that happens to share the name is
    // someone's own writing, and losing it is not a trade-off worth making for convenience.
    let existingOwner: string | null = null;
    let exists = false;
    try {
      const current = await fs.readFile(file, "utf8");
      exists = true;
      existingOwner = ownedTradeId(current);
    } catch {
      /* not there yet, which is the normal case */
    }
    if (exists && existingOwner !== t.id) {
      skipped.push({ note: `${base}.md`, reason: "a note with this name is already there and is not ours" });
      continue;
    }

    // Copy the screenshot in so the note works offline and survives the app being moved.
    let imagePath: string | null = null;
    const shot = (t as Trade & { screenshots?: { filename: string }[] }).screenshots?.[0];
    if (shot?.filename) {
      try {
        const ext = path.extname(shot.filename) || ".png";
        const name = `${base}${ext}`;
        await fs.copyFile(path.join(UPLOAD_DIR, shot.filename), path.join(attachDir, name));
        imagePath = `${folder}/${account}/attachments/${name}`;
      } catch {
        // A missing image must not cost the note.
      }
    }

    await fs.writeFile(
      file,
      tradeNote(t, { imagePath, currency: settings.currency, account: accountName.get(t.accountId) ?? null }),
      "utf8"
    );
    written.push(`${folder}/${account}/${base}.md`);
  }

  return NextResponse.json({
    written: written.length,
    skipped,
    folder,
    folders: [...folders].sort(),
    notes: written,
  });
}
