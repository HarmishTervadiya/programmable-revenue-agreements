import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/config";

export const AGREEMENT_SEED = Buffer.from("agreement");
export const TIER_SEED = Buffer.from("tier");
export const CLAIM_SEED = Buffer.from("claim");
export const VAULT_SEED = Buffer.from("vault");
export const TREASURY_SEED = Buffer.from("treasury");
export const EXTRA_METAS_SEED = Buffer.from("extra-account-metas");

function toLeBytes(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

function find(...seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    seeds.map((s) => new Uint8Array(s)),
    PROGRAM_ID,
  )[0];
}

export function agreementPda(creator: PublicKey, agreementId: bigint): PublicKey {
  return find(AGREEMENT_SEED, creator.toBuffer(), toLeBytes(agreementId));
}

export function tierPda(config: PublicKey, index: number): PublicKey {
  return find(TIER_SEED, config.toBuffer(), Buffer.from([index]));
}

export function tierPdas(config: PublicKey): PublicKey[] {
  return [0, 1, 2, 3, 4].map((i) => tierPda(config, i));
}

export function claimPda(config: PublicKey, holder: PublicKey): PublicKey {
  return find(CLAIM_SEED, config.toBuffer(), holder.toBuffer());
}

export function vaultPda(config: PublicKey): PublicKey {
  return find(VAULT_SEED, config.toBuffer());
}

export function treasuryPda(config: PublicKey): PublicKey {
  return find(TREASURY_SEED, config.toBuffer());
}

export function extraMetasPda(mint: PublicKey): PublicKey {
  return find(EXTRA_METAS_SEED, mint.toBuffer());
}
