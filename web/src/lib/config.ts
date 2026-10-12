import { PublicKey } from "@solana/web3.js";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} — copy .env.example to .env`);
  return value;
}

export const PROGRAM_ID = new PublicKey(
  required("VITE_PROGRAM_ID", import.meta.env.VITE_PROGRAM_ID),
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
