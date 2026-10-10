/** Narrow TSV bridge for the Rust LiteSVM test; no Rust JSON dependency needed. */
import assert from "node:assert/strict";
import { claim, CalculationError } from "./calculator.mts";
import { vectors } from "./vectors.mts";
for (const vector of [
  ...vectors.claims,
  ...vectors.invalid.filter((v: any) => v.runtime),
]) {
  const input = vector.input;
  let expected: string;
  try {
    const actual = claim(input);
    assert.deepEqual(actual, vector.expected);
    expected = `payout:${actual.payout}`;
  } catch (error) {
    if (!(error instanceof CalculationError)) throw error;
    assert.equal(error.code, vector.expectedError);
    expected = `error:${error.code}`;
  }
  const pad = (values: bigint[]) =>
    [...values, ...Array(5 - values.length).fill(0n)].join(",");
  console.log(
    [
      vector.name,
      input.balance,
      pad(input.acc),
      pad(input.last),
      pad(input.pending),
      input.vault,
      Boolean(input.frozen),
      input.tierCount ?? input.acc.length,
      expected,
      vector.discrepancy?.onChainPayout ?? "-",
    ].join("\t"),
  );
}
