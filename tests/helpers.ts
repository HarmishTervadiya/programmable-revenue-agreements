import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { ProgrammableRevenueAgreement } from "../target/types/programmable_revenue_agreement";

export interface SharedCtx {
  provider: anchor.AnchorProvider;
  program: Program<ProgrammableRevenueAgreement>;
  agreementId: anchor.BN;
  supply: anchor.BN;
  sharePrice: anchor.BN;
  shareMintKeypair: anchor.web3.Keypair;
  depositorKeypair: anchor.web3.Keypair;
  depositor: anchor.web3.PublicKey;
  complianceAdmin: anchor.web3.PublicKey;
  config: anchor.web3.PublicKey;
  vault: anchor.web3.PublicKey;
  treasury: anchor.web3.PublicKey;
  extraMetas: anchor.web3.PublicKey;
  tierPdas: anchor.web3.PublicKey[];
  paymentMint?: anchor.web3.PublicKey;
  paymentDestination?: anchor.web3.PublicKey;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshBlockhash(
  provider: anchor.AnchorProvider,
  tries = 3,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await provider.connection.getLatestBlockhash("confirmed");
      return;
    } catch {
      await sleep(1000);
    }
  }
}

export function isRetryableRpcError(err: unknown): boolean {
  if (err instanceof anchor.AnchorError) return false;
  const msg = String((err as any)?.message ?? err);
  return (
    msg.includes("Blockhash not found") ||
    msg.includes("blockhash") ||
    msg.includes("simulation failed") ||
    msg.includes("was not confirmed") ||
    msg.includes("not confirmed") ||
    msg.includes("Transaction retry") ||
    msg.includes("expired") ||
    msg.includes("block height exceeded") ||
    msg.includes("failed to get confirmation") ||
    msg.includes("TokenAccountNotFoundError")
  );
}

export async function sendWithRetry(
  provider: anchor.AnchorProvider,
  fn: () => Promise<string>,
  label: string,
  maxTries = 5,
): Promise<string> {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableRpcError(err) || attempt === maxTries) throw err;
      const msg = String((err as any)?.message ?? err);
      console.log(
        `\n[${label}] retryable RPC error (attempt ${attempt}/${maxTries}): ${msg.slice(
          0,
          200,
        )}`,
      );
      await refreshBlockhash(provider);
      await sleep(1500);
    }
  }
  throw new Error(`[${label}] exhausted retries`);
}

export async function withRetry<T>(
  provider: anchor.AnchorProvider,
  fn: () => Promise<T>,
  label: string,
  maxTries = 5,
): Promise<T> {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableRpcError(err) || attempt === maxTries) throw err;
      const msg = String((err as any)?.message ?? err);
      console.log(
        `\n[${label}] retryable RPC error (attempt ${attempt}/${maxTries}): ${msg.slice(
          0,
          200,
        )}`,
      );
      await refreshBlockhash(provider);
      await sleep(1500);
    }
  }
  throw new Error(`[${label}] exhausted retries`);
}

export async function getOrCreateAtaWithRetry(
  provider: anchor.AnchorProvider,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  label: string,
): Promise<anchor.web3.PublicKey> {
  const payer = (provider.wallet as anchor.Wallet).payer;
  const ata = await withRetry(
    provider,
    () => getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, owner),
    `${label}-ata`,
  );
  return ata.address;
}

// Top-up funding to an exact balance (idempotent across retries: a
// half-confirmed mintTo just tops up the shortfall instead of doubling).
export async function fundUsdcToExact(
  provider: anchor.AnchorProvider,
  mint: anchor.web3.PublicKey,
  dest: anchor.web3.PublicKey,
  authority: anchor.web3.PublicKey,
  target: bigint,
  label: string,
): Promise<void> {
  const payer = (provider.wallet as anchor.Wallet).payer;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const bal = await provider.connection.getTokenAccountBalance(dest);
      const have = BigInt(bal.value.amount);
      if (have === target) return;
      if (have < target) {
        await mintTo(provider.connection, payer, mint, dest, authority, target - have);
      } else {
        throw new Error(`overfunded ${dest.toBase58()}: have ${have}, want ${target}`);
      }
    } catch (err) {
      if (!isRetryableRpcError(err) || attempt === 5) throw err;
      await refreshBlockhash(provider);
      await sleep(1500);
    }
  }
}
