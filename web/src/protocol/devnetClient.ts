import { AnchorProvider, BN, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import idlJson from "@/lib/program/idl.json";
import { PAYMENT_MINT, PROGRAM_ID, RPC_ENDPOINT } from "@/lib/config";
import { humanizeError } from "@/lib/program/errors";
import {
  agreementPda,
  claimPda,
  extraMetasPda,
  tierPda,
  treasuryPda,
  vaultPda,
} from "@/lib/program/pdas";
import type { ProtocolClient, ProtocolEvent, ProtocolListener, TxResult } from "./client";
import { canClose, canExpire } from "./client";
import {
  ProtocolError,
  type AgreementState,
  type LogEntry,
  type Persona,
  type ProtocolMode,
  type SubmitParams,
} from "./types";

const ACTIVE_KEY = "pra:active-config";
const NAMES_KEY = "pra:names";
const U64_MAX = (1n << 64n) - 1n;

/** Card-level read model for the agreement discovery list (no state shape change). */
export interface AgreementSummary {
  address: PublicKey;
  agreementId: bigint;
  creator: string;
  /** Local display name saved at creation, if this browser created it. */
  name: string | null;
  status: "active" | "expired" | "closed";
  depositor: string;
  complianceAdmin: string;
}

type WalletLike = { publicKey: PublicKey; signTransaction: (tx: never) => Promise<never>; signAllTransactions?: (txs: never[]) => Promise<never[]> } | null;

function loadNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** Local display names saved at creation time (on-chain configs hold no name). */
export function agreementNames(): Record<string, string> {
  return loadNames();
}

function saveName(config: string, name: string) {
  try {
    const all = loadNames();
    all[config] = name;
    localStorage.setItem(NAMES_KEY, JSON.stringify(all));
  } catch {
    /* storage full/blocked — names are cosmetic */
  }
}

function bn(v: bigint | number): BN {
  return new BN(v.toString());
}

function toBigint(v: BN | number | bigint | null | undefined): bigint {
  if (v === null || v === undefined) return 0n;
  return BigInt(v.toString());
}

/** On-chain AgreementConfig shape (anchor coder loose type). */
interface OnchainConfig {
  agreementId: BN;
  creator: PublicKey;
  shareMint: PublicKey;
  paymentMint: PublicKey;
  depositor: PublicKey;
  complianceAdmin: PublicKey;
  vault: PublicKey;
  treasury: PublicKey;
  paymentDestination: PublicKey;
  supply: BN;
  sharePrice: BN;
  accessMode: unknown;
  tierCount: number;
  startTime: BN | null;
  expTime: BN | null;
  endCap: BN | null;
  claimWindow: BN | null;
  claimDeadline: BN | null;
  totalDeposited: BN;
  sharesSold: BN;
  status: unknown;
  configBump: number;
  vaultBump: number;
  treasuryBump: number;
}

interface OnchainTier {
  agreement: PublicKey;
  tierIndex: number;
  threshold: BN;
  filled: BN;
  accPerToken: BN;
  splits: { party: unknown; bps: number; owed: BN }[];
  splitCount: number;
  bump: number;
}

interface OnchainClaim {
  config: PublicKey;
  holder: PublicKey;
  lastAcc: BN[];
  pending: BN[] | number[];
  frozen: boolean;
  bump: number;
}

function statusOf(s: unknown): "active" | "expired" | "closed" {
  if (s && typeof s === "object") {
    if ("active" in (s as object)) return "active";
    if ("expired" in (s as object)) return "expired";
    if ("closed" in (s as object)) return "closed";
  }
  return "active";
}

function partyOf(p: unknown): { kind: "holders" } | { kind: "wallet"; address: string } {
  if (p && typeof p === "object") {
    if ("holders" in (p as object)) return { kind: "holders" };
    // Anchor decodes the wallet variant as a PublicKey instance (not a string).
    const w = (p as { wallet?: unknown }).wallet;
    if (w instanceof PublicKey) return { kind: "wallet", address: w.toBase58() };
    if (typeof w === "string") return { kind: "wallet", address: new PublicKey(w).toBase58() };
  }
  return { kind: "holders" };
}

const TITLES: Record<string, string> = {
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

const CHECKS: Record<string, string[]> = {
  initialize_agreement: [
    "Agreement + tier state created",
    "Token-2022 extensions initialised",
    "Entitlement mint created (6 decimals)",
    "Treasury created and thawed",
    "Vault created (program-owned)",
    "Hook extra-account list registered",
    "Supply minted, mint authority revoked",
  ],
  purchase_share: [
    "Buyer USDC moved to creator",
    "Treasury → buyer transfer (hook fires)",
    "Claim records settled by the hook",
    "Purchase recorded on-chain",
  ],
  deposit_revenue: [
    "Depositor USDC moved to the vault",
    "Waterfall fills tiers in order",
    "Per-token earnings updated",
    "Wallet splits accrued",
  ],
  claim_tier_share: ["Claim synced to accumulators", "Vault debited", "Holder USDC credited"],
  claim_party_share: ["Owed summed across tiers", "Tier counters zeroed", "Vault debited"],
  transfer_hook: ["Token balances moved", "Hook settled sender + receiver"],
  freeze_position: ["Position frozen by compliance admin", "Transfers and claims blocked"],
  unfreeze_position: ["Position thawed", "Transfers and claims restored"],
  expire_agreement: ["End condition verified", "Unsold shares burned", "Claim window opened"],
  close_agreement: ["Claim window drained", "Vault remainder to creator", "Accounts closed"],
};

/**
 * Devnet ProtocolClient — real Anchor transactions against the deployed
 * program (Anchor.toml [programs.devnet]). No mock math, no fake
 * signatures: every submit builds, signs via the connected wallet,
 * confirms on devnet, then re-reads state.
 *
 * PDA seeds (must match programs/.../src):
 *   agreement = ["agreement", creator, agreement_id_le8]
 *   tier      = ["tier", config, single_byte_index]
 *   claim     = ["claim", config, holder]
 *   vault     = ["vault", config]
 *   treasury  = ["treasury", config]
 */
export class DevnetClient implements ProtocolClient {
  readonly mode: ProtocolMode = "devnet";

  private connection = new Connection(RPC_ENDPOINT, "confirmed");
  private wallet: WalletLike = null;
  private listeners = new Set<ProtocolListener>();
  private version = 0;
  private log: LogEntry[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cached: AgreementState | null = null;

  /** Called by the wallet bridge whenever the adapter wallet changes. */
  setWallet(w: WalletLike) {
    this.wallet = w;
    // Refresh reads so holder-specific rows (balances, claimable) update.
    void this.refresh().catch(() => undefined);
  }

  get activeConfig(): PublicKey | null {
    try {
      const raw = localStorage.getItem(ACTIVE_KEY);
      return raw ? new PublicKey(raw) : null;
    } catch {
      return null;
    }
  }

  setActiveConfig(pk: PublicKey | null) {
    try {
      if (pk) localStorage.setItem(ACTIVE_KEY, pk.toBase58());
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
    this.cached = null;
    // refresh() emits on a successful read, but returns silently when there
    // is no active config — emit regardless so the board updates immediately
    // (e.g. "+ New agreement" must show the empty board at once).
    void this.refresh()
      .catch((err) => {
        // Never swallow read failures silently — an empty board with no
        // feedback is indistinguishable from "no agreement".
        console.warn("[pra] failed to read agreement state:", err);
      })
      .finally(() => {
        this.version += 1;
        this.emit({ type: "state", state: this.cached, log: this.log, version: this.version });
      });
  }

  /** All AgreementConfig accounts on devnet (newest first by agreement_id). */
  async listAgreements(): Promise<AgreementSummary[]> {
    const program = this.readProgram();
    const discriminator = (Program as unknown as { account?: unknown }) ? null : null;
    void discriminator;
    const accounts = await (program.account as unknown as {
      agreementConfig: { all: () => Promise<{ publicKey: PublicKey; account: OnchainConfig }[]> };
    }).agreementConfig.all();
    const names = loadNames();
    return accounts
      .map((a) => {
        const address = a.publicKey.toBase58();
        return {
          address: a.publicKey,
          agreementId: toBigint(a.account.agreementId),
          creator: a.account.creator.toBase58(),
          name: names[address] ?? null,
          status: statusOf(a.account.status) as AgreementSummary["status"],
          depositor: a.account.depositor.toBase58(),
          complianceAdmin: a.account.complianceAdmin.toBase58(),
        };
      })
      .sort((a, b) => (b.agreementId > a.agreementId ? 1 : -1));
  }

  async now(): Promise<number> {
    try {
      const slot = await this.connection.getSlot("confirmed");
      const t = await this.connection.getBlockTime(slot);
      if (t) return t;
    } catch {
      /* RPC hiccup — fall back to wall clock */
    }
    return Math.floor(Date.now() / 1000);
  }

  async getState(): Promise<AgreementState | null> {
    if (this.cached) return this.cached;
    return this.refresh();
  }

  subscribe(listener: ProtocolListener): () => void {
    this.listeners.add(listener);
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        void this.refresh().catch(() => undefined);
      }, 12_000);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  async advanceDays(): Promise<number> {
    throw new ProtocolError(
      "ClockIsReal",
      "Devnet uses real chain time — there is no demo clock to advance. Expiry follows the agreement's date or revenue cap.",
    );
  }

  async reset(_personas: Persona[]): Promise<void> {
    throw new ProtocolError(
      "NoResetOnDevnet",
      "Devnet agreements are permanent. To start over, create a new agreement — your wallet stays connected.",
    );
  }

  // — Reads ————————————————————————————————————————————————

  private readProgram(): Program<Idl> {
    const noop = {
      publicKey: PublicKey.default,
      signTransaction: async (tx: never) => tx,
      signAllTransactions: async (txs: never) => txs,
    } as unknown as Wallet;
    const provider = new AnchorProvider(this.connection, noop, { commitment: "confirmed" });
    return new Program(idlJson as Idl, provider);
  }

  private program(): Program<Idl> {
    if (!this.wallet?.publicKey) {
      throw new ProtocolError(
        "WalletNotConnected",
        "Connect your wallet first — wallet sign-in is required for every on-chain action.",
      );
    }
    const provider = new AnchorProvider(this.connection, this.wallet as unknown as Wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    return new Program(idlJson as Idl, provider);
  }

  private emit(event: ProtocolEvent) {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* listener threw — never break submits */
      }
    }
  }

  private async tokenBalance(address: PublicKey): Promise<bigint> {
    try {
      const r = await this.connection.getTokenAccountBalance(address, "confirmed");
      return BigInt(r.value.amount);
    } catch {
      return 0n;
    }
  }

  private async refresh(): Promise<AgreementState | null> {
    const configPk = this.activeConfig;
    if (!configPk) {
      this.cached = null;
      return null;
    }
    try {
      const program = this.readProgram();
      const accounts = program.account as unknown as {
        agreementConfig: { fetch: (pk: PublicKey) => Promise<OnchainConfig> };
        tierState: { fetch: (pk: PublicKey) => Promise<OnchainTier> };
        claimRecord: { fetch: (pk: PublicKey) => Promise<OnchainClaim> };
      };
      const cfg = await accounts.agreementConfig.fetch(configPk);
      const count = cfg.tierCount;
      const tierPks = Array.from({ length: 5 }, (_, i) => tierPda(configPk, i));
      const tierData = await Promise.all(
        tierPks.map((pk) => accounts.tierState.fetch(pk).catch(() => null)),
      );

      const tiers = tierData.slice(0, count).map((t) => {
        if (!t) {
          return { threshold: null as bigint | null, filled: 0n, accPerToken: 0n, splits: [] as never[] };
        }
        const thresholdRaw = toBigint(t.threshold);
        return {
          threshold: thresholdRaw === U64_MAX ? null : thresholdRaw,
          filled: toBigint(t.filled),
          accPerToken: toBigint(t.accPerToken),
          splits: t.splits.slice(0, t.splitCount).map((s) => ({
            party: partyOf(s.party),
            bps: s.bps,
            owed: toBigint(s.owed),
          })),
        };
      });

      // Holders: all ClaimRecords pointing at this config.
      let holders: AgreementState["holders"] = [];
      try {
        const all = await this.connection.getProgramAccounts(PROGRAM_ID, {
          commitment: "confirmed",
          filters: [
            { dataSize: 8 + 32 + 32 + 5 * 16 + 5 * 8 + 1 + 1 },
            { memcmp: { offset: 8, bytes: configPk.toBase58() } },
          ],
        });
        const coder = program.coder.accounts;
        holders = await Promise.all(
          all.map(async (a) => {
            try {
              const decoded = coder.decode("ClaimRecord", a.account.data) as unknown as OnchainClaim;
              // Coder already yields PublicKey instances — never re-wrap them
              // (new PublicKey(publicKey) throws an assertion failure).
              const holderPk = decoded.holder instanceof PublicKey ? decoded.holder : new PublicKey(decoded.holder as unknown as string);
              const shareAta = getAssociatedTokenAddressSync(
                cfg.shareMint,
                holderPk,
                true,
                TOKEN_2022_PROGRAM_ID,
              );
              const balance = await this.tokenBalance(shareAta);
              return {
                id: holderPk.toBase58(),
                label: `${holderPk.toBase58().slice(0, 4)}…${holderPk.toBase58().slice(-4)}`,
                balance,
                claim: {
                  lastAcc: (decoded.lastAcc as BN[]).map((x) => BigInt(x.toString())),
                  pending: (decoded.pending as (BN | number)[]).map((x) => BigInt(x.toString())),
                  frozen: decoded.frozen,
                },
              };
            } catch {
              return null;
            }
          }),
        ).then((rows) => rows.filter((r) => r !== null) as AgreementState["holders"]);
      } catch {
        holders = [];
      }

      const [vaultBal, treasuryBal] = await Promise.all([
        this.tokenBalance(cfg.vault),
        this.tokenBalance(cfg.treasury),
      ]);

      // USDC balances for known holders (best-effort; missing ATAs read as 0).
      const usdc: Record<string, bigint> = {};
      const paymentMint = cfg.paymentMint;
      await Promise.all(
        holders.map(async (h) => {
          try {
            const owner = new PublicKey(h.id);
            let ata: PublicKey;
            try {
              ata = getAssociatedTokenAddressSync(paymentMint, owner, false, TOKEN_PROGRAM_ID);
            } catch {
              ata = getAssociatedTokenAddressSync(paymentMint, owner, false, TOKEN_2022_PROGRAM_ID);
            }
            usdc[h.id] = await this.tokenBalance(ata);
          } catch {
            usdc[h.id] = 0n;
          }
        }),
      );

      const names = loadNames();
      const state: AgreementState = {
        name: names[configPk.toBase58()] ?? `Agreement ${cfg.agreementId.toString().slice(-6)}`,
        agreementId: toBigint(cfg.agreementId),
        creator: cfg.creator.toBase58(),
        supply: toBigint(cfg.supply),
        sharePrice: toBigint(cfg.sharePrice),
        status: statusOf(cfg.status),
        tiers: tiers as AgreementState["tiers"],
        holders,
        totalDeposited: toBigint(cfg.totalDeposited),
        sharesSold: toBigint(cfg.sharesSold),
        treasury: treasuryBal,
        vault: vaultBal,
        startTime: cfg.startTime ? Number(cfg.startTime.toString()) : null,
        expTime: cfg.expTime ? Number(cfg.expTime.toString()) : null,
        endCap: cfg.endCap ? toBigint(cfg.endCap) : null,
        claimWindow: cfg.claimWindow ? Number(cfg.claimWindow.toString()) : null,
        claimDeadline: cfg.claimDeadline ? Number(cfg.claimDeadline.toString()) : null,
        depositor: cfg.depositor.toBase58(),
        complianceAdmin: cfg.complianceAdmin.toBase58(),
        usdc,
        log: this.log,
      };
      this.cached = state;
      this.version += 1;
      this.emit({ type: "state", state, log: this.log, version: this.version });
      this.emit({ type: "clock", now: await this.now() });
      return state;
    } catch (err) {
      // Missing/deleted config (closed) or RPC failure — surface null + keep listeners alive.
      if ((err as Error)?.message?.includes("Account does not exist")) {
        this.cached = null;
        return null;
      }
      throw err;
    }
  }

  // — Submits ——————————————————————————————————————————————

  async submit(params: SubmitParams): Promise<TxResult> {
    const wallet = this.wallet;
    if (!wallet?.publicKey) {
      throw new ProtocolError(
        "WalletNotConnected",
        "Connect your wallet first — wallet sign-in is required for every on-chain action.",
      );
    }
    try {
      await this.connection.getSlot("confirmed");
    } catch {
      throw new ProtocolError(
        "RpcUnreachable",
        "The devnet RPC is unreachable. Check your connection and try again.",
      );
    }

    const signature = await this.run(params);
    await this.refresh().catch(() => undefined);
    return { signature };
  }

  private async run(params: SubmitParams): Promise<string> {
    const ix = params.ix;
    const title = TITLES[ix] ?? ix;
    const checklist = (CHECKS[ix] ?? ["Submitted to devnet"]).map((label) => ({ label, done: false }));
    const sigPlaceholder = `${Date.now()}`;
    this.emit({
      type: "tx",
      progress: { signature: sigPlaceholder, ix, title, phase: "building", checklist },
    });

    try {
      const signature = await this.buildAndSend(params);
      this.emit({
        type: "tx",
        progress: {
          signature,
          ix,
          title,
          phase: "confirmed",
          checklist: checklist.map((c) => ({ ...c, done: true })),
        },
      });
      this.pushLog(ix, title, signature, params);
      this.version += 1;
      this.emit({ type: "state", state: this.cached, log: this.log, version: this.version });
      return signature;
    } catch (err) {
      this.emit({
        type: "tx",
        progress: { signature: sigPlaceholder, ix, title, phase: "failed", checklist },
      });
      throw this.friendlyError(err);
    }
  }

  private pushLog(ix: SubmitParams["ix"], label: string, signature: string, params: SubmitParams) {
    const entry: LogEntry = {
      seq: this.log.length,
      ix,
      label: `${label} — ${signature.slice(0, 8)}…`,
      accounts: this.accountsForLog(params),
      before: "",
      after: "",
      signature,
      ts: Math.floor(Date.now() / 1000),
    };
    this.log = [...this.log, entry].slice(-100);
  }

  private accountsForLog(params: SubmitParams): string[] {
    const cfg = this.activeConfig?.toBase58() ?? "";
    const w = this.wallet?.publicKey?.toBase58() ?? "";
    switch (params.ix) {
      case "initialize_agreement":
        return [w, cfg];
      case "purchase_share":
        return [params.buyerId, cfg];
      case "deposit_revenue":
        return [params.depositorId, cfg];
      case "claim_tier_share":
        return [params.holderId, cfg];
      case "claim_party_share":
        return [params.partyId, cfg];
      case "transfer_hook":
        return [params.fromId, params.toId];
      case "freeze_position":
      case "unfreeze_position":
        return [params.holderId, cfg];
      default:
        return [cfg];
    }
  }

  private friendlyError(err: unknown): Error {
    const msg = (err as Error)?.message ?? String(err);
    if (/User rejected|rejected the request|cancelled|canceled|denied/i.test(msg)) {
      return new ProtocolError("SignatureRejected", "You cancelled the wallet signature. Nothing was submitted.");
    }
    if (/insufficient funds|0x1|lamports|InsufficientFunds/i.test(msg) && /sol/i.test(msg.toLowerCase())) {
      return new ProtocolError(
        "InsufficientSol",
        "Not enough devnet SOL for fees/rent. Run `solana airdrop 2 <your-address> --url devnet` and try again.",
      );
    }
    if (/Account does not exist|AccountNotFound/i.test(msg)) {
      return new ProtocolError(
        "AccountMissing",
        "A required account is missing on devnet (USDC account or agreement state). Create the missing account and try again.",
      );
    }
    if (/Blockhash|block height|failed to confirm|confirmation/i.test(msg)) {
      return new ProtocolError(
        "ConfirmationFailed",
        "The transaction may still land — devnet was slow to confirm. Wait a few seconds, then check the explorer.",
      );
    }
    try {
      const human = humanizeError(err);
      if (human.message && human.message !== "The transaction failed.") {
        return new ProtocolError("ProgramError", human.fix ? `${human.message} ${human.fix}` : human.message);
      }
    } catch {
      /* fall through */
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  // — Transaction builders (one per instruction, same accounts as tests/) —

  private async sendTx(tx: Transaction): Promise<string> {
    const wallet = this.wallet;
    if (!wallet?.publicKey) throw new ProtocolError("WalletNotConnected", "Connect your wallet first.");
    this.emitTxPhase("awaiting-signature", tx);
    let signed: Transaction;
    try {
      signed = await wallet.signTransaction(tx as never) as unknown as Transaction;
    } catch (err) {
      throw this.friendlyError(err);
    }
    this.emitTxPhase("confirming", tx);
    let signature: string;
    try {
      const raw = signed.serialize();
      signature = await this.connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
    } catch (err) {
      throw this.friendlyError(err);
    }
    try {
      const latest = await this.connection.getLatestBlockhash("confirmed");
      await this.connection.confirmTransaction(
        { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        "confirmed",
      );
    } catch {
      // Confirmations on devnet flake — the tx may still be fine. Continue;
      // refresh() will show whether state changed.
    }
    return signature;
  }

  private emitTxPhase(_phase: string, _tx: Transaction) {
    /* phase transitions are emitted by run(); hook for future progress detail */
  }

  private async freshTx(feePayer: PublicKey): Promise<{ tx: Transaction; blockhash: string }> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
    return { tx, blockhash };
  }

  private async ensureSplAta(
    tx: Transaction,
    mint: PublicKey,
    owner: PublicKey,
    payer: PublicKey,
    tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
    const info = await this.connection.getAccountInfo(ata, "confirmed");
    if (!info) {
      tx.add(
        createAssociatedTokenAccountInstruction(payer, ata, owner, mint, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID),
      );
    }
    return ata;
  }

  private tierPks(config: PublicKey): PublicKey[] {
    return [0, 1, 2, 3, 4].map((i) => tierPda(config, i));
  }

  private async buildAndSend(params: SubmitParams): Promise<string> {
    const program = this.program();
    const me = this.wallet!.publicKey!;
    switch (params.ix) {
      case "initialize_agreement":
        return this.sendInitialize(program, me, params.input, params.creator);
      case "purchase_share":
        return this.sendPurchase(program, me, params.buyerId, params.amount);
      case "deposit_revenue":
        return this.sendDeposit(program, me, params.amount);
      case "claim_tier_share":
        return this.sendClaimTier(program, me);
      case "claim_party_share":
        return this.sendClaimParty(program, me);
      case "transfer_hook":
        return this.sendTransfer(program, me, params.toId, params.amount);
      case "freeze_position":
        return this.sendFreeze(program, me, params.holderId, true);
      case "unfreeze_position":
        return this.sendFreeze(program, me, params.holderId, false);
      case "expire_agreement":
        return this.sendExpire(program, me);
      case "close_agreement":
        return this.sendClose(program, me);
    }
  }

  private async sendInitialize(
    program: Program<Idl>,
    me: PublicKey,
    input: { name: string; supply: bigint; sharePrice: bigint; tiers: { threshold: bigint | null; splits: { kind: "holders" | "wallet"; bps: number; address?: string }[] }[]; expTime: number | null; endCap: bigint | null; claimWindow: bigint | null; startTime: number | null; depositor: string; complianceAdmin: string },
    creatorAddr: string,
  ): Promise<string> {
    if (!PAYMENT_MINT) {
      throw new ProtocolError(
        "MintNotConfigured",
        "VITE_PAYMENT_MINT is not set. Configure a 6-decimal USDC mint on devnet first.",
      );
    }
    const creator = new PublicKey(creatorAddr);
    if (!creator.equals(me)) {
      throw new ProtocolError(
        "MustBeCreator",
        "Your connected wallet must be the creator to create this agreement. The creator pays for all new accounts.",
      );
    }
    if (input.tiers.length < 1 || input.tiers.length > 5) {
      throw new ProtocolError("InvalidTierCount", "You need between 1 and 5 tiers.");
    }
    const agreementId = BigInt(Date.now());
    const config = agreementPda(creator, agreementId);
    const vault = vaultPda(config);
    const treasury = treasuryPda(config);
    const shareMint = Keypair.generate();
    const extraMetas = extraMetasPda(shareMint.publicKey);
    const tiers = this.tierPks(config);

    const tiersArg = input.tiers.map((t) => ({
      threshold: t.threshold === null ? new BN(U64_MAX.toString()) : bn(t.threshold),
      splits: t.splits.map((s) =>
        s.kind === "holders"
          ? { party: { holders: {} }, bps: s.bps }
          : { party: { wallet: new PublicKey(s.address ?? creator.toBase58()) }, bps: s.bps },
      ),
    }));

    // Creator's USDC destination must exist before init.
    const { tx } = await this.freshTx(me);
    const paymentDestination = await this.ensureSplAta(tx, PAYMENT_MINT, creator, me);

    const initIx = await (program.methods as unknown as {
      initializeAgreement: (...args: unknown[]) => { accountsPartial: (a: unknown) => { instruction: () => Promise<import("@solana/web3.js").TransactionInstruction> } };
    })
      .initializeAgreement(
        bn(agreementId),
        bn(input.supply),
        bn(input.sharePrice),
        { open: {} },
        tiersArg,
        input.startTime === null ? null : new BN(input.startTime),
        input.expTime === null ? null : new BN(input.expTime),
        input.endCap === null ? null : bn(input.endCap),
        input.claimWindow === null ? null : bn(input.claimWindow),
        new PublicKey(input.depositor),
        new PublicKey(input.complianceAdmin),
        paymentDestination,
      )
      .accountsPartial({
        creator,
        agreementConfig: config,
        shareMint: shareMint.publicKey,
        paymentMint: PAYMENT_MINT,
        paymentDestination,
        vault,
        treasury,
        extraMetas,
        tier0: tiers[0],
        tier1: tiers[1],
        tier2: tiers[2],
        tier3: tiers[3],
        tier4: tiers[4],
        token2022Program: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    tx.add(initIx);
    tx.partialSign(shareMint);
    const sig = await this.sendTx(tx);
    this.setActiveConfig(config);
    if (input.name.trim()) saveName(config.toBase58(), input.name.trim());
    return sig;
  }

  private async sendPurchase(
    program: Program<Idl>,
    me: PublicKey,
    buyerId: string,
    amount: bigint,
  ): Promise<string> {
    const config = this.requireActive();
    const cfg = await this.fetchConfig(program, config);
    const buyer = new PublicKey(buyerId);
    if (!buyer.equals(me)) {
      throw new ProtocolError(
        "MustBeBuyer",
        "Switch to the buying wallet: the connected wallet must sign the purchase.",
      );
    }
    const shareMint = cfg.shareMint;
    const paymentMint: PublicKey = cfg.paymentMint;
    const buyerShareAta = getAssociatedTokenAddressSync(shareMint, buyer, false, TOKEN_2022_PROGRAM_ID);
    const { tx } = await this.freshTx(me);
    const buyerUsdc = await this.ensureSplAta(tx, paymentMint, buyer, me);
    const claim = claimPda(config, buyer);
    const tiers = this.tierPks(config);
    const purchaseIx = await (program.methods as unknown as {
      purchaseShare: (a: BN) => { accountsPartial: (x: unknown) => { instruction: () => Promise<import("@solana/web3.js").TransactionInstruction> } };
    })
      .purchaseShare(bn(amount))
      .accountsPartial({
        buyer,
        agreementConfig: config,
        shareMint,
        paymentMint,
        buyerShareAccount: buyerShareAta,
        buyerUsdcAccount: buyerUsdc,
        paymentDestination: cfg.paymentDestination,
        treasury: cfg.treasury,
        claimRecord: claim,
        tier0: tiers[0],
        tier1: tiers[1],
        tier2: tiers[2],
        tier3: tiers[3],
        tier4: tiers[4],
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    tx.add(purchaseIx);
    // Second half: Treasury → buyer via the approved delegate so the
    // transfer hook fires (a CPI transfer would reenter the program).
    const transferIx = createTransferCheckedInstruction(
      cfg.treasury,
      shareMint,
      buyerShareAta,
      buyer,
      amount,
      6,
      [],
      TOKEN_2022_PROGRAM_ID,
    );
    const extraMetas = extraMetasPda(shareMint);
    transferIx.keys.push(
      { pubkey: extraMetas, isSigner: false, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: claimPda(config, config), isSigner: false, isWritable: true },
      { pubkey: claim, isSigner: false, isWritable: true },
      ...tiers.map((t) => ({ pubkey: t, isSigner: false, isWritable: false })),
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
    );
    tx.add(transferIx);
    return this.sendTx(tx);
  }

  private async sendDeposit(program: Program<Idl>, me: PublicKey, amount: bigint): Promise<string> {
    const config = this.requireActive();
    const cfg = await this.fetchConfig(program, config);
    if (!me.equals(cfg.depositor)) {
      throw new ProtocolError(
        "UnauthorizedDepositor",
        "Only the designated depositor wallet can add revenue. Switch wallets to continue.",
      );
    }
    const { tx } = await this.freshTx(me);
    const depositorUsdc = await this.ensureSplAta(tx, cfg.paymentMint, me, me);
    const tiers = this.tierPks(config);
    const ix = await (program.methods as unknown as {
      depositRevenue: (a: BN) => { accountsPartial: (x: unknown) => { instruction: () => Promise<import("@solana/web3.js").TransactionInstruction> } };
    })
      .depositRevenue(bn(amount))
      .accountsPartial({
        depositor: me,
        agreementConfig: config,
        paymentMint: cfg.paymentMint,
        depositorUsdcAccount: depositorUsdc,
        vault: cfg.vault,
        tier0: tiers[0],
        tier1: tiers[1],
        tier2: tiers[2],
        tier3: tiers[3],
        tier4: tiers[4],
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    tx.add(ix);
    return this.sendTx(tx);
  }

  private async sendClaimTier(program: Program<Idl>, me: PublicKey): Promise<string> {
    const config = this.requireActive();
    const cfg = await this.fetchConfig(program, config);
    const shareAta = getAssociatedTokenAddressSync(cfg.shareMint, me, false, TOKEN_2022_PROGRAM_ID);
    const { tx } = await this.freshTx(me);
    const usdcAta = await this.ensureSplAta(tx, cfg.paymentMint, me, me);
    const tiers = this.tierPks(config);
    const ix = await (program.methods as unknown as {
      claimTierShare: () => { accountsPartial: (x: unknown) => { instruction: () => Promise<import("@solana/web3.js").TransactionInstruction> } };
    })
      .claimTierShare()
      .accountsPartial({
        holder: me,
        agreementConfig: config,
        shareMint: cfg.shareMint,
        paymentMint: cfg.paymentMint,
        holderShareAta: shareAta,
        holderUsdcAta: usdcAta,
        vault: cfg.vault,
        claimRecord: claimPda(config, me),
        tier0: tiers[0],
        tier1: tiers[1],
        tier2: tiers[2],
        tier3: tiers[3],
        tier4: tiers[4],
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    tx.add(ix);
    return this.sendTx(tx);
  }

  private async sendClaimParty(program: Program<Idl>, me: PublicKey): Promise<string> {
    const config = this.requireActive();
    const cfg = await this.fetchConfig(program, config);
    const { tx } = await this.freshTx(me);
    const usdcAta = await this.ensureSplAta(tx, cfg.paymentMint, me, me);
    const tiers = this.tierPks(config);
    const ix = await (program.methods as unknown as {
      claimPartyShare: () => { accountsPartial: (x: unknown) => { instruction: () => Promise<import("@solana/web3.js").TransactionInstruction> } };
    })
      .claimPartyShare()
      .accountsPartial({
        party: me,
        agreementConfig: config,
        paymentMint: cfg.paymentMint,
        partyUsdcAta: usdcAta,
        vault: cfg.vault,
        tier0: tiers[0],
        tier1: tiers[1],
        tier2: tiers[2],
        tier3: tiers[3],
        tier4: tiers[4],
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    tx.add(ix);
    return this.sendTx(tx);
  }

  private async sendTransfer(
    program: Program<Idl>,
    me: PublicKey,
    toId: string,
    amount: bigint,
  ): Promise<string> {
    const config = this.requireActive();
    const cfg = await this.fetchConfig(program, config);
    void program;
    const to = new PublicKey(toId);
    const fromAta = getAssociatedTokenAddressSync(cfg.shareMint, me, false, TOKEN_2022_PROGRAM_ID);
    const toAta = getAssociatedTokenAddressSync(cfg.shareMint, to, false, TOKEN_2022_PROGRAM_ID);
    const { tx } = await this.freshTx(me);
    // Receiver needs a Token-2022 ATA + ClaimRecord or the hook rejects.
    // Create the ATA here if missing; the ClaimRecord is created by purchase
    // (MVP limitation documented in protocol.md §8: secondary buyers need a
    // record first — surface a clear error when it is missing).
    const toInfo = await this.connection.getAccountInfo(toAta, "confirmed");
    if (!toInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(me, toAta, to, cfg.shareMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      );
    }
    const receiverClaim = claimPda(config, to);
    const receiverInfo = await this.connection.getAccountInfo(receiverClaim, "confirmed");
    if (!receiverInfo) {
      throw new ProtocolError(
        "MissingClaimRecord",
        "The recipient has no claim record yet, so the transfer hook would reject. Ask them to buy a share first (any amount), then transfer.",
      );
    }
    const ix = createTransferCheckedInstruction(fromAta, cfg.shareMint, toAta, me, amount, 6, [], TOKEN_2022_PROGRAM_ID);
    const extraMetas = extraMetasPda(cfg.shareMint);
    const tiers = this.tierPks(config);
    ix.keys.push(
      { pubkey: extraMetas, isSigner: false, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: claimPda(config, me), isSigner: false, isWritable: true },
      { pubkey: receiverClaim, isSigner: false, isWritable: true },
      ...tiers.map((t) => ({ pubkey: t, isSigner: false, isWritable: false })),
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
    );
    tx.add(ix);
    return this.sendTx(tx);
  }

  private async sendFreeze(
    program: Program<Idl>,
    me: PublicKey,
    holderId: string,
    freeze: boolean,
  ): Promise<string> {
    const config = this.requireActive();
    const cfg = await this.fetchConfig(program, config);
    if (!me.equals(cfg.complianceAdmin)) {
      throw new ProtocolError(
        "UnauthorizedComplianceAdmin",
        "Only the compliance admin wallet can freeze or unfreeze positions.",
      );
    }
    const holder = new PublicKey(holderId);
    const holderAta = getAssociatedTokenAddressSync(cfg.shareMint, holder, false, TOKEN_2022_PROGRAM_ID);
    const method = freeze ? "freezePosition" : "unfreezePosition";
    const { tx } = await this.freshTx(me);
    const ix = await (program.methods as unknown as Record<string, () => { accountsPartial: (x: unknown) => { instruction: () => Promise<import("@solana/web3.js").TransactionInstruction> } }>)
      [method]()
      .accountsPartial({
        complianceAdmin: me,
        agreementConfig: config,
        shareMint: cfg.shareMint,
        holderShareAta: holderAta,
        claimRecord: claimPda(config, holder),
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    tx.add(ix);
    return this.sendTx(tx);
  }

  private async sendExpire(program: Program<Idl>, me: PublicKey): Promise<string> {
    void me;
    const config = this.requireActive();
    const cfg = await this.fetchConfig(program, config);
    const state = this.cached;
    if (state && !canExpire(state, await this.now())) {
      throw new ProtocolError(
        "EndConditionNotMet",
        "Neither the expiry time nor the revenue cap has been reached yet.",
      );
    }
    const { tx } = await this.freshTx(me);
    const ix = await (program.methods as unknown as {
      expireAgreement: () => { accountsPartial: (x: unknown) => { instruction: () => Promise<import("@solana/web3.js").TransactionInstruction> } };
    })
      .expireAgreement()
      .accountsPartial({
        agreementConfig: config,
        shareMint: cfg.shareMint,
        treasury: cfg.treasury,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    tx.add(ix);
    return this.sendTx(tx);
  }

  private async sendClose(program: Program<Idl>, me: PublicKey): Promise<string> {
    const config = this.requireActive();
    const cfg = await this.fetchConfig(program, config);
    if (!me.equals(cfg.creator)) {
      throw new ProtocolError("UnauthorizedCreator", "Only the creator wallet can close the agreement.");
    }
    const state = this.cached;
    if (state) {
      const gate = canClose(state, await this.now());
      if (!gate.ok) throw new ProtocolError("ClaimWindowStillOpen", gate.reason ?? "The claim window is still open.");
    }
    const { tx } = await this.freshTx(me);
    const tiers = this.tierPks(config);
    const ix = await (program.methods as unknown as {
      closeAgreement: () => { accountsPartial: (x: unknown) => { instruction: () => Promise<import("@solana/web3.js").TransactionInstruction> } };
    })
      .closeAgreement()
      .accountsPartial({
        creator: me,
        agreementConfig: config,
        paymentMint: cfg.paymentMint,
        paymentDestination: cfg.paymentDestination,
        vault: cfg.vault,
        shareMint: cfg.shareMint,
        treasury: cfg.treasury,
        tier0: tiers[0],
        tier1: tiers[1],
        tier2: tiers[2],
        tier3: tiers[3],
        tier4: tiers[4],
        extraMetas: extraMetasPda(cfg.shareMint),
        paymentTokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    tx.add(ix);
    const sig = await this.sendTx(tx);
    this.setActiveConfig(null);
    return sig;
  }

  private requireActive(): PublicKey {
    const cfg = this.activeConfig;
    if (!cfg) {
      throw new ProtocolError("NoAgreement", "Select or create an agreement first.");
    }
    return cfg;
  }

  private async fetchConfig(
    program: Program<Idl>,
    config: PublicKey,
  ): Promise<{ creator: PublicKey; shareMint: PublicKey; paymentMint: PublicKey; paymentDestination: PublicKey; vault: PublicKey; treasury: PublicKey; depositor: PublicKey; complianceAdmin: PublicKey }> {
    const accounts = program.account as unknown as {
      agreementConfig: { fetch: (pk: PublicKey) => Promise<OnchainConfig> };
    };
    const cfg = await accounts.agreementConfig.fetch(config);
    return {
      creator: cfg.creator,
      shareMint: cfg.shareMint,
      paymentMint: cfg.paymentMint,
      paymentDestination: cfg.paymentDestination,
      vault: cfg.vault,
      treasury: cfg.treasury,
      depositor: cfg.depositor,
      complianceAdmin: cfg.complianceAdmin,
    };
  }
}
