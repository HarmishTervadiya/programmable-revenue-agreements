/**
 * Pure bigint maths mirroring the on-chain program. All amounts are base
 * units (6 decimals). Division always floors — dust stays in the vault.
 */
export const PRECISION = 1_000_000_000_000n;
const BPS_DENOM = 10_000n;

export type Party =
  | { kind: "holders" }
  | { kind: "wallet"; address: string };

export interface Split {
  party: Party;
  bps: number;
  owed: bigint;
}

export interface Tier {
  /** Cumulative threshold, or null for the uncapped last tier. */
  threshold: bigint | null;
  filled: bigint;
  accPerToken: bigint;
  splits: Split[];
}

export interface ClaimState {
  lastAcc: bigint[];
  pending: bigint[];
  frozen: boolean;
}

export function holdersBps(tier: Tier): bigint {
  return tier.splits.reduce(
    (s, x) => (x.party.kind === "holders" ? s + BigInt(x.bps) : s),
    0n,
  );
}

/**
 * Fill tiers in order by cumulative deposits. Mutates `tiers`.
 * Returns the `take` per tier. The last tier must be uncapped so the full
 * amount always fits — `end_cap` never trims a deposit.
 */
export function waterfall(
  tiers: Tier[],
  supply: bigint,
  amount: bigint,
): bigint[] {
  if (supply <= 0n) throw new Error("Supply must be above zero");
  const takes: bigint[] = new Array(tiers.length).fill(0n);
  let remaining = amount;
  let prev = 0n;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const width =
      t.threshold === null
        ? remaining + t.filled // uncapped: always fits
        : t.threshold - prev;
    const room = width - t.filled;
    const take = remaining < room ? remaining : room;
    if (take > 0n) {
      const hb = holdersBps(t);
      if (hb > 0n) {
        t.accPerToken +=
          ((take * hb * PRECISION) / BPS_DENOM / supply);
      }
      for (const s of t.splits) {
        if (s.party.kind === "wallet") {
          s.owed += (take * BigInt(s.bps)) / BPS_DENOM;
        }
      }
      t.filled += take;
      remaining -= take;
    }
    takes[i] = take;
    if (t.threshold !== null) prev = t.threshold;
  }
  return takes;
}

/** Per-tier claimable for a holder, then summed by the caller. */
export function claimablePerTier(
  balance: bigint,
  claim: ClaimState,
  tiers: Tier[],
): bigint[] {
  return tiers.map((t, i) => {
    const delta = t.accPerToken - (claim.lastAcc[i] ?? 0n);
    if (delta < 0n) throw new Error("Accumulator went backwards");
    return (balance * delta) / PRECISION + (claim.pending[i] ?? 0n);
  });
}

export function claimableTotal(
  balance: bigint,
  claim: ClaimState,
  tiers: Tier[],
): bigint {
  return claimablePerTier(balance, claim, tiers).reduce((a, b) => a + b, 0n);
}

/** Sync a claim record to the current accumulators, returning the payout. */
export function syncClaim(
  claim: ClaimState,
  tiers: Tier[],
  balance: bigint,
): bigint {
  const payout = claimableTotal(balance, claim, tiers);
  claim.lastAcc = tiers.map((t) => t.accPerToken);
  claim.pending = tiers.map(() => 0n);
  return payout;
}

/**
 * Transfer-hook settlement. Token-2022 invokes the hook after the balances
 * already moved, so callers pass pre-transfer balances:
 * senderBefore = current + amount, receiverBefore = current − amount.
 */
export function settleTransfer(
  sender: ClaimState,
  senderBefore: bigint,
  receiver: ClaimState,
  receiverBefore: bigint,
  tiers: Tier[],
): void {
  for (let i = 0; i < tiers.length; i++) {
    const acc = tiers[i].accPerToken;
    sender.pending[i] =
      (sender.pending[i] ?? 0n) +
      ((senderBefore * (acc - (sender.lastAcc[i] ?? 0n))) / PRECISION);
    sender.lastAcc[i] = acc;
    receiver.pending[i] =
      (receiver.pending[i] ?? 0n) +
        ((receiverBefore * (acc - (receiver.lastAcc[i] ?? 0n))) / PRECISION);
    receiver.lastAcc[i] = acc;
  }
}

export function blankClaim(n: number): ClaimState {
  return {
    lastAcc: new Array(n).fill(0n),
    pending: new Array(n).fill(0n),
    frozen: false,
  };
}

export function snapshotClaim(tiers: Tier[]): ClaimState {
  return {
    lastAcc: tiers.map((t) => t.accPerToken),
    pending: tiers.map(() => 0n),
    frozen: false,
  };
}
