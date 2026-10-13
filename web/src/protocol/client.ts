import type {
  AgreementState,
  IxName,
  LogEntry,
  Persona,
  ProtocolMode,
  SubmitParams,
  TxPhase,
} from "./types";
import { syncClaim, waterfall, type ClaimState } from "@/lib/math/accumulator";

export interface ChecklistItem {
  label: string;
  done: boolean;
}

/** Emitted for every stage transition of one submitted instruction. */
export interface TxProgress {
  signature: string;
  ix: IxName;
  title: string;
  phase: TxPhase;
  checklist: ChecklistItem[];
  computeUnits?: number;
  logs?: string[];
}

export interface TxResult {
  signature: string;
  /** Instruction-specific result (payout, burned shares, returned funds…). */
  value?: bigint;
}

export type ProtocolEvent =
  | { type: "tx"; progress: TxProgress }
  | { type: "state"; state: AgreementState | null; log: LogEntry[]; version: number }
  | { type: "clock"; now: number };

export type ProtocolListener = (event: ProtocolEvent) => void;

/**
 * The app's single seam to the protocol. Components get this through
 * useProtocol(); swapping mock for devnet means swapping the implementation,
 * not the components.
 */
export interface ProtocolClient {
  readonly mode: ProtocolMode;
  /** Current protocol clock (unix seconds). */
  now(): Promise<number>;
  /** Full read model. null before the agreement is created. */
  getState(): Promise<AgreementState | null>;
  /** Run one instruction through build → sign → confirm. */
  submit(params: SubmitParams): Promise<TxResult>;
  /** Jump the demo clock forward (mock only; devnet uses real time). */
  advanceDays(days: number): Promise<number>;
  /** Restart the demo: clear the agreement and fund the persona wallets. */
  reset(personas: Persona[]): Promise<void>;
  subscribe(listener: ProtocolListener): () => void;
}

// — Pure read-model helpers (work over any AgreementState, mock or devnet) —

/** Holder claimable now. 0 if unknown or frozen (frozen accrues, pays later). */
export function claimableFor(a: AgreementState | null, holderId: string): bigint {
  if (!a) return 0n;
  const holder = a.holders.find((h) => h.id === holderId);
  if (!holder || holder.claim.frozen) return 0n;
  const probe: ClaimState = {
    lastAcc: [...holder.claim.lastAcc],
    pending: [...holder.claim.pending],
    frozen: holder.claim.frozen,
  };
  return syncClaim(probe, a.tiers, holder.balance);
}

/** Wallet-party claimable (creator's split across tiers). */
export function partyClaimable(a: AgreementState | null, address: string): bigint {
  if (!a) return 0n;
  let owed = 0n;
  for (const t of a.tiers)
    for (const s of t.splits)
      if (s.party.kind === "wallet" && s.party.address === address) owed += s.owed;
  return owed;
}

/** Total still owed to holders + wallet parties (the vault's liability). */
export function totalClaimable(a: AgreementState | null): bigint {
  if (!a) return 0n;
  let sum = 0n;
  for (const h of a.holders) sum += claimableFor(a, h.id);
  for (const t of a.tiers)
    for (const s of t.splits)
      if (s.party.kind === "wallet") sum += s.owed;
  return sum;
}

/** Expire is available once time passed OR the revenue cap is reached. */
export function canExpire(a: AgreementState | null, nowTs: number): boolean {
  if (!a || a.status !== "active") return false;
  if (a.expTime !== null && nowTs >= a.expTime) return true;
  if (a.endCap !== null && a.totalDeposited >= a.endCap) return true;
  return false;
}

export function expireReason(a: AgreementState | null, nowTs: number): string {
  if (!a || a.status !== "active") return "Not active.";
  const parts: string[] = [];
  if (a.expTime !== null)
    parts.push(
      a.expTime > nowTs ? `Expiry in ${Math.ceil((a.expTime - nowTs) / 86_400)} days.` : "Expiry reached.",
    );
  if (a.endCap !== null)
    parts.push(
      a.totalDeposited >= a.endCap
        ? "Revenue cap reached."
        : `Revenue cap ${Math.floor(Number(a.totalDeposited / 1_000_000n)).toLocaleString()} / ${Math.floor(Number(a.endCap / 1_000_000n)).toLocaleString()} USDC.`,
    );
  return parts.join(" ");
}

/** Close is available after expiry once the claim window drains the vault. */
export function canClose(a: AgreementState | null, nowTs: number): { ok: boolean; reason?: string } {
  if (!a) return { ok: false, reason: "No agreement." };
  if (a.status !== "expired") return { ok: false, reason: "Expire the agreement first." };
  if (a.treasury > 0n) return { ok: false, reason: "The treasury still holds shares. Expire first to burn them." };
  if (a.vault <= 1_000n) return { ok: true };
  if (a.claimDeadline !== null && nowTs >= a.claimDeadline) return { ok: true };
  const daysLeft = a.claimDeadline ? Math.ceil((a.claimDeadline - nowTs) / 86_400) : null;
  return {
    ok: false,
    reason:
      daysLeft === null
        ? "The claim window is still open and the vault still holds funds."
        : `Claim window open for ${daysLeft} more day${daysLeft === 1 ? "" : "s"} and the vault still holds funds.`,
  };
}

/** Holder position value at today's share price (whole USDC). */
export function positionValue(a: AgreementState | null, holderId: string): bigint {
  if (!a) return 0n;
  const holder = a.holders.find((h) => h.id === holderId);
  if (!holder) return 0n;
  return (holder.balance * a.sharePrice) / 1_000_000n;
}

/** Per-tier routing for a prospective deposit (read-only, mutates a copy). */
export interface DepositPreview {
  tierIndex: number;
  threshold: bigint | null;
  take: bigint;
  holders: bigint;
  party: bigint;
}

export function previewDeposit(a: AgreementState | null, amount: bigint): DepositPreview[] {
  if (!a || amount <= 0n) return [];
  const copy = a.tiers.map((t) => ({
    ...t,
    splits: t.splits.map((s) => ({ ...s })),
  }));
  const before = copy.map((t) => t.filled);
  waterfall(copy, a.supply, amount);
  return copy.map((t, i) => {
    const take = t.filled - before[i];
    let party = 0n;
    for (const s of t.splits) if (s.party.kind === "wallet") party += (take * BigInt(s.bps)) / 10_000n;
    return { tierIndex: i, threshold: t.threshold, take, holders: take - party, party };
  });
}
