import {
  settleTransfer,
  snapshotClaim,
  syncClaim,
  waterfall,
} from "@/lib/math/accumulator";
import { PROGRAM_ID } from "@/lib/config";
import { canClose, canExpire, type ChecklistItem, type ProtocolClient, type ProtocolEvent, type ProtocolListener, type TxResult } from "./client";
import { fmtTokens, fmtUsd } from "./format";
import { mockBase58 } from "./ids";
import { ProtocolError, type AgreementState, type CreateInput, type IxName, type LogEntry, type Persona, type SubmitParams, type TxPhase } from "./types";

const USDC = 1_000_000n;

export interface MockClientOptions {
  /** Multiplier for simulated stage delays. 0 = instant (tests). Default 1. */
  speed?: number;
  /** Fixed starting clock (unix seconds). Default: wall clock. */
  startTime?: number;
}

/**
 * In-memory ProtocolClient. Same maths as the on-chain program
 * (lib/math/accumulator.ts), no RPC, simulated clock, staged transactions.
 * This is the only place mock data lives — components never import it.
 */
export class MockClient implements ProtocolClient {
  readonly mode = "mock" as const;

  private readonly speed: number;
  private readonly start: number;
  private clock: number;
  private state: AgreementState | null = null;
  private wallets: Record<string, bigint> = {};
  private listeners = new Set<ProtocolListener>();
  private sigCounter = 0;
  private version = 0;

  private readonly pdas = {
    agreement: mockBase58("pda/agreement"),
    treasury: mockBase58("pda/treasury"),
    vault: mockBase58("pda/vault"),
    mint: mockBase58("pda/mint"),
    hook: mockBase58("pda/hook"),
    claim: mockBase58("pda/claim"),
    tier: mockBase58("pda/tier"),
  };

  constructor(options: MockClientOptions = {}) {
    this.speed = options.speed ?? 1;
    this.start = options.startTime ?? Math.floor(Date.now() / 1000);
    this.clock = this.start;
  }

  // — ProtocolClient ————————————————————————————————————————

  now(): Promise<number> {
    return Promise.resolve(this.clock);
  }

  getState(): Promise<AgreementState | null> {
    return Promise.resolve(this.state);
  }

  subscribe(listener: ProtocolListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async advanceDays(days: number): Promise<number> {
    this.clock += Math.round(days * 86_400);
    this.emit({ type: "clock", now: this.clock });
    return this.clock;
  }

  async reset(personas: Persona[]): Promise<void> {
    this.state = null;
    this.wallets = {};
    for (const p of personas) {
      this.wallets[p.id] =
        p.role === "depositor" ? 10_000_000n * USDC : p.role === "creator" ? 0n : 1_000_000n * USDC;
    }
    this.clock = this.start;
    this.version += 1;
    this.emit({ type: "state", state: null, log: [], version: this.version });
    this.emit({ type: "clock", now: this.clock });
  }

  async submit(params: SubmitParams): Promise<TxResult> {
    const signature = this.newSignature();
    const title = TITLES[params.ix];
    const checklist: ChecklistItem[] = CHECKS[params.ix].map((label) => ({ label, done: false }));

    await this.runStages(signature, params.ix, title, checklist);

    try {
      const value = this.apply(params, signature);
      this.emit({
        type: "tx",
        progress: { signature, ix: params.ix, title, phase: "confirmed", checklist: allDone(checklist), computeUnits: CU[params.ix], logs: programLogs(params.ix) },
      });
      this.version += 1;
      this.emit({ type: "state", state: this.state, log: this.state?.log ?? [], version: this.version });
      return value === undefined ? { signature } : { signature, value };
    } catch (err) {
      this.emit({
        type: "tx",
        progress: { signature, ix: params.ix, title, phase: "failed", checklist, computeUnits: CU[params.ix], logs: programLogs(params.ix) },
      });
      throw err;
    }
  }

  // — Stage machine ————————————————————————————————————————

  private async runStages(signature: string, ix: IxName, title: string, checklist: ChecklistItem[]): Promise<void> {
    const base = { signature, ix, title, computeUnits: CU[ix], logs: programLogs(ix) };
    const emit = (phase: TxPhase, items: ChecklistItem[]) =>
      this.emit({ type: "tx", progress: { ...base, phase, checklist: items } });

    emit("building", checklist);
    await this.wait(200);
    emit("awaiting-signature", checklist);
    await this.wait(300);
    emit("confirming", checklist);

    // Tick the checklist across the confirming window (real time only).
    const duration = 500 + Math.floor(Math.random() * 400);
    if (this.speed > 0) {
      checklist.forEach((_, i) => {
        setTimeout(
          () => {
            const items = checklist.map((c, j) => (j <= i ? { ...c, done: true } : c));
            emit("confirming", items);
          },
          ((duration * this.speed) * (i + 1)) / (checklist.length + 1),
        );
      });
    }
    await this.wait(duration);
  }

  private wait(ms: number): Promise<void> {
    const scaled = ms * this.speed;
    if (scaled <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, scaled));
  }

  // — Mutations (port of the simulator, same rules as the program) ————————

  private apply(params: SubmitParams, signature: string): bigint | undefined {
    const before = snapshot(this.state);

    switch (params.ix) {
      case "initialize_agreement": {
        if (this.state)
          throw new ProtocolError("AlreadyInitialized", "An agreement already exists. Reset the demo to start over.");
        this.state = this.createAgreement(params.input, params.creator);
        this.logEntry(
          "initialize_agreement",
          `Created ${params.input.name} — ${fmtTokens(params.input.supply)} tokens at ${fmtUsd(params.input.sharePrice, 0)}`,
          [params.creator, this.pdas.agreement, this.pdas.mint, this.pdas.vault],
          undefined,
          before,
          signature,
        );
        break;
      }

      case "purchase_share": {
        const a = this.requireState();
        this.requireActive(a);
        if (a.startTime !== null && this.clock < a.startTime)
          throw new ProtocolError("SaleNotStarted", "The sale has not started yet.");
        if (params.amount <= 0n) throw new ProtocolError("InvalidAmount", "Enter an amount above 0.");
        if (a.treasury < params.amount)
          throw new ProtocolError("InsufficientTreasuryShares", `Only ${fmtTokens(a.treasury)} shares are left.`);

        const holder = a.holders.find((h) => h.id === params.buyerId);
        if (holder?.claim.frozen)
          throw new ProtocolError("FrozenPosition", "This account is frozen by the compliance admin.");

        const cost = (params.amount * a.sharePrice) / USDC;
        const balance = a.usdc[params.buyerId] ?? 0n;
        if (balance < cost)
          throw new ProtocolError("InsufficientFunds", `You need ${fmtUsd(cost)} for that many shares.`);

        a.usdc[params.buyerId] = balance - cost;
        a.usdc[a.creator] = (a.usdc[a.creator] ?? 0n) + cost;

        const target = holder ?? this.pushHolder(a, params.buyerId, params.buyerLabel);
        const receiverBefore = target.balance;
        a.treasury -= params.amount;
        target.balance += params.amount;
        a.sharesSold += params.amount;
        settleTransfer(target.claim, receiverBefore, target.claim, receiverBefore, a.tiers);

        this.logEntry("purchase_share", `${params.buyerLabel} bought ${fmtTokens(params.amount)} shares`, [this.pdas.treasury, params.buyerId, this.pdas.mint, this.pdas.hook], cost, before, signature);
        return cost;
      }

      case "deposit_revenue": {
        const a = this.requireState();
        this.requireActive(a);
        if (params.depositorId !== a.depositor)
          throw new ProtocolError("UnauthorizedDepositor", "Only the designated depositor can add revenue. Switch to the depositor wallet.");
        if (params.amount <= 0n) throw new ProtocolError("InvalidAmount", "Enter an amount above 0.");
        const balance = a.usdc[params.depositorId] ?? 0n;
        if (balance < params.amount)
          throw new ProtocolError("InsufficientFunds", `The depositor needs ${fmtUsd(params.amount)}.`);

        a.usdc[params.depositorId] = balance - params.amount;
        a.vault += params.amount;
        waterfall(a.tiers, a.supply, params.amount);
        a.totalDeposited += params.amount;

        this.logEntry("deposit_revenue", `Deposited ${fmtUsd(params.amount)} of revenue`, [params.depositorId, this.pdas.vault, this.pdas.agreement], params.amount, before, signature);
        return params.amount;
      }

      case "claim_tier_share": {
        const a = this.requireState();
        const holder = a.holders.find((h) => h.id === params.holderId);
        if (!holder)
          throw new ProtocolError("MissingClaimRecord", "This wallet has no claim record yet. Buy shares first.");
        if (holder.claim.frozen)
          throw new ProtocolError("FrozenPosition", "This account is frozen by the compliance admin. You can't transfer or claim until it is unfrozen. Your accrued revenue is kept.");

        const payout = syncClaim(holder.claim, a.tiers, holder.balance);
        if (payout <= 0n)
          throw new ProtocolError("NothingToClaim", "Nothing to claim yet. You will see earnings after the next deposit.");
        if (a.vault < payout)
          throw new ProtocolError("InsufficientVaultFunds", "The vault holds less than this claim.");

        a.vault -= payout;
        a.usdc[holder.id] = (a.usdc[holder.id] ?? 0n) + payout;
        this.logEntry("claim_tier_share", `${holder.label} claimed ${fmtUsd(payout)}`, [holder.id, this.pdas.vault, this.pdas.claim], payout, before, signature);
        return payout;
      }

      case "claim_party_share": {
        const a = this.requireState();
        let owed = 0n;
        for (const t of a.tiers)
          for (const s of t.splits)
            if (s.party.kind === "wallet" && s.party.address === params.partyId) {
              owed += s.owed;
              s.owed = 0n;
            }
        if (owed <= 0n) throw new ProtocolError("NothingToClaim", "Nothing to claim yet. You will see earnings after the next deposit.");
        if (a.vault < owed)
          throw new ProtocolError("InsufficientVaultFunds", "The vault holds less than this claim.");

        a.vault -= owed;
        a.usdc[params.partyId] = (a.usdc[params.partyId] ?? 0n) + owed;
        this.logEntry("claim_party_share", `Wallet party claimed ${fmtUsd(owed)}`, [params.partyId, this.pdas.vault, this.pdas.tier], owed, before, signature);
        return owed;
      }

      case "transfer_hook": {
        const a = this.requireState();
        if (params.amount <= 0n) throw new ProtocolError("InvalidAmount", "Enter an amount above 0.");
        const from = a.holders.find((h) => h.id === params.fromId);
        if (!from)
          throw new ProtocolError("MissingClaimRecord", `${params.fromLabel} has no claim record.`);
        if (from.claim.frozen)
          throw new ProtocolError("FrozenPosition", "This account is frozen by the compliance admin.");
        if (from.balance < params.amount)
          throw new ProtocolError("InsufficientBalance", `${params.fromLabel} holds only ${fmtTokens(from.balance)} shares.`);

        let to = a.holders.find((h) => h.id === params.toId);
        if (to?.claim.frozen)
          throw new ProtocolError("FrozenPosition", "The receiving account is frozen.");
        if (!to) to = this.pushHolder(a, params.toId, params.toLabel);

        const fromBefore = from.balance;
        const toBefore = to.balance - params.amount;
        from.balance -= params.amount;
        to.balance += params.amount;
        settleTransfer(from.claim, fromBefore, to.claim, toBefore, a.tiers);

        this.logEntry("transfer_hook", `${params.fromLabel} → ${params.toLabel}: ${fmtTokens(params.amount)} shares`, [params.fromId, params.toId, this.pdas.hook], params.amount, before, signature);
        return params.amount;
      }

      case "freeze_position": {
        const a = this.requireState();
        const holder = a.holders.find((h) => h.id === params.holderId);
        if (!holder)
          throw new ProtocolError("MissingClaimRecord", "This wallet has no claim record yet.");
        if (holder.claim.frozen)
          throw new ProtocolError("PositionAlreadyFrozen", "This position is already frozen.");
        holder.claim.frozen = true;
        this.logEntry("freeze_position", `Froze ${holder.label}`, [a.complianceAdmin, holder.id, this.pdas.claim], undefined, before, signature);
        return;
      }

      case "unfreeze_position": {
        const a = this.requireState();
        const holder = a.holders.find((h) => h.id === params.holderId);
        if (!holder)
          throw new ProtocolError("MissingClaimRecord", "This wallet has no claim record yet.");
        if (!holder.claim.frozen)
          throw new ProtocolError("PositionAlreadyUnfrozen", "This position is already unfrozen.");
        holder.claim.frozen = false;
        this.logEntry("unfreeze_position", `Unfroze ${holder.label}`, [a.complianceAdmin, holder.id, this.pdas.claim], undefined, before, signature);
        return;
      }

      case "expire_agreement": {
        const a = this.requireState();
        if (a.status !== "active")
          throw new ProtocolError("AgreementNotActive", "This agreement is no longer active.");
        if (!canExpire(a, this.clock))
          throw new ProtocolError("EndConditionNotMet", "Neither expiry time nor cumulative revenue cap has been reached.");
        a.status = "expired";
        if (a.claimWindow !== null) a.claimDeadline = this.clock + a.claimWindow;
        const burned = a.treasury;
        a.treasury = 0n;
        this.logEntry("expire_agreement", `Expired — burned ${fmtTokens(burned)} unsold shares`, [a.creator, this.pdas.agreement, this.pdas.treasury], burned, before, signature);
        return burned;
      }

      case "close_agreement": {
        const a = this.requireState();
        const gate = canClose(a, this.clock);
        if (!gate.ok) {
          if (a.status !== "expired")
            throw new ProtocolError("NotExpiredYet", gate.reason ?? "Expire the agreement first.");
          throw new ProtocolError("ClaimWindowOpen", gate.reason ?? "The claim window is still open.");
        }
        const returned = a.vault;
        a.vault = 0n;
        a.status = "closed";
        a.usdc[a.creator] = (a.usdc[a.creator] ?? 0n) + returned;
        this.logEntry("close_agreement", `Closed — creator received ${fmtUsd(returned)}`, [a.creator, this.pdas.agreement, this.pdas.vault], returned, before, signature);
        return returned;
      }
    }
  }

  private createAgreement(input: CreateInput, creator: string): AgreementState {
    if (input.tiers.length < 1 || input.tiers.length > 5)
      throw new ProtocolError("InvalidTierCount", "You need between 1 and 5 tiers.");
    const last = input.tiers[input.tiers.length - 1];
    if (last.threshold !== null)
      throw new ProtocolError("LastTierMustBeUncapped", "The last tier must have no limit, so every deposit has somewhere to go.");
    let prev = 0n;
    for (let i = 0; i < input.tiers.length; i++) {
      const t = input.tiers[i];
      if (t.threshold !== null && t.threshold <= prev)
        throw new ProtocolError("ThresholdsNotIncreasing", "Each tier's threshold must be higher than the one before it.");
      if (t.threshold !== null) prev = t.threshold;
      const sum = t.splits.reduce((s, x) => s + x.bps, 0);
      if (sum !== 10_000)
        throw new ProtocolError("SplitsMustSumTo10000", `Splits in tier ${i + 1} total ${sum / 100}%. They must equal 100%.`);
      if (t.splits.length < 1 || t.splits.length > 4)
        throw new ProtocolError("InvalidSplitCount", "Each tier needs 1 to 4 splits.");
    }
    if (input.expTime === null && input.endCap === null)
      throw new ProtocolError("ExpOrCapRequired", "Set an expiry date, a revenue cap, or both.");
    if (input.supply <= 0n) throw new ProtocolError("InvalidSupply", "Supply must be above 0.");
    if (input.sharePrice <= 0n) throw new ProtocolError("InvalidPrice", "Share price must be above 0.");
    if (input.complianceAdmin === creator)
      throw new ProtocolError("AdminCannotBeCreator", "The compliance admin can't be the creator. Choose another wallet.");

    return {
      name: input.name,
      agreementId: BigInt(this.clock),
      creator,
      supply: input.supply,
      sharePrice: input.sharePrice,
      status: "active",
      tiers: input.tiers.map((t) => ({
        threshold: t.threshold,
        filled: 0n,
        accPerToken: 0n,
        splits: t.splits.map((s) => ({
          party: s.kind === "holders" ? { kind: "holders" as const } : { kind: "wallet" as const, address: s.address ?? "" },
          bps: s.bps,
          owed: 0n,
        })),
      })),
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
      usdc: { ...this.wallets },
      log: [],
    };
  }

  // — Internals ————————————————————————————————————————————

  private requireState(): AgreementState {
    if (!this.state)
      throw new ProtocolError("NoAgreement", "Create the agreement first.");
    return this.state;
  }

  private requireActive(a: AgreementState): void {
    if (a.status !== "active")
      throw new ProtocolError("AgreementNotActive", "This agreement is no longer active.");
  }

  private pushHolder(a: AgreementState, id: string, label: string) {
    const holder = { id, label, balance: 0n, claim: snapshotClaim(a.tiers) };
    a.holders.push(holder);
    return holder;
  }

  private logEntry(ix: IxName, label: string, accounts: string[], amount: bigint | undefined, before: string, signature: string): void {
    const a = this.state;
    if (!a) return;
    const entry: LogEntry = {
      seq: a.log.length,
      ix,
      label,
      accounts,
      before,
      after: snapshot(a),
      amount,
      signature,
      ts: this.clock,
    };
    a.log.push(entry);
  }

  private newSignature(): string {
    return mockBase58(`sig/${this.sigCounter++}`, 88);
  }

  private emit(event: ProtocolEvent): void {
    for (const l of this.listeners) l(event);
  }
}

// — Copy tables ————————————————————————————————————————————

const TITLES: Record<IxName, string> = {
  initialize_agreement: "Create agreement",
  purchase_share: "Buy shares",
  deposit_revenue: "Deposit revenue",
  claim_tier_share: "Claim revenue",
  claim_party_share: "Claim wallet share",
  transfer_hook: "Transfer shares",
  freeze_position: "Freeze position",
  unfreeze_position: "Unfreeze position",
  expire_agreement: "Expire agreement",
  close_agreement: "Close agreement",
};

const CHECKS: Record<IxName, string[]> = {
  initialize_agreement: [
    "Agreement + tier state created",
    "Token-2022 extensions initialised (frozen default, transfer hook)",
    "Entitlement mint created (6 decimals)",
    "Treasury created and thawed",
    "Vault created (program-owned)",
    "Hook extra-account list registered",
    "Supply minted, mint authority revoked",
  ],
  purchase_share: [
    "Buyer USDC debited to creator treasury",
    "Treasury → buyer transfer fires (hook)",
    "Hook settles accrued revenue on both claim records",
    "Claim record synced to current accumulators",
  ],
  deposit_revenue: [
    "Depositor USDC moved to the vault",
    "Waterfall fills tiers in order",
    "acc_per_token updated for holders",
    "Creator wallet share accrued",
  ],
  claim_tier_share: [
    "Claim record synced to current accumulators",
    "Payout debited from the vault",
    "Holder USDC balance credited",
  ],
  claim_party_share: [
    "Owed amounts summed across tiers",
    "Tier owed counters zeroed",
    "Vault debited, wallet credited",
  ],
  transfer_hook: [
    "Token balances moved",
    "Hook settled sender's accrued revenue",
    "Hook settled receiver's claim record",
  ],
  freeze_position: ["Position flagged frozen by compliance admin", "Transfers and claims blocked"],
  unfreeze_position: ["Position thawed", "Transfers and claims restored"],
  expire_agreement: ["End condition verified", "Unsold treasury shares burned", "Claim window opened"],
  close_agreement: ["Claim window drained", "Vault remainder returned to creator", "Accounts closed, rent returned"],
};

const CU: Record<IxName, number> = {
  initialize_agreement: 214_320,
  purchase_share: 96_411,
  deposit_revenue: 78_512,
  claim_tier_share: 71_204,
  claim_party_share: 64_880,
  transfer_hook: 104_882,
  freeze_position: 45_109,
  unfreeze_position: 44_770,
  expire_agreement: 62_771,
  close_agreement: 58_340,
};

function allDone(items: ChecklistItem[]): ChecklistItem[] {
  return items.map((c) => ({ ...c, done: true }));
}

function snapshot(a: AgreementState | null): string {
  if (!a) return "No agreement";
  return `status ${a.status} · deposited ${fmtUsd(a.totalDeposited, 0)} · vault ${fmtUsd(a.vault, 0)} · treasury ${fmtTokens(a.treasury)} shares`;
}

function camel(ix: IxName): string {
  return ix.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
}

function programLogs(ix: IxName): string[] {
  const pid = PROGRAM_ID.toString();
  return [
    `Program ${pid} invoke [1]`,
    `Program log: Instruction: ${camel(ix)}`,
    `Program ${pid} consumed ${CU[ix].toLocaleString("en-US")} units of compute budget`,
    `Program ${pid} success`,
  ];
}
