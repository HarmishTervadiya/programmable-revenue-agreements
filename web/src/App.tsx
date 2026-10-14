import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "@/app/router";
import { Providers } from "@/app/providers";
import { ProtocolProvider, createProtocolClient } from "@/protocol";
import { DevnetWalletBridge } from "@/protocol/wallet-bridge";

export function App() {
  // One client for the session — the seam everything else talks through.
  // Devnet is the default; mock is opt-in via VITE_PROTOCOL_MODE=mock.
  const client = useMemo(() => createProtocolClient(), []);
  return (
    <Providers>
      <ProtocolProvider client={client}>
        <DevnetWalletBridge client={client} />
        <RouterProvider router={router} />
      </ProtocolProvider>
    </Providers>
  );
}
