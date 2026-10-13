import { PublicKey } from "@solana/web3.js";

/** Deployed devnet program — override with VITE_PROGRAM_ID. */
const DEFAULT_PROGRAM_ID = "2iEFwZ8qPjvEfSAtHqE7G7apQo9tVKFsiLrdAFC5sXop";

export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID || DEFAULT_PROGRAM_ID,
);

export const RPC_ENDPOINT =
  import.meta.env.VITE_SOLANA_RPC ?? "https://api.devnet.solana.com";

const paymentMint = import.meta.env.VITE_PAYMENT_MINT as string | undefined;
export const PAYMENT_MINT = paymentMint ? new PublicKey(paymentMint) : null;

export const EXPLORER_CLUSTER =
  (import.meta.env.VITE_EXPLORER_CLUSTER as string | undefined) ?? "devnet";

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${EXPLORER_CLUSTER}`;
}

export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=${EXPLORER_CLUSTER}`;
}
