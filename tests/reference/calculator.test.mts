import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CalculationError,
  waterfall,
  allocateSplits,
  accrue,
  claim,
} from "./calculator.mts";
import { vectors } from "./vectors.mts";

const operations = { waterfall, allocateSplits, accrue, claim };
const groups = {
  waterfall,
  splits: allocateSplits,
  accrual: accrue,
  claims: claim,
};
for (const [group, calculate] of Object.entries(groups)) {
  for (const vector of vectors[group]) {
    test(`${group}: ${vector.name}`, () => {
      const before = structuredClone(vector.input);
      const result = calculate(vector.input);
      assert.deepEqual(result, vector.expected, vector.note);
      assert.deepEqual(
        vector.input,
        before,
        "calculator must not mutate inputs",
      );
      if (group === "waterfall") {
        assert("allocations" in result);
        assert.equal(
          result.allocations.reduce((sum: bigint, x: bigint) => sum + x, 0n) +
            result.unallocated,
          vector.input.deposit,
        );
      }
      if (group === "splits") {
        assert("amounts" in result);
        assert.equal(
          result.amounts.reduce((sum: bigint, x: bigint) => sum + x, 0n) +
            result.unallocated,
          vector.input.amount,
        );
      }
      if (group === "claims") {
        assert("payout" in result);
        assert.equal(result.payout + result.vaultAfter, vector.input.vault);
      }
    });
  }
}
function isOperation(value: unknown): value is keyof typeof operations {
  return (
    value === "waterfall" ||
    value === "allocateSplits" ||
    value === "accrue" ||
    value === "claim"
  );
}
for (const vector of vectors.invalid) {
  test(`invalid ${vector.operation}: ${vector.name}`, () => {
    const before = structuredClone(vector.input);
    const operation: unknown = vector.operation;
    assert(isOperation(operation));
    assert.throws(
      () => operations[operation](vector.input),
      (error) =>
        error instanceof CalculationError &&
        error.code === vector.expectedError,
    );
    assert.deepEqual(vector.input, before, "rejection must not mutate inputs");
  });
}
for (const vector of vectors.sequences) {
  test(`sequence: ${vector.name}`, () => {
    const {
      thresholds,
      entitlementUnits,
      balance,
      deposits,
      claimAfterDeposits,
    } = vector.input;
    let totalDeposited = 0n,
      vault = 0n,
      totalClaimed = 0n;
    let acc = thresholds.map(() => 0n),
      last = [...acc],
      pending = [...acc];
    const outcomes: ({ payout: bigint } | { error: string })[] = [];
    deposits.forEach((deposit: bigint, index: number) => {
      const allocation = waterfall({
        thresholds,
        totalBefore: totalDeposited,
        deposit,
      });
      totalDeposited = allocation.totalAfter;
      vault += deposit;
      acc = acc.map(
        (accumulator: bigint, i: number) =>
          accrue({
            holderRevenue: allocation.allocations[i],
            entitlementUnits,
            accumulator,
          }).accumulator,
      );
      if (!claimAfterDeposits.includes(index + 1)) return;
      try {
        const result = claim({ balance, acc, last, pending, vault });
        totalClaimed += result.payout;
        vault = result.vaultAfter;
        last = result.lastAfter;
        pending = result.pendingAfter;
        outcomes.push({ payout: result.payout });
      } catch (error) {
        if (!(error instanceof CalculationError)) throw error;
        outcomes.push({ error: error.code });
      }
      assert.equal(vault + totalClaimed, totalDeposited);
    });
    assert.deepEqual(
      { outcomes, totalClaimed, vault, totalDeposited, acc, last, pending },
      vector.expected,
      vector.note,
    );
  });
}
