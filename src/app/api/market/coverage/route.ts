import { NextResponse } from "next/server";
import { coverage, listImports, listSymbols } from "@/lib/market";
import { hasApiKey, DEFAULT_DATASET } from "@/lib/databento";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    symbols: listSymbols(),
    coverage: coverage(),
    imports: listImports(12),
    // Only whether a key exists — never the value.
    databento: { configured: hasApiKey(), dataset: DEFAULT_DATASET },
  });
}
