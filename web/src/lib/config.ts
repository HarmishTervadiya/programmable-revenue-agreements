import { PublicKey } from "@solana/web3.js";

/** Deployed devnet program — override with VITE_PROGRAM_ID. */
const DEFAULT_PROGRAM_ID = "2iEFwZ8qPjvEfSAtHqE7G7apQo9tVKFsiLrdAFC5sXop";

export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID || DEFAULT_PROGRAM_ID,
);

export const RPC_ENDPOINT: string = (() => {
  // Helius wins when a key is present (explicit setup choice). Otherwise an
  // explicit VITE_SOLANA_RPC is honored, falling back to the public endpoint.
  const heliusKey = import.meta.env.VITE_HELIUS_API_KEY as string | undefined;
  if (heliusKey) return `https://devnet.helius-rpc.com/?api-key=${heliusKey}`;
  return (
    (import.meta.env.VITE_SOLANA_RPC as string | undefined) ??
    "https://api.devnet.solana.com"
  );
})();

/** Which RPC backs the app — shown in the network banner so it's always visible. */
export const RPC_PROVIDER: string = (import.meta.env.VITE_HELIUS_API_KEY as string | undefined)
  ? "HELIUS"
  : "PUBLIC";

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
