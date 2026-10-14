import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/config";

const enc = new TextEncoder();

export const AGREEMENT_SEED = enc.encode("agreement");
export const TIER_SEED = enc.encode("tier");
export const CLAIM_SEED = enc.encode("claim");
export const VAULT_SEED = enc.encode("vault");
export const TREASURY_SEED = enc.encode("treasury");
export const EXTRA_METAS_SEED = enc.encode("extra-account-metas");

function toLeBytes(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

function find(...seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

export function agreementPda(creator: PublicKey, agreementId: bigint): PublicKey {
  return find(AGREEMENT_SEED, creator.toBytes(), toLeBytes(agreementId));
}

export function tierPda(config: PublicKey, index: number): PublicKey {
  return find(TIER_SEED, config.toBytes(), new Uint8Array([index]));
}

export function tierPdas(config: PublicKey): PublicKey[] {
  return [0, 1, 2, 3, 4].map((i) => tierPda(config, i));
}

export function claimPda(config: PublicKey, holder: PublicKey): PublicKey {
  return find(CLAIM_SEED, config.toBytes(), holder.toBytes());
}

export function vaultPda(config: PublicKey): PublicKey {
  return find(VAULT_SEED, config.toBytes());
}

export function treasuryPda(config: PublicKey): PublicKey {
  return find(TREASURY_SEED, config.toBytes());
}

export function extraMetasPda(mint: PublicKey): PublicKey {
  return find(EXTRA_METAS_SEED, mint.toBytes());
}
