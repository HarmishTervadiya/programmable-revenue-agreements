import type { Tier } from "@/lib/math/accumulator";

export type ProtocolMode = "mock" | "devnet";

export type AgreementStatus = "active" | "expired" | "closed";

export type Role = "creator" | "backer" | "depositor" | "admin";

/** One walkable wallet in the demo. `id` doubles as its (mock) address. */
export interface Persona {
  id: string;
  label: string;
  role: Role;
  /** Base58-shaped address (mock) or a real pubkey (devnet). */
  address: string;
}

export type IxName =
  | "initialize_agreement"
  | "purchase_share"
  | "deposit_revenue"
  | "claim_tier_share"
  | "claim_party_share"
  | "transfer_hook"
  | "freeze_position"
  | "unfreeze_position"
  | "expire_agreement"
  | "close_agreement";

export type TxPhase =
  | "idle"
  | "building"
  | "awaiting-signature"
  | "confirming"
  | "confirmed"
  | "failed";

export interface LogEntry {
  seq: number;
  ix: IxName;
  label: string;
  /** Addresses touched by the instruction, in account order. */
  accounts: string[];
  /** Human-readable state snapshot before / after the instruction. */
  before: string;
  after: string;
  amount?: bigint;
  signature: string;
  /** Mock clock seconds at execution. */
  ts: number;
}

export interface Holder {
  id: string;
  label: string;
  balance: bigint;
  claim: { lastAcc: bigint[]; pending: bigint[]; frozen: boolean };
}

export interface AgreementState {
  name: string;
  agreementId: bigint;
  creator: string;
  supply: bigint;
  sharePrice: bigint;
  status: AgreementStatus;
  tiers: Tier[];
  holders: Holder[];
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
  /** Persona id → USDC balance (6dp base units). */
  usdc: Record<string, bigint>;
  log: LogEntry[];
}

export interface CreateInput {
  name: string;
  supply: bigint;
  sharePrice: bigint;
  tiers: {
    threshold: bigint | null;
    splits: { kind: "holders" | "wallet"; bps: number; address?: string }[];
  }[];
  expTime: number | null;
  endCap: bigint | null;
  claimWindow: bigint | null;
  startTime: number | null;
  depositor: string;
  complianceAdmin: string;
}

export type SubmitParams =
  | { ix: "initialize_agreement"; input: CreateInput; creator: string }
  | { ix: "purchase_share"; buyerId: string; buyerLabel: string; amount: bigint }
  | { ix: "deposit_revenue"; depositorId: string; amount: bigint }
  | { ix: "claim_tier_share"; holderId: string }
  | { ix: "claim_party_share"; partyId: string }
  | {
      ix: "transfer_hook";
      fromId: string;
      fromLabel: string;
      toId: string;
      toLabel: string;
      amount: bigint;
    }
  | { ix: "freeze_position"; holderId: string }
  | { ix: "unfreeze_position"; holderId: string }
  | { ix: "expire_agreement" }
  | { ix: "close_agreement" };

/** Plain-sentence failure, mirrors the program's error map. */
export class ProtocolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ProtocolError";
  }
}

export class NotImplementedError extends ProtocolError {
  constructor(what: string) {
    super(
      "NotImplementedYet",
      `${what} is not wired to devnet yet. Run the demo with VITE_PROTOCOL_MODE=mock.`,
    );
    this.name = "NotImplementedError";
  }
}
