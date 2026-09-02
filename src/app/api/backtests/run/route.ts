import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { getSettings, listBacktests, updateBacktestResult } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

const TIMEOUT_MS = 15 * 60 * 1000;
const MAX_LOG = 8000;

/**
 * Run the configured engine for a stored backtest.
 *
 * The interpreter and script come from settings, never from the request body — otherwise this
 * endpoint would execute whatever anyone asked it to. The run's parameters are passed as command
 * line arguments and environment variables, and whatever the script prints is captured.
 *
 * If the script prints JSON containing a `trades` array it is ingested automatically; otherwise
 * the script is expected to post its own results using engine/overwatch.py.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.backtestId ?? "");
  const run = listBacktests().find((b) => b.id === id);
  if (!run) return NextResponse.json({ error: "Backtest not found" }, { status: 404 });

  const { engine } = getSettings();
  if (!engine?.script?.trim()) {
    return NextResponse.json(
      { error: "No engine script configured. Set it in Settings → Backtesting engine." },
      { status: 400 }
    );
  }
  if (!path.isAbsolute(engine.script)) {
    return NextResponse.json({ error: "The engine script must be an absolute path." }, { status: 400 });
  }
  if (!fs.existsSync(engine.script)) {
    return NextResponse.json({ error: `No file at ${engine.script}` }, { status: 400 });
  }

  const cwd = engine.workingDir?.trim() || path.dirname(engine.script);
  const extra = engine.args?.trim() ? engine.args.trim().split(/\s+/) : [];
  const args = [
    engine.script,
    ...extra,
    ...(run.instrument ? ["--symbol", run.instrument] : []),
    ...(run.startDate ? ["--start", run.startDate] : []),
    ...(run.endDate ? ["--end", run.endDate] : []),
    ...(run.strategy ? ["--strategy", run.strategy] : []),
  ];

  // Long runs are detached: an overnight backtest cannot be held open by an HTTP request, and a
  // browser tab closing must not kill it.
  if (body.background) {
    const logDir = path.join(process.env.TJ_DATA_DIR ?? path.join(process.cwd(), "data"), "engine-runs");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${run.id}.log`);
    const out = fs.openSync(logPath, "a");
    fs.writeSync(out, `\n=== ${new Date().toISOString()} — ${run.name} ===\n`);

    const child = spawn(engine.interpreter?.trim() || "python3", args, {
      cwd,
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        OVERWATCH_URL: `http://localhost:${process.env.PORT ?? 3000}`,
        OVERWATCH_RUN_ID: run.id,
        OVERWATCH_RUN_NAME: run.name,
        OVERWATCH_SYMBOL: run.instrument ?? "",
        OVERWATCH_START: run.startDate ?? "",
        OVERWATCH_END: run.endDate ?? "",
        OVERWATCH_PARAMS: JSON.stringify(run.params ?? {}),
        PYTHONUNBUFFERED: "1",
      },
    });
    /**
     * A detached run still gets watched while this process lives. Without it a crash on startup —
     * a missing data file, a bad import — would leave the run sitting on "awaiting engine"
     * forever, which says nothing about what happened.
     */
    child.on("exit", (code) => {
      if (code === 0) return; // success is reported by the engine posting its results
      let tail = "";
      try {
        const text = fs.readFileSync(logPath, "utf8");
        tail = text.slice(-MAX_LOG).trim();
      } catch {
        /* log unreadable */
      }
      updateBacktestResult(
        run.id,
        null,
        "failed",
        `Exited with code ${code}.\n\n${tail}`
      );
    });
    child.unref();

    updateBacktestResult(
      run.id,
      null,
      "awaiting_engine",
      `Started in the background at ${new Date().toISOString()} (pid ${child.pid}).\n` +
        `Output: data/engine-runs/${run.id}.log\n` +
        `Results appear here when the engine posts them.`
    );
    return NextResponse.json({ status: "started", pid: child.pid, log: `data/engine-runs/${run.id}.log` });
  }

  const started = Date.now();
  const result = await new Promise<{ code: number | null; out: string; timedOut: boolean }>((resolve) => {
    let out = "";
    let timedOut = false;

    const child = spawn(engine.interpreter?.trim() || "python3", args, {
      cwd,
      env: {
        ...process.env,
        OVERWATCH_URL: `http://localhost:${process.env.PORT ?? 3000}`,
        OVERWATCH_RUN_ID: run.id,
        OVERWATCH_RUN_NAME: run.name,
        OVERWATCH_SYMBOL: run.instrument ?? "",
        OVERWATCH_START: run.startDate ?? "",
        OVERWATCH_END: run.endDate ?? "",
        OVERWATCH_PARAMS: JSON.stringify(run.params ?? {}),
        PYTHONUNBUFFERED: "1",
      },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    const collect = (chunk: Buffer) => {
      out += chunk.toString();
      if (out.length > MAX_LOG * 4) out = out.slice(-MAX_LOG * 4);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, out: `${out}\n${e.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, timedOut });
    });
  });

  const seconds = Math.round((Date.now() - started) / 1000);
  const tail = result.out.slice(-MAX_LOG).trim();

  if (result.timedOut) {
    updateBacktestResult(run.id, null, "failed", `Stopped after 15 minutes.\n\n${tail}`);
    return NextResponse.json({ status: "failed", error: "The engine ran past 15 minutes and was stopped.", log: tail }, { status: 504 });
  }
  if (result.code !== 0) {
    updateBacktestResult(run.id, null, "failed", `Exited with code ${result.code} after ${seconds}s.\n\n${tail}`);
    return NextResponse.json({ status: "failed", error: `The engine exited with code ${result.code}.`, log: tail }, { status: 502 });
  }

  // If it printed a JSON result, take it; otherwise assume the script posted its own.
  let ingested = false;
  const start = result.out.lastIndexOf("{");
  if (start >= 0) {
    try {
      const parsed = JSON.parse(result.out.slice(start));
      if (parsed && typeof parsed === "object" && Number.isFinite(Number(parsed.trades))) {
        updateBacktestResult(
          run.id,
          {
            trades: Number(parsed.trades),
            netR: Number(parsed.netR) || 0,
            netPnl: Number(parsed.netPnl) || 0,
            winRate: Number(parsed.winRate) || 0,
            profitFactor: Number.isFinite(Number(parsed.profitFactor)) ? Number(parsed.profitFactor) : null,
            maxDrawdownR: Number(parsed.maxDrawdownR) || 0,
            equityR: Array.isArray(parsed.equityR) ? parsed.equityR.map(Number) : undefined,
            raw: parsed.raw ?? null,
          },
          "complete",
          `Ran in ${seconds}s.\n\n${tail}`
        );
        ingested = true;
      }
    } catch {
      /* not a result payload — the script posted its own */
    }
  }

  if (!ingested) {
    const latest = listBacktests().find((b) => b.id === run.id);
    updateBacktestResult(
      run.id,
      latest?.result ?? null,
      latest?.result ? "complete" : "awaiting_engine",
      `Ran in ${seconds}s.\n\n${tail}`
    );
  }

  return NextResponse.json({ status: "ok", seconds, ingested, log: tail });
}
