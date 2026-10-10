/** Pure integer reference arithmetic. No RPC, floating point, or account mutations. */
export const PRECISION = 1_000_000_000_000n;
export const BPS = 10_000n;
export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;

export class CalculationError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function requireCondition(condition: boolean, code: string): void {
  if (!condition) throw new CalculationError(code);
}

function unsigned(value: bigint, max: bigint, code = "InvalidInput"): void {
  requireCondition(
    typeof value === "bigint" && value >= 0n && value <= max,
    code,
  );
}

function checked(value: bigint, max: bigint, code = "MathOverflow"): bigint {
  unsigned(value, max, code);
  return value;
}

export interface WaterfallInput {
  thresholds: bigint[];
  totalBefore: bigint;
  deposit: bigint;
  endCap?: bigint | null;
}

/** Interval overlap against cumulative upper thresholds, independent of tier-filling loops.
 * endCap is an expiry signal, NOT an invented rule for accepting/clipping deposits.
 */
export function waterfall(input: WaterfallInput) {
  const { thresholds, totalBefore, deposit, endCap } = input;
  unsigned(totalBefore, U64_MAX);
  unsigned(deposit, U64_MAX);
  requireCondition(
    thresholds.length >= 1 && thresholds.length <= 5,
    "InvalidTierCount",
  );
  thresholds.forEach((threshold, i) => {
    unsigned(threshold, U64_MAX);
    if (i > 0)
      requireCondition(
        threshold > thresholds[i - 1],
        "ThresholdsNotIncreasing",
      );
  });
  requireCondition(thresholds.at(-1) === U64_MAX, "LastTierMustBeUncapped");
  if (endCap != null) unsigned(endCap, U64_MAX);
  const totalAfter = checked(totalBefore + deposit, U64_MAX);
  const fills = (total: bigint) =>
    thresholds.map((upper, i) => {
      const lower = i === 0 ? 0n : thresholds[i - 1];
      return (total < upper ? total : upper) - (total < lower ? total : lower);
    });
  const filledBefore = fills(totalBefore);
  const filledAfter = fills(totalAfter);
  const allocations = filledAfter.map((filled, i) => filled - filledBefore[i]);
  return {
    totalAfter,
    filledBefore,
    filledAfter,
    allocations,
    unallocated: deposit - allocations.reduce((sum, value) => sum + value, 0n),
    capReached: endCap != null && totalAfter >= endCap,
    excessOverCap:
      endCap != null && totalAfter > endCap ? totalAfter - endCap : 0n,
  };
}

export interface SplitInput {
  amount: bigint;
  bps: bigint[];
}

/** Floor each rational share separately; report residual, never silently route it. */
export function allocateSplits({ amount, bps }: SplitInput) {
  unsigned(amount, U64_MAX);
  requireCondition(bps.length >= 1 && bps.length <= 4, "InvalidSplitCount");
  bps.forEach((value) => unsigned(value, 65_535n)); // Rust SplitInput.bps is u16.
  requireCondition(
    bps.reduce((sum, value) => sum + value, 0n) === BPS,
    "SplitsMustSumTo10000",
  );
  const numerators = bps.map((value) => checked(amount * value, U128_MAX));
  const amounts = numerators.map((value) => value / BPS);
  return {
    amounts,
    unallocated: amount - amounts.reduce((sum, value) => sum + value, 0n),
    scaledRemainders: numerators.map((value) => value % BPS),
  };
}

export interface AccrualInput {
  holderRevenue: bigint;
  entitlementUnits: bigint;
  accumulator: bigint;
}

/** Caller supplies the denominator: this repo has no deposit implementation to choose it.
 * No fractional carry is invented; scaledRemainder is diagnostic only.
 */
export function accrue({
  holderRevenue,
  entitlementUnits,
  accumulator,
}: AccrualInput) {
  unsigned(holderRevenue, U64_MAX);
  unsigned(entitlementUnits, U64_MAX);
  unsigned(accumulator, U128_MAX);
  requireCondition(entitlementUnits > 0n, "InvalidSupply");
  const numerator = checked(holderRevenue * PRECISION, U128_MAX);
  const increment = numerator / entitlementUnits;
  const collectiveClaim =
    checked(increment * entitlementUnits, U128_MAX) / PRECISION;
  return {
    increment,
    accumulator: checked(accumulator + increment, U128_MAX),
    scaledRemainder: numerator % entitlementUnits,
    collectiveClaim,
    integerDust: holderRevenue - collectiveClaim,
  };
}

export interface ClaimInput {
  balance: bigint;
  acc: bigint[];
  last: bigint[];
  pending: bigint[];
  vault: bigint;
  frozen?: boolean;
  tierCount?: number;
}

/** Evaluate every active entitlement as a rational numerator, then floor per tier.
 * Strictly reject unsafe u64 narrowing; Rust's current `as u64` discrepancy is separate.
 */
export function claim({
  balance,
  acc,
  last,
  pending,
  vault,
  frozen = false,
  tierCount = acc.length,
}: ClaimInput) {
  unsigned(balance, U64_MAX);
  unsigned(vault, U64_MAX);
  requireCondition(
    acc.length >= 1 &&
      acc.length <= 5 &&
      last.length === acc.length &&
      pending.length === acc.length,
    "InvalidTierCount",
  );
  requireCondition(
    Number.isInteger(tierCount) && tierCount >= 1 && tierCount <= acc.length,
    "InvalidTierCount",
  );
  acc.forEach((value) => unsigned(value, U128_MAX));
  last.forEach((value) => unsigned(value, U128_MAX));
  pending.forEach((value) => unsigned(value, U64_MAX));
  requireCondition(!frozen, "FrozenPosition");
  const earned: bigint[] = [];
  const scaledRemainders: bigint[] = [];
  let payout = 0n;
  for (let i = 0; i < tierCount; i++) {
    requireCondition(acc[i] >= last[i], "MathOverflow");
    const numerator = checked(balance * (acc[i] - last[i]), U128_MAX);
    const amount = checked(numerator / PRECISION, U64_MAX, "NarrowingOverflow");
    earned.push(amount);
    scaledRemainders.push(numerator % PRECISION);
    payout = checked(checked(payout + amount, U64_MAX) + pending[i], U64_MAX);
  }
  requireCondition(payout > 0n, "NothingToClaim");
  requireCondition(payout <= vault, "InsufficientVaultFunds");
  return {
    earned,
    scaledRemainders,
    payout,
    vaultAfter: vault - payout,
    lastAfter: last.map((value, i) => (i < tierCount ? acc[i] : value)),
    pendingAfter: pending.map((value, i) => (i < tierCount ? 0n : value)),
  };
}
