import assert from "node:assert/strict";
import { test } from "node:test";
import { main as seedMain } from "./seed-agreements.mts";
import { main as mockMain } from "./mock-depositor.mts";
import {
  assertLocalGenesis,
  assertLocalRpc,
  deterministicSeed,
  formatUnits,
  initializationArgs,
  instruction,
  loadIdl,
  options,
  toBaseUnits,
  u64,
  U64_MAX,
  validatedSeeds,
} from "./model.mts";

test("six-decimal conversion is exact above Number safe precision", () => {
  assert.equal(toBaseUnits("1.000001"), 1_000_001n);
  assert.equal(toBaseUnits("0.000001"), 1n);
  assert.equal(toBaseUnits("9007199254.740993"), 9_007_199_254_740_993n);
  assert.equal(toBaseUnits("18446744073709.551615"), U64_MAX);
  assert.equal(formatUnits(U64_MAX), "18446744073709.551615");
});
test("amounts reject rounding, negative, exponent and overflowing inputs", () => {
  for (const amount of [
    "-1",
    "1e6",
    "1.0000001",
    "NaN",
    "01",
    "1.",
    "18446744073709.551616",
  ])
    assert.throws(() => toBaseUnits(amount));
  assert.equal(toBaseUnits("0"), 0n);
});
test("IDs remain bounded u64 decimal strings", () => {
  assert.equal(u64(U64_MAX.toString()), U64_MAX);
  for (const n of ["-1", "1.5", "18446744073709551616", "0001"])
    assert.throws(() => u64(n));
});
test("only explicit HTTP loopback RPC endpoints are permitted", () => {
  for (const rpc of [
    "http://localhost:8899",
    "http://127.0.0.1:8899",
    "http://[::1]:8899",
  ])
    assert.doesNotThrow(() => assertLocalRpc(rpc));
  for (const rpc of [
    "https://api.mainnet-beta.solana.com",
    "https://api.devnet.solana.com",
    "http://example.com:8899",
    "http://localhost.evil:8899",
    "http://user@localhost:8899",
    "http://localhost:8899/proxy",
    "http://localhost:8899/?cluster=mainnet",
    "http://127.0.0.2:8899",
  ])
    assert.throws(() => assertLocalRpc(rpc));
});
test("public-cluster genesis hashes are refused behind localhost", () => {
  for (const hash of [
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  ])
    assert.throws(() => assertLocalGenesis(hash));
  assert.doesNotThrow(() => assertLocalGenesis("local-validator-genesis"));
});
test("roles and namespaces use distinct reproducible local key seeds", () => {
  assert.deepEqual(
    deterministicSeed("depositor", "0"),
    deterministicSeed("depositor", "0"),
  );
  assert.notDeepEqual(
    deterministicSeed("creator-payer", "0"),
    deterministicSeed("compliance-admin", "0"),
  );
  assert.notDeepEqual(
    deterministicSeed("depositor", "0"),
    deterministicSeed("depositor", "10000"),
  );
});
test("dataset includes four usable initialization configurations", () => {
  const s = validatedSeeds("0");
  assert.deepEqual(
    s.map((v) => v.name),
    ["single-tier", "waterfall", "claim-window", "cap-expiry"],
  );
  assert.equal(s[0].tiers.length, 1);
  assert.equal(s[1].tiers.length, 3);
  assert.equal(s[2].claimWindow, "3600");
  assert.equal(s[3].expTime, null);
  assert.equal(s[3].endCap, "250000000");
  assert.equal(new Set(s.map((v) => v.agreementId)).size, 4);
});
test("seed offset is deterministic, bounded and leaves original data unchanged", () => {
  assert.equal(validatedSeeds("10000")[0].agreementId, "11001");
  assert.equal(validatedSeeds("0")[0].agreementId, "1001");
  assert.throws(() => validatedSeeds(U64_MAX.toString()));
});
test("ABI uses claimWindow immediately after endCap with actual role order", () => {
  const s = validatedSeeds("0")[2];
  const args = initializationArgs(
    s,
    (v) => v,
    "creator",
    "depositor",
    "admin",
    "destination",
  );
  assert.deepEqual(args, [
    "1003",
    "1000000000",
    "1000000",
    { open: {} },
    [
      {
        threshold: "18446744073709551615",
        splits: [{ party: { holders: {} }, bps: 10000 }],
      },
    ],
    null,
    "4102444800",
    "1000000000",
    "3600",
    "depositor",
    "admin",
    "destination",
  ]);
});
test("IDL preflight matches actual checkout and detects unavailable deposit", () => {
  const idl = loadIdl();
  assert.equal(instruction(idl, "deposit_revenue"), undefined);
  assert.equal(
    instruction(idl, "initialize_agreement").args[8].name,
    "claim_window",
  );
});
test("seed preview performs no RPC and makes no initialization claim", async () => {
  const plan = await seedMain(["--plan"], {}, () => {});
  assert(plan, "Offline seed preview must return a plan");
  assert.equal(plan.seeds.length, 4);
  assert.match(plan.mode, /OFFLINE PLAN ONLY/);
});
test("mock preview identifies funding and explicitly blocks revenue deposit", async () => {
  const plan = await mockMain(
    ["--plan"],
    { DEMO_MOCK_USDC: "12.345678" },
    () => {},
  );
  assert(plan, "Offline mock preview must return a plan");
  assert.equal(plan.targetDepositorBalanceBaseUnits, "12345678");
  assert.match(plan.revenueDeposit, /BLOCKED.*vault remains untouched/);
});
test("deposit request fails before RPC, dependency import or setup", async () => {
  await assert.rejects(
    mockMain(["--execute", "--deposit"], {}, () => {}),
    /deposit_revenue is absent.*No revenue deposit or setup transaction submitted/,
  );
});
test("execution refuses remote RPC before runtime dependency import", async () => {
  await assert.rejects(
    seedMain(
      ["--execute"],
      { DEMO_RPC_URL: "https://api.mainnet-beta.solana.com" },
      () => {},
    ),
    /loopback URL/,
  );
});
test("conflicting flags and unknown modes are rejected", () => {
  assert.throws(() =>
    options(["--plan", "--execute"], ["--plan", "--execute"]),
  );
  assert.throws(() => options(["--reset"], ["--plan", "--execute"]));
});

test("named-wallet splits encode Anchor tuple field zero", () => {
  const seed = validatedSeeds("0")[1];
  const args = initializationArgs(
    seed,
    (s) => s,
    "creator",
    "depositor",
    "admin",
    "destination",
  );
  assert.deepEqual(args[4][1].splits[1].party, { wallet: ["creator"] });
});
