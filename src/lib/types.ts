export type Direction = "long" | "short";

export type ResultCode =
  | "win"
  | "loss"
  | "breakeven"
  | "early_profit"
  | "early_loss"
  | "partial_profit"
  | "partial_loss";

export const RESULT_CODES: ResultCode[] = [
  "win",
  "loss",
  "breakeven",
  "early_profit",
  "early_loss",
  "partial_profit",
  "partial_loss",
];

export const RESULT_LABEL: Record<ResultCode, string> = {
  win: "Win",
  loss: "Loss",
  breakeven: "Break-even",
  early_profit: "Early Profit",
  early_loss: "Early Loss",
  partial_profit: "Partial Profit",
  partial_loss: "Partial Loss",
};

export const RESULT_SHORT: Record<ResultCode, string> = {
  win: "W",
  loss: "L",
  breakeven: "BE",
  early_profit: "EP",
  early_loss: "EL",
  partial_profit: "PP",
  partial_loss: "PL",
};

/** How a result classification is treated by win-rate / profit-factor style stats. */
export type Classification = "win" | "loss" | "breakeven" | "excluded";

/**
 * What an account is for. The distinction is not cosmetic: it decides which rules apply, whether
 * the numbers belong in your real track record, and how the accounts page groups them.
 *
 *   personal    your own money, live
 *   evaluation  a prop-firm challenge, with a target and drawdown limits to respect
 *   funded      a challenge you passed — still rule-bound, but now paying
 *   paper       forward-testing by hand, in real time
 *   backtest    filled by the engine over historical data, never by a human
 */
export type AccountType = "personal" | "evaluation" | "funded" | "paper" | "backtest";

export const ACCOUNT_TYPES: AccountType[] = ["personal", "evaluation", "funded", "paper", "backtest"];

export const isAccountType = (v: unknown): v is AccountType =>
  typeof v === "string" && (ACCOUNT_TYPES as string[]).includes(v);

export type DrawdownType = "static" | "trailing";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  startingBalance: number;
  currency: string;
  defaultRiskPct: number | null;
  archived: 0 | 1;
  createdAt: string;
  /** Prop-firm style limits. Null means the rule does not apply to this account. */
  profitTarget: number | null;
  maxDrawdown: number | null;
  /** "static" measures from the starting balance, "trailing" from the highest balance reached. */
  drawdownType: DrawdownType;
  dailyLossLimit: number | null;
}

export type ScreenshotPhase = "trade" | "before" | "during" | "after";

export interface Screenshot {
  id: string;
  tradeId: string;
  /**
   * A trade has one screenshot: the trade itself. The column still accepts the old
   * before/during/after values so images captured under the previous scheme keep loading — nothing
   * new is ever written with them, and the interface no longer distinguishes.
   */
  phase: ScreenshotPhase;
  filename: string;
  mime: string;
  caption: string | null;
  createdAt: string;
}

export interface Trade {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM (24h, local to the trader)
  instrument: string;
  direction: Direction;
  session: string | null;
  strategy: string | null;
  setup: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  exit: number | null;
  size: number | null;
  riskAmount: number | null;
  riskPct: number | null;
  result: ResultCode;
  pnl: number;
  rMultiple: number | null;
  /** Reward-to-risk as planned at entry. `rMultiple` is what the trade actually returned. */
  plannedRr: number | null;
  mae: number | null; // in R, adverse excursion (positive number = went against by that much R)
  mfe: number | null; // in R, favourable excursion
  fees: number | null;
  // Setup context
  htfSweep: 0 | 1;
  sweep4h: 0 | 1;
  sweep1h: 0 | 1;
  sweep15m: 0 | 1;
  sessionSweep: 0 | 1;
  mss: 0 | 1;
  fvg: 0 | 1;
  orderBlock: 0 | 1;
  displacement: 0 | 1;
  pdArray: string | null;
  entryModel: string | null;
  liquidityTarget: string | null;
  tags: string[];
  // Journal
  thesis: string | null;
  execution: string | null;
  review: string | null;
  mistakes: string | null;
  emotions: string | null;
  createdAt: string;
  updatedAt: string;
  screenshots?: Screenshot[];
}

export type TradeInput = Omit<Trade, "createdAt" | "updatedAt" | "screenshots">;

export interface Strategy {
  id: string;
  name: string;
  description: string | null;
  archived: 0 | 1;
}

export interface Setup {
  id: string;
  name: string;
  archived: 0 | 1;
}

export interface Settings {
  defaultAccountId: string | null;
  currency: string;
  defaultRiskPct: number;
  defaultInstrument: string;
  defaultSession: string;
  instruments: string[];
  sessions: string[];
  entryModels: string[];
  pdArrays: string[];
  liquidityTargets: string[];
  /** Classification rules per result code. */
  classification: Record<ResultCode, Classification>;
  /** Include break-even trades in the win-rate denominator. */
  breakevenInWinRate: boolean;
  /** Point value and tick size per symbol, merged over the built-in defaults. */
  contractSpecs: Record<string, { pointValue: number; tickSize: number }>;
  /** Default position size for the replay ticket. */
  defaultContracts: number;
  /** Which indicators are on, and how they are configured. */
  indicators: {
    fvg: boolean;
    sessions: boolean;
    po3: boolean;
    fvgHidden?: boolean;
    sessionsHidden?: boolean;
    po3Hidden?: boolean;
    fvgOptions?: Record<string, unknown>;
    sessionOptions?: Record<string, unknown>;
    po3Options?: Record<string, unknown>;
  };
  /**
   * External backtesting engine. The script path lives in settings rather than in the request,
   * so nothing reaching the API can choose what gets executed.
   */
  engine: {
    interpreter: string;
    script: string;
    args: string;
    workingDir: string;
  };
  /** Named drawing styles per tool, e.g. an "FVG" rectangle and an "Order block" rectangle. */
  /** Replay conveniences: mark trades on the chart, and file a screenshot at the exit. */
  replayOptions: { drawPositions: boolean; screenshotOnExit: boolean };
  /**
   * Absolute path to an Obsidian vault, and the folder inside it to write trade notes into.
   *
   * Kept in settings rather than passed to the export endpoint: nothing arriving over HTTP should
   * be able to choose where this server writes files.
   */
  obsidianVault: string | null;
  obsidianFolder: string;
  drawingTemplates: Record<string, { name: string; style: Record<string, unknown> }[]>;
  weekStartsOn: 0 | 1;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultAccountId: null,
  currency: "USD",
  defaultRiskPct: 1,
  defaultInstrument: "MNQ",
  defaultSession: "NY",
  instruments: ["MNQ", "NQ", "MES", "ES", "MGC", "EURUSD", "GBPUSD", "BTCUSD"],
  sessions: ["Asia", "London", "NY AM", "NY PM", "Other"],
  entryModels: ["FVG entry", "Order block", "Breaker", "Retest of MSS", "Turtle soup", "Other"],
  pdArrays: ["FVG", "Order block", "Breaker", "Mitigation block", "Equilibrium", "Void", "None"],
  liquidityTargets: [
    "Session high",
    "Session low",
    "Previous day high",
    "Previous day low",
    "Equal highs",
    "Equal lows",
    "Weekly high",
    "Weekly low",
    "Other",
  ],
  classification: {
    win: "win",
    loss: "loss",
    breakeven: "breakeven",
    early_profit: "win",
    early_loss: "loss",
    partial_profit: "win",
    partial_loss: "loss",
  },
  breakevenInWinRate: false,
  contractSpecs: {},
  defaultContracts: 2,
  engine: { interpreter: "python3", script: "", args: "", workingDir: "" },
  replayOptions: { drawPositions: true, screenshotOnExit: true },
  obsidianVault: null,
  obsidianFolder: "Trades",
  drawingTemplates: {},
  indicators: { fvg: false, sessions: false, po3: false },
  weekStartsOn: 0,
};

export interface Backtest {
  id: string;
  name: string;
  strategy: string | null;
  instrument: string | null;
  startDate: string | null;
  endDate: string | null;
  params: Record<string, unknown>;
  status: "draft" | "awaiting_engine" | "complete" | "failed";
  result: BacktestResult | null;
  engineNote: string | null;
  createdAt: string;
}

export interface BacktestResult {
  trades: number;
  netR: number;
  netPnl: number;
  winRate: number;
  profitFactor: number | null;
  maxDrawdownR: number;
  equityR?: number[];
  raw?: { tests?: BacktestTest[]; source?: string; [key: string]: unknown } | null;
}

/** Optional per-trade detail an engine (or an import) can attach to a run. */
export interface BacktestTest {
  ref: string;
  date: string | null;
  direction: "long" | "short" | null;
  result: string | null;
  r: number | null;
  plannedRr: number | null;
  risk: number | null;
  size: number | null;
  balance: number | null;
  duration: string | null;
  timeframes: string | null;
  verdict: string | null;
  notes: string | null;
  sourceUrl: string | null;
}
