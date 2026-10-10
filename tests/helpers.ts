import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
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
      if (err instanceof anchor.AnchorError) throw err;
      const msg = String((err as any)?.message ?? err);
      const retryable =
        msg.includes("Blockhash not found") ||
        msg.includes("blockhash") ||
        msg.includes("simulation failed") ||
        msg.includes("was not confirmed") ||
        msg.includes("Transaction retry");
      if (!retryable || attempt === maxTries) throw err;
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
