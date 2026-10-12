import { describe, expect, it } from "vitest";
import {
  blankClaim,
  claimableTotal,
  settleTransfer,
  snapshotClaim,
  syncClaim,
  waterfall,
  type Tier,
} from "./accumulator";

/** Study guide §9 worked example, whole USDC, supply 1,000 tokens. */
function seedTiers(): Tier[] {
  return [
    {
      threshold: 10_000n,
      filled: 0n,
      accPerToken: 0n,
      splits: [{ party: { kind: "holders" }, bps: 10_000, owed: 0n }],
    },
    {
      threshold: 30_000n,
      filled: 0n,
      accPerToken: 0n,
      splits: [
        { party: { kind: "holders" }, bps: 7_000, owed: 0n },
        { party: { kind: "wallet", address: "creator" }, bps: 3_000, owed: 0n },
      ],
    },
    {
      threshold: null,
      filled: 0n,
      accPerToken: 0n,
      splits: [
        { party: { kind: "holders" }, bps: 4_000, owed: 0n },
        { party: { kind: "wallet", address: "creator" }, bps: 6_000, owed: 0n },
      ],
    },
  ];
}

describe("tier waterfall (study guide §9)", () => {
  it("three deposits fill tiers and match the expected accumulators", () => {
    const tiers = seedTiers();
    const supply = 1_000n;

    expect(waterfall(tiers, supply, 4_000n)).toEqual([4_000n, 0n, 0n]);
    // acc0 = 4_000 × 10000bps × 1e12 / (10000 × 1_000) = 4e12
    expect(tiers.map((t) => t.accPerToken)).toEqual([
      4_000_000_000_000n,
      0n,
      0n,
    ]);

    expect(waterfall(tiers, supply, 20_000n)).toEqual([6_000n, 14_000n, 0n]);
    // acc1 = 14_000 × 0.7 / 1_000 = 9.8 → acc stored × PRECISION; whole-unit view 9.8
    expect(tiers[0].accPerToken).toEqual(10_000_000_000_000n);
    expect(tiers[1].accPerToken).toEqual(9_800_000_000_000n);
    expect(tiers[1].splits[1].owed).toEqual(4_200n);

    expect(waterfall(tiers, supply, 25_000n)).toEqual([0n, 6_000n, 19_000n]);
    expect(tiers[1].accPerToken).toEqual(14_000_000_000_000n);
    expect(tiers[2].accPerToken).toEqual(7_600_000_000_000n);
    expect(tiers[1].splits[1].owed + tiers[2].splits[1].owed).toEqual(17_400n);
  });

  it("holders earn exactly their share; vault check holds", () => {
    const tiers = seedTiers();
    const supply = 1_000n;
    waterfall(tiers, supply, 4_000n);
    waterfall(tiers, supply, 20_000n);
    waterfall(tiers, supply, 25_000n);

    const a = claimableTotal(100n, blankClaim(3), tiers);
    const b = claimableTotal(300n, blankClaim(3), tiers);
    const c = claimableTotal(600n, blankClaim(3), tiers);
    expect(a).toEqual(3_160n);
    expect(b).toEqual(9_480n);
    expect(c).toEqual(18_960n);

    const creator = tiers[1].splits[1].owed + tiers[2].splits[1].owed;
    expect(a + b + c + creator).toEqual(49_000n);
  });

  it("claim timing does not change the total", () => {
    const tiers = seedTiers();
    const supply = 1_000n;
    const claim = blankClaim(3);

    waterfall(tiers, supply, 4_000n);
    const first = syncClaim(claim, tiers, 100n);
    waterfall(tiers, supply, 20_000n);
    const second = syncClaim(claim, tiers, 100n);
    waterfall(tiers, supply, 25_000n);
    const third = syncClaim(claim, tiers, 100n);

    expect(first).toEqual(400n);
    expect(first + second + third).toEqual(3_160n);
  });
});

describe("transfer hook settlement (Alice sends 40 to Bob)", () => {
  it("keeps past earnings with the sender", () => {
    // Tier setup matching the study-guide hook example: acc = (10, 1).
    const tiers: Tier[] = [
      {
        threshold: 10_000n,
        filled: 10_000n,
        accPerToken: 10_000_000_000_000n,
        splits: [{ party: { kind: "holders" }, bps: 10_000, owed: 0n }],
      },
      {
        threshold: null,
        filled: 2_000n,
        accPerToken: 1_000_000_000_000n,
        splits: [
          { party: { kind: "holders" }, bps: 5_000, owed: 0n },
          { party: { kind: "wallet", address: "creator" }, bps: 5_000, owed: 0n },
        ],
      },
    ];
    const alice = snapshotClaim(tiers.map((t) => ({ ...t, accPerToken: 0n })));
    alice.lastAcc = [0n, 0n];
    const bob = snapshotClaim(tiers.map((t) => ({ ...t, accPerToken: 0n })));
    bob.lastAcc = [0n, 0n];

    // Alice held 100 before sending 40; Bob held 0 before receiving 40.
    settleTransfer(alice, 100n, bob, 0n, tiers);
    expect(alice.pending).toEqual([1_000n, 100n]);
    expect(bob.pending).toEqual([0n, 0n]);

    // Second deposit makes acc1 = 5.
    tiers[1].accPerToken = 5_000_000_000_000n;
    tiers[1].filled += 8_000n;
    const aliceClaim = syncClaim(alice, tiers, 60n);
    const bobClaim = syncClaim(bob, tiers, 40n);
    expect(aliceClaim).toEqual(1_340n);
    expect(bobClaim).toEqual(160n);
    expect(aliceClaim + bobClaim).toEqual(1_500n);
  });
});
