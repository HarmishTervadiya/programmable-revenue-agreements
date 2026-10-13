import { describe, expect, it } from "vitest";
import { PRECISION } from "@/lib/math/accumulator";
import { canClose, canExpire, claimableFor, partyClaimable, totalClaimable } from "./client";
import { MockClient } from "./mockClient";
import {
  GLACIER,
  NATE,
  PRINCE,
  PRINCE_SCENARIO,
  SHRINATH,
  ANDREIA,
  STUDIO,
  princeCreateInput,
} from "./scenarios";
import { ProtocolError, type AgreementState } from "./types";

const NOW = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const usdc = (n: number) => BigInt(n) * 1_000_000n;
const tokens = (n: number) => BigInt(n) * 1_000_000n;

const D4K = usdc(4_000);
const D20K = usdc(20_000);
const D25K = usdc(25_000);

function client(): MockClient {
  return new MockClient({ speed: 0, startTime: NOW });
}

async function seedPrince(withBuys = true): Promise<MockClient> {
  const c = client();
  await c.reset(PRINCE_SCENARIO.personas);
  await c.submit({ ix: "initialize_agreement", input: princeCreateInput(NOW), creator: PRINCE.address });
  if (withBuys) {
    for (const buy of PRINCE_SCENARIO.buys)
      await c.submit({
        ix: "purchase_share",
        buyerId: buy.persona.id,
        buyerLabel: buy.persona.label,
        amount: buy.shares,
      });
  }
  return c;
}

async function state(c: MockClient): Promise<AgreementState> {
  const s = await c.getState();
  if (!s) throw new Error("expected agreement state");
  return s;
}

async function rejects(p: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected rejection with code ${code}`).toBeInstanceOf(ProtocolError);
  expect((caught as ProtocolError).code).toBe(code);
}

describe("scenario seeding", () => {
  it("funds persona wallets on reset", async () => {
    const c = client();
    await c.reset(PRINCE_SCENARIO.personas);
    await c.submit({ ix: "initialize_agreement", input: princeCreateInput(NOW), creator: PRINCE.address });
    const a = await state(c);
    expect(a.usdc[NATE.id]).toBe(1_000_000_000_000n); // 1M demo USDC
    expect(a.usdc[STUDIO.id]).toBe(10_000_000_000_000n); // 10M revenue
    expect(a.usdc[PRINCE.address] ?? 0n).toBe(0n);
  });

  it("sells the full supply to the four backers", async () => {
    const c = await seedPrince();
    const a = await state(c);
    expect(a.treasury).toBe(0n);
    expect(a.sharesSold).toBe(tokens(1_000));
    expect(a.holders.map((h) => [h.label, h.balance])).toEqual([
      ["Nate", tokens(300)],
      ["Glacier", tokens(250)],
      ["Andreia", tokens(250)],
      ["Shrinath", tokens(200)],
    ]);
    // Nate paid 300 × $10 and Prince received it.
    expect(a.usdc[NATE.id]).toBe(1_000_000_000_000n - usdc(3_000));
    expect(a.usdc[PRINCE.address]).toBe(usdc(10_000));
  });
});

describe("accumulator vectors (study guide §8)", () => {
  it("tiers land on acc_per_token 10 / 14 / 7.6 after 4k + 20k + 25k", async () => {
    const c = await seedPrince();
    for (const amount of PRINCE_SCENARIO.deposits)
      await c.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount });
    const a = await state(c);
    expect(a.tiers.map((t) => t.accPerToken)).toEqual([
      10n * PRECISION,
      14n * PRECISION,
      7_600_000_000_000n, // 7.6
    ]);
    expect(a.totalDeposited).toBe(usdc(49_000));
    expect(a.vault).toBe(usdc(49_000));
  });

  it("claimables: Nate 9,480 · Glacier 7,900 · Andreia 7,900 · Shrinath 6,320 · Prince 17,400", async () => {
    const c = await seedPrince();
    for (const amount of PRINCE_SCENARIO.deposits)
      await c.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount });
    const a = await state(c);
    expect(claimableFor(a, NATE.id)).toBe(usdc(9_480));
    expect(claimableFor(a, GLACIER.id)).toBe(usdc(7_900));
    expect(claimableFor(a, ANDREIA.id)).toBe(usdc(7_900));
    expect(claimableFor(a, SHRINATH.id)).toBe(usdc(6_320));
    expect(partyClaimable(a, PRINCE.address)).toBe(usdc(17_400));
    // Everything deposited is owed to someone — nothing minted, nothing lost.
    expect(totalClaimable(a)).toBe(usdc(49_000));
    expect(totalClaimable(a)).toBe(a.vault);
  });

  it("claiming after every deposit equals claiming once at the end", async () => {
    const early = await seedPrince();
    let earlyPayout = 0n;
    for (const amount of PRINCE_SCENARIO.deposits) {
      await early.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount });
      await early.submit({ ix: "claim_tier_share", holderId: NATE.id });
      const last = (await state(early)).log.at(-1);
      earlyPayout += last?.amount ?? 0n;
    }

    const late = await seedPrince();
    for (const amount of PRINCE_SCENARIO.deposits)
      await late.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount });
    await late.submit({ ix: "claim_tier_share", holderId: NATE.id });
    const latePayout = (await state(late)).log.at(-1)?.amount ?? 0n;

    expect(latePayout).toBe(usdc(9_480));
    expect(earlyPayout).toBe(latePayout);
  });

  it("transfer: Glacier 4,950 → sends 100 → after the 25k deposit Glacier 6,720 + newcomer 1,180", async () => {
    const c = await seedPrince();
    await c.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount: D4K });
    await c.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount: D20K });
    expect(claimableFor(await state(c), GLACIER.id)).toBe(usdc(4_950));

    await c.submit({
      ix: "transfer_hook",
      fromId: GLACIER.id,
      fromLabel: "Glacier",
      toId: "NEW_WALLET",
      toLabel: "New wallet",
      amount: tokens(100),
    });

    await c.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount: D25K });
    const a = await state(c);
    const glacier = claimableFor(a, GLACIER.id);
    const newcomer = claimableFor(a, "NEW_WALLET");
    expect(glacier).toBe(usdc(6_720));
    expect(newcomer).toBe(usdc(1_180));
    expect(glacier + newcomer).toBe(usdc(7_900)); // 250 tokens' worth survives the move
  });
});

describe("rule violations speak plain sentences", () => {
  it("rejects a capped last tier", async () => {
    const c = client();
    await c.reset(PRINCE_SCENARIO.personas);
    const input = princeCreateInput(NOW);
    input.tiers[2].threshold = usdc(50_000); // must stay uncapped
    await rejects(
      c.submit({ ix: "initialize_agreement", input, creator: PRINCE.address }),
      "LastTierMustBeUncapped",
    );
  });

  it("rejects splits that don't total 100%", async () => {
    const c = client();
    await c.reset(PRINCE_SCENARIO.personas);
    const input = princeCreateInput(NOW);
    input.tiers[0].splits[0].bps = 9_000;
    await rejects(
      c.submit({ ix: "initialize_agreement", input, creator: PRINCE.address }),
      "SplitsMustSumTo10000",
    );
  });

  it("rejects depositing after expiry", async () => {
    const c = await seedPrince();
    await c.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount: D4K });
    await c.advanceDays(3 * 365 + 1); // past the 3-year expiry
    await c.submit({ ix: "expire_agreement" });
    await rejects(
      c.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount: D4K }),
      "AgreementNotActive",
    );
  });

  it("rejects buying and claiming while frozen", async () => {
    const c = client();
    await c.reset(PRINCE_SCENARIO.personas);
    await c.submit({ ix: "initialize_agreement", input: princeCreateInput(NOW), creator: PRINCE.address });
    await c.submit({ ix: "purchase_share", buyerId: NATE.id, buyerLabel: "Nate", amount: tokens(100) });
    await c.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount: D4K });
    await c.submit({ ix: "freeze_position", holderId: NATE.id });

    await rejects(
      c.submit({ ix: "purchase_share", buyerId: NATE.id, buyerLabel: "Nate", amount: tokens(50) }),
      "FrozenPosition",
    );
    await rejects(c.submit({ ix: "claim_tier_share", holderId: NATE.id }), "FrozenPosition");

    // Accrual is kept, not burned: unfreeze later and the claim pays.
    await c.submit({ ix: "unfreeze_position", holderId: NATE.id });
    const result = await c.submit({ ix: "claim_tier_share", holderId: NATE.id });
    expect(result.value).toBeGreaterThan(0n);
  });

  it("rejects closing while the claim window is still open", async () => {
    const c = await seedPrince();
    await c.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount: D4K });
    await c.advanceDays(3 * 365 + 1);
    await c.submit({ ix: "expire_agreement" });
    expect(canClose(await state(c), NOW)).toEqual({
      ok: false,
      reason: expect.stringContaining("Claim window"),
    });
    await rejects(c.submit({ ix: "close_agreement" }), "ClaimWindowOpen");

    // After the 30-day claim window the close goes through.
    await c.advanceDays(31);
    const closed = await c.submit({ ix: "close_agreement" });
    expect((await state(c)).status).toBe("closed");
    expect(closed.value).toBe(usdc(4_000)); // unclaimed vault returned to the creator
  });

  it("rejects expiring before the end condition", async () => {
    const c = await seedPrince();
    expect(canExpire(await state(c), NOW)).toBe(false);
    await rejects(c.submit({ ix: "expire_agreement" }), "EndConditionNotMet");
    // Expiry time makes it legal.
    await c.advanceDays(3 * 365 + 1);
    expect(canExpire(await state(c), await c.now())).toBe(true);
  });
});

describe("event log and stages", () => {
  it("logs each instruction with accounts and before/after snapshots", async () => {
    const c = await seedPrince();
    await c.submit({ ix: "deposit_revenue", depositorId: STUDIO.address, amount: D4K });
    const entry = (await state(c)).log.at(-1);
    expect(entry?.ix).toBe("deposit_revenue");
    expect(entry?.amount).toBe(D4K);
    expect(entry?.accounts).toContain(STUDIO.address);
    expect(entry?.before).toContain("deposited $0");
    expect(entry?.after).toContain("deposited $4,000");
    expect(entry?.signature).toHaveLength(88);
    expect(entry?.ts).toBe(NOW);
  });

  it("emits building → awaiting-signature → confirming → confirmed", async () => {
    const c = new MockClient({ speed: 1, startTime: NOW }); // real (tiny) delays
    await c.reset(PRINCE_SCENARIO.personas);
    const phases: string[] = [];
    let sawState = false;
    c.subscribe((e) => {
      if (e.type === "tx") phases.push(e.progress.phase);
      if (e.type === "state" && e.state) sawState = true;
    });
    await c.submit({ ix: "initialize_agreement", input: princeCreateInput(NOW), creator: PRINCE.address });
    expect(phases[0]).toBe("building");
    expect(phases).toContain("awaiting-signature");
    expect(phases).toContain("confirming");
    expect(phases.at(-1)).toBe("confirmed");
    expect(phases.indexOf("awaiting-signature")).toBeGreaterThan(phases.indexOf("building"));
    expect(phases.indexOf("confirmed")).toBeGreaterThan(phases.indexOf("confirming"));
    expect(sawState).toBe(true);
  });

  it("reset clears the agreement and rewinds the clock", async () => {
    const c = await seedPrince();
    await c.advanceDays(100);
    expect(await c.now()).toBe(NOW + 100 * 86_400);
    await c.reset(PRINCE_SCENARIO.personas);
    expect(await c.getState()).toBeNull();
    expect(await c.now()).toBe(NOW);
  });
});
