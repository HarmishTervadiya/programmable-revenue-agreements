import { useEffect } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import idlJson from "@/lib/program/idl.json";
import type { ProtocolClient } from "@/protocol/client";
import { DevnetClient } from "@/protocol/devnetClient";

/**
 * Syncs the connected wallet adapter into the DevnetClient.
 * Must render INSIDE <WalletProvider> (it consumes useAnchorWallet).
 * Mock clients are untouched.
 */
export function DevnetWalletBridge({ client }: { client: ProtocolClient }) {
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();

  useEffect(() => {
    if (client instanceof DevnetClient) {
      client.setWallet((anchorWallet ?? null) as unknown as Parameters<DevnetClient["setWallet"]>[0]);
    }
  }, [client, anchorWallet]);

  // Keep the client's RPC in sync if the provider endpoint changes.
  useEffect(() => {
    if (client instanceof DevnetClient) {
      (client as unknown as { connection: typeof connection }).connection = connection;
    }
  }, [client, connection]);

  return null;
}

/** Read-only program helper for components that need direct account reads. */
export function useReadProgram(): Program<Idl> | null {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  if (!anchorWallet) return null;
  const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
  return new Program(idlJson as Idl, provider);
}
