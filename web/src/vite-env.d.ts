/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROGRAM_ID: string;
  readonly VITE_SOLANA_RPC: string;
  readonly VITE_PAYMENT_MINT?: string;
  readonly VITE_EXPLORER_CLUSTER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
