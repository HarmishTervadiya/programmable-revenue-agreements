/**
 * In-memory protocol simulator for Demo Mode (style guide §2, §9).
 * Same maths as the program (lib/math/accumulator.ts), no RPC.
 * Seeded shapes follow the study-guide worked example.
 */
import {
  blankClaim,
  snapshotClaim,
  settleTransfer,
  syncClaim,
  waterfall,
  type ClaimState,
  type Tier,
} from "@/lib/math/accumulator";

export type SimStatus = "active" | "expired" | "closed";

export interface SimHolder {
  id: string;
  label: string;
  balance: bigint;
  claim: ClaimState;
}

export interface SimLogEntry {
  ix: string;
  label: string;
  amount?: bigint;
  signature: string;
}

export interface SimAgreement {
  name: string;
  agreementId: bigint;
  creator: string;
  supply: bigint;
  sharePrice: bigint;
  status: SimStatus;
  tiers: Tier[];
  holders: SimHolder[];
  totalDeposited: bigint;
  sharesSold: bigint;
  treasury: bigint;
  vault: bigint;
  startTime: number | null;
  expTime: number | null;
  endCap: bigint | null;
  claimWindow: number | null;
  claimDeadline: number | null;
  depositor: string;
  complianceAdmin: string;
  /** Sim wallet balances (6dp base units). */
  buyerUsdc: bigint;
  depositorUsdc: bigint;
  creatorUsdc: bigint;
  log: SimLogEntry[];
}

export class SimError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SimError";
  }
}

let sigCounter = 0;
function simSig(): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 88; i++) s += hex[Math.floor(Math.random() * 16)];
  return `SIM${sigCounter++}${s.slice(0, 60)}`;
}

export interface CreateSimInput {
  name: string;
  supply: bigint;
  sharePrice: bigint;
  tiers: { threshold: bigint | null; splits: { kind: "holders" | "wallet"; bps: number; address?: string }[] }[];
  expTime: number | null;
  endCap: bigint | null;
  claimWindow: bigint | null;
  startTime: number | null;
  depositor: string;
  complianceAdmin: string;
}

export function createAgreement(input: CreateSimInput, creator: string): SimAgreement {
  if (input.tiers.length < 1 || input.tiers.length > 5)
    throw new SimError("InvalidTierCount", "You need between 1 and 5 tiers.");
  const last = input.tiers[input.tiers.length - 1];
  if (last.threshold !== null)
    throw new SimError(
      "LastTierMustBeUncapped",
      "The last tier must have no limit, so every deposit has somewhere to go.",
    );
  let prev = 0n;
  for (let i = 0; i < input.tiers.length; i++) {
    const t = input.tiers[i];
    if (t.threshold !== null && t.threshold <= prev)
      throw new SimError("ThresholdsNotIncreasing", "Each tier's threshold must be higher than the one before it.");
    if (t.threshold !== null) prev = t.threshold;
    const sum = t.splits.reduce((s, x) => s + x.bps, 0);
    if (sum !== 10_000)
      throw new SimError("SplitsMustSumTo10000", `Splits in tier ${i + 1} total ${sum / 100}%. They must equal 100%.`);
    if (t.splits.length < 1 || t.splits.length > 4)
      throw new SimError("InvalidSplitCount", "Each tier needs 1 to 4 splits.");
  }
  if (input.expTime === null && input.endCap === null)
    throw new SimError("ExpOrCapRequired", "Set an expiry date, a revenue cap, or both.");
  if (input.supply <= 0n) throw new SimError("InvalidSupply", "Supply must be above 0.");
  if (input.sharePrice <= 0n) throw new SimError("InvalidPrice", "Share price must be above 0.");
  if (input.complianceAdmin === creator)
    throw new SimError("AdminCannotBeCreator", "The compliance admin can't be the creator. Choose another wallet.");

  const tiers: Tier[] = input.tiers.map((t) => ({
    threshold: t.threshold,
    filled: 0n,
    accPerToken: 0n,
    splits: t.splits.map((s) => ({
      party: s.kind === "holders" ? { kind: "holders" as const } : { kind: "wallet" as const, address: s.address ?? "" },
      bps: s.bps,
      owed: 0n,
    })),
  }));

  return {
    name: input.name,
    agreementId: BigInt(Date.now()),
    creator,
    supply: input.supply,
    sharePrice: input.sharePrice,
    status: "active",
    tiers,
    holders: [],
    totalDeposited: 0n,
    sharesSold: 0n,
    treasury: input.supply,
    vault: 0n,
    startTime: input.startTime,
    expTime: input.expTime,
    endCap: input.endCap,
    claimWindow: input.claimWindow === null ? null : Number(input.claimWindow),
    claimDeadline: null,
    depositor: input.depositor,
    complianceAdmin: input.complianceAdmin,
    buyerUsdc: 1_000_000_000_000n, // 1M demo USDC
    depositorUsdc: 10_000_000_000_000n, // 10M demo revenue
    creatorUsdc: 0n,
    log: [],
  };
}

function requireActive(a: SimAgreement): void {
  if (a.status !== "active")
    throw new SimError("AgreementNotActive", "This agreement is no longer active.");
}

export function purchase(
  a: SimAgreement,
  buyerId: string,
  buyerLabel: string,
  amount: bigint,
  nowTs: number,
): void {
  requireActive(a);
  if (a.startTime !== null && nowTs < a.startTime)
    throw new SimError("SaleNotStarted", "The sale has not started yet.");
  if (amount <= 0n) throw new SimError("InvalidAmount", "Enter an amount above 0.");
  if (a.treasury < amount)
    throw new SimError("InsufficientTreasuryShares", `Only ${a.treasury} shares are left.`);

  let holder = a.holders.find((h) => h.id === buyerId);
  const cost = amount * a.sharePrice;
  if (a.buyerUsdc < cost)
    throw new SimError("InsufficientFunds", `You need ${cost} USDC for that many shares.`);

  a.buyerUsdc -= cost;
  a.creatorUsdc += cost;

  if (!holder) {
    holder = { id: buyerId, label: buyerLabel, balance: 0n, claim: snapshotClaim(a.tiers) };
    a.holders.push(holder);
  } else if (holder.claim.frozen) {
    throw new SimError("FrozenPosition", "This account is frozen by the compliance admin.");
  }

  const from = holder; // treasury → buyer fires the hook
  const receiverBefore = from.balance;
  a.treasury -= amount;
  from.balance += amount;
  a.sharesSold += amount;
  settleTransfer(from.claim, receiverBefore, from.claim, receiverBefore, a.tiers);

  a.log.push({ ix: "purchase_share", label: `${buyerLabel} bought ${amount} shares`, amount: cost, signature: simSig() });
}

export function deposit(a: SimAgreement, depositorId: string, amount: bigint, nowTs: number): void {
  requireActive(a);
  if (depositorId !== a.depositor)
    throw new SimError("UnauthorizedDepositor", "Only the designated depositor can add revenue. Switch to the depositor wallet.");
  if (amount <= 0n) throw new SimError("InvalidAmount", "Enter an amount above 0.");
  if (a.depositorUsdc < amount)
    throw new SimError("InsufficientFunds", `The depositor needs ${amount} USDC.`);
  void nowTs;

  a.depositorUsdc -= amount;
  a.vault += amount;
  waterfall(a.tiers, a.supply, amount);
  a.totalDeposited += amount;

  a.log.push({ ix: "deposit_revenue", label: `Deposited ${amount} USDC of revenue`, amount, signature: simSig() });
}

export function claimShare(a: SimAgreement, holderId: string): bigint {
  const holder = a.holders.find((h) => h.id === holderId);
  if (!holder) throw new SimError("MissingClaimRecord", "This wallet has no claim record yet. Buy shares first.");
  if (holder.claim.frozen)
    throw new SimError("FrozenPosition", "This account is frozen by the compliance admin. You can't transfer or claim until it is unfrozen. Your accrued revenue is kept.");

  const payout = syncClaim(holder.claim, a.tiers, holder.balance);
  if (payout <= 0n) throw new SimError("NothingToClaim", "Nothing to claim yet. You will see earnings after the next deposit.");
  if (a.vault < payout) throw new SimError("InsufficientVaultFunds", "The vault holds less than this claim.");

  a.vault -= payout;
  a.log.push({ ix: "claim_tier_share", label: `${holder.label} claimed`, amount: payout, signature: simSig() });
  return payout;
}

/** Claim for a Wallet party (creator etc.) — sums owed across tiers. */
export function claimParty(a: SimAgreement, partyId: string): bigint {
  let owed = 0n;
  for (const t of a.tiers) {
    for (const s of t.splits) {
      if (s.party.kind === "wallet" && s.party.address === partyId) {
        owed += s.owed;
        s.owed = 0n;
      }
    }
  }
  if (owed <= 0n) throw new SimError("NothingToClaim", "Nothing to claim yet.");
  if (a.vault < owed) throw new SimError("InsufficientVaultFunds", "The vault holds less than this claim.");
  a.vault -= owed;
  a.creatorUsdc += owed;
  a.log.push({ ix: "claim_party_share", label: "Wallet party claimed", amount: owed, signature: simSig() });
  return owed;
}

export function transferShares(a: SimAgreement, fromId: string, fromLabel: string, toId: string, toLabel: string, amount: bigint): void {
  const from = a.holders.find((h) => h.id === fromId);
  if (!from) throw new SimError("MissingClaimRecord", `${fromLabel} has no claim record.`);
  if (from.claim.frozen)
    throw new SimError("FrozenPosition", "This account is frozen by the compliance admin.");
  if (from.balance < amount) throw new SimError("InsufficientBalance", `${fromLabel} holds only ${from.balance} shares.`);
  if (amount <= 0n) throw new SimError("InvalidAmount", "Enter an amount above 0.");

  let to = a.holders.find((h) => h.id === toId);
  if (!to) {
    to = { id: toId, label: toLabel, balance: 0n, claim: snapshotClaim(a.tiers) };
    a.holders.push(to);
  } else if (to.claim.frozen) {
    throw new SimError("FrozenPosition", "The receiving account is frozen.");
  }

  // Hook runs after balances moved → reconstruct pre-transfer balances.
  const fromBefore = from.balance;
  const toBefore = to.balance - amount; // after transfer the balance already includes amount
  from.balance -= amount;
  to.balance += amount;
  settleTransfer(from.claim, fromBefore, to.claim, toBefore, a.tiers);

  a.log.push({ ix: "transfer_hook", label: `${fromLabel} → ${toLabel}: ${amount} shares`, amount, signature: simSig() });
}

export function freezePosition(a: SimAgreement, holderId: string): void {
  const holder = a.holders.find((h) => h.id === holderId);
  if (!holder) throw new SimError("MissingClaimRecord", "This wallet has no claim record yet.");
  if (holder.claim.frozen) throw new SimError("PositionAlreadyFrozen", "This position is already frozen.");
  holder.claim.frozen = true;
  a.log.push({ ix: "freeze_position", label: `Froze ${holder.label}`, signature: simSig() });
}

export function unfreezePosition(a: SimAgreement, holderId: string): void {
  const holder = a.holders.find((h) => h.id === holderId);
  if (!holder) throw new SimError("MissingClaimRecord", "This wallet has no claim record yet.");
  if (!holder.claim.frozen) throw new SimError("PositionAlreadyUnfrozen", "This position is already unfrozen.");
  holder.claim.frozen = false;
  a.log.push({ ix: "unfreeze_position", label: `Unfroze ${holder.label}`, signature: simSig() });
}

export function canExpire(a: SimAgreement, nowTs: number): boolean {
  if (a.status !== "active") return false;
  if (a.expTime !== null && nowTs >= a.expTime) return true;
  if (a.endCap !== null && a.totalDeposited >= a.endCap) return true;
  return false;
}

export function expire(a: SimAgreement, nowTs: number): bigint {
  if (a.status !== "active")
    throw new SimError("AgreementNotActive", "This agreement is no longer active.");
  if (!canExpire(a, nowTs))
    throw new SimError("EndConditionNotMet", "Neither expiry time nor cumulative revenue cap has been reached.");
  a.status = "expired";
  if (a.claimWindow !== null) a.claimDeadline = nowTs + Number(a.claimWindow);
  const burned = a.treasury;
  a.treasury = 0n;
  a.log.push({ ix: "expire_agreement", label: `Expired — burned ${burned} unsold shares`, amount: burned, signature: simSig() });
  return burned;
}

export function canClose(a: SimAgreement, nowTs: number): { ok: boolean; reason?: string } {
  if (a.status !== "expired") return { ok: false, reason: "Expire the agreement first." };
  if (a.treasury > 0n) return { ok: false, reason: "The treasury still holds shares. Expire first to burn them." };
  if (a.vault <= 1_000n) return { ok: true };
  if (a.claimDeadline !== null && nowTs >= a.claimDeadline) return { ok: true };
  return { ok: false, reason: "The claim window is still open and the vault still holds funds." };
}

export function close(a: SimAgreement): { returned: bigint; rent: number } {
  const returned = a.vault;
  a.vault = 0n;
  a.status = "closed";
  a.log.push({ ix: "close_agreement", label: `Closed — creator received ${returned} USDC`, amount: returned, signature: simSig() });
  return { returned, rent: 0.05 * 1_000_000 }; // illustrative rent
}

/** Holder claimable, for UI previews. */
export function claimable(a: SimAgreement, holderId: string): bigint {
  const holder = a.holders.find((h) => h.id === holderId);
  if (!holder || holder.claim.frozen) return 0n;
  return syncClaimForPreview(holder.claim, a.tiers, holder.balance);
}

function syncClaimForPreview(claim: ClaimState, tiers: Tier[], balance: bigint): bigint {
  const probe: ClaimState = { lastAcc: [...claim.lastAcc], pending: [...claim.pending], frozen: claim.frozen };
  return syncClaim(probe, tiers, balance);
}

export { blankClaim };
