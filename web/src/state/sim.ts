import { create } from "zustand";
import {
  canClose,
  canExpire,
  claimParty,
  claimShare,
  close,
  createAgreement,
  deposit,
  expire,
  freezePosition,
  purchase,
  transferShares,
  unfreezePosition,
  type CreateSimInput,
  type SimAgreement,
  type SimLogEntry,
} from "@/lib/sim/simulator";

interface SimState {
  agreement: SimAgreement | null;
  /** Bumped on every mutation so components re-read the mutated object. */
  version: number;
  txLog: SimLogEntry[];
  lastSignature: string | null;
  create: (input: CreateSimInput, creator: string) => void;
  buy: (buyerId: string, label: string, amount: bigint) => void;
  depositRevenue: (depositorId: string, amount: bigint) => void;
  claim: (holderId: string) => bigint;
  claimParty: (partyId: string) => bigint;
  transfer: (fromId: string, fromLabel: string, toId: string, toLabel: string, amount: bigint) => void;
  freeze: (holderId: string) => void;
  unfreeze: (holderId: string) => void;
  doExpire: (nowTs?: number) => bigint;
  doClose: (nowTs?: number) => { returned: bigint; rent: number };
  canExpire: (nowTs?: number) => boolean;
  canClose: (nowTs?: number) => { ok: boolean; reason?: string };
  reset: () => void;
}

const now = () => Math.floor(Date.now() / 1000);

export const useSim = create<SimState>((set, get) => ({
  agreement: null,
  version: 0,
  txLog: [],
  lastSignature: null,

  create: (input, creator) => {
    const agreement = createAgreement(input, creator);
    set({ agreement, version: get().version + 1, txLog: [], lastSignature: null });
  },

  buy: (buyerId, label, amount) => {
    const a = get().agreement;
    if (!a) return;
    purchase(a, buyerId, label, amount, now());
    finish(set, get, a);
  },

  depositRevenue: (depositorId, amount) => {
    const a = get().agreement;
    if (!a) return;
    deposit(a, depositorId, amount, now());
    finish(set, get, a);
  },

  claim: (holderId) => {
    const a = get().agreement;
    if (!a) return 0n;
    const payout = claimShare(a, holderId);
    finish(set, get, a);
    return payout;
  },

  claimParty: (partyId) => {
    const a = get().agreement;
    if (!a) return 0n;
    const payout = claimParty(a, partyId);
    finish(set, get, a);
    return payout;
  },

  transfer: (fromId, fromLabel, toId, toLabel, amount) => {
    const a = get().agreement;
    if (!a) return;
    transferShares(a, fromId, fromLabel, toId, toLabel, amount);
    finish(set, get, a);
  },

  freeze: (holderId) => {
    const a = get().agreement;
    if (!a) return;
    freezePosition(a, holderId);
    finish(set, get, a);
  },

  unfreeze: (holderId) => {
    const a = get().agreement;
    if (!a) return;
    unfreezePosition(a, holderId);
    finish(set, get, a);
  },

  doExpire: (ts) => {
    const a = get().agreement;
    if (!a) return 0n;
    const burned = expire(a, ts ?? now());
    finish(set, get, a);
    return burned;
  },

  doClose: (ts) => {
    const a = get().agreement;
    if (!a) return { returned: 0n, rent: 0 };
    const r = close(a);
    finish(set, get, a);
    void ts;
    return r;
  },

  canExpire: (ts) => {
    const a = get().agreement;
    return a ? canExpire(a, ts ?? now()) : false;
  },

  canClose: (ts) => {
    const a = get().agreement;
    return a ? canClose(a, ts ?? now()) : { ok: false, reason: "No agreement." };
  },

  reset: () => set({ agreement: null, version: 0, txLog: [], lastSignature: null }),
}));

function finish(
  set: (partial: Partial<SimState>) => void,
  get: () => SimState,
  a: SimAgreement,
) {
  const last = a.log[a.log.length - 1];
  set({
    agreement: { ...a },
    version: get().version + 1,
    txLog: [...a.log],
    lastSignature: last?.signature ?? null,
  });
}

/** Demo seed matching the study-guide worked example (§4.4 / §9). */
export function workedExampleInput(): CreateSimInput {
  return {
    name: "Music advance — 100k",
    supply: 1_000_000_000n, // 1,000 tokens (6dp)
    sharePrice: 50_000_000n, // $50.00
    tiers: [
      { threshold: 10_000_000_000n, splits: [{ kind: "holders", bps: 10_000 }] },
      {
        threshold: 30_000_000_000n,
        splits: [
          { kind: "holders", bps: 7_000 },
          { kind: "wallet", bps: 3_000, address: "CREATOR" },
        ],
      },
      {
        threshold: null,
        splits: [
          { kind: "holders", bps: 4_000 },
          { kind: "wallet", bps: 6_000, address: "CREATOR" },
        ],
      },
    ],
    expTime: null,
    endCap: 60_000_000_000n, // 60,000 USDC
    claimWindow: 7n * 24n * 60n * 60n,
    startTime: null,
    depositor: "DEPOSITOR",
    complianceAdmin: "ADMIN",
  };
}
