import type { AccountType } from "./types";

/**
 * How accounts are grouped and ordered wherever more than one is shown.
 *
 * The order is deliberate and runs from "this is real money" down to "this never happened":
 * evaluations first because they are the ones with a clock and a rule to fail, then funded, then
 * personal, then the two simulated kinds. Anything that can be lost sorts above anything that
 * cannot.
 */
export const ACCOUNT_GROUPS: { type: AccountType; label: string; blurb: string }[] = [
  { type: "evaluation", label: "Evaluations", blurb: "Challenges in progress — target and drawdown apply" },
  { type: "funded", label: "Funded", blurb: "Passed and paying, still rule-bound" },
  { type: "personal", label: "Personal", blurb: "Your own money" },
  { type: "paper", label: "Paper", blurb: "Forward-tested by hand, in real time" },
  { type: "backtest", label: "Backtest", blurb: "Filled by the engine over historical data" },
];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  evaluation: "Evaluation",
  funded: "Funded",
  personal: "Personal",
  paper: "Paper",
  backtest: "Backtest",
};

/** Simulated accounts do not belong in a real track record, and are labelled as such. */
export const IS_SIMULATED: Record<AccountType, boolean> = {
  evaluation: false,
  funded: false,
  personal: false,
  paper: true,
  backtest: true,
};

/** Group a list of accounts, dropping any group that has no members. */
export function groupAccounts<T extends { account: { type: AccountType } }>(
  rows: T[]
): { type: AccountType; label: string; blurb: string; rows: T[] }[] {
  return ACCOUNT_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.account.type === g.type) })).filter(
    (g) => g.rows.length > 0
  );
}

/**
 * Accounts scored in R alone, with no money and no position size anywhere near them.
 *
 * A backtest has no balance to risk a percentage of, so every dollar figure attached to one is
 * invented: a contract count picked after the fact, multiplied by a balance that never existed.
 * Carrying those numbers made the journal read as though a backtest had made money, and dragged
 * fiction into every statistic derived from it. A backtest returns +1.1R or -1R and nothing else.
 *
 * Every other kind of account keeps its money. An evaluation, a funded account and your own
 * capital all have a real balance, real sizing and a real P&L, and hiding those would be its own
 * kind of lie. Paper sits with them deliberately: it mirrors a live account in real time, balance
 * included, which is the whole point of forward-testing.
 */
export const IS_R_ONLY: Record<AccountType, boolean> = {
  evaluation: false,
  funded: false,
  personal: false,
  paper: false,
  backtest: true,
};

/** True when this account records R and nothing monetary. Null (all accounts) is never R-only. */
export const isROnly = (account: { type: AccountType } | null | undefined): boolean =>
  !!account && IS_R_ONLY[account.type];
