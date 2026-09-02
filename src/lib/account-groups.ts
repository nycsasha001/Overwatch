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
