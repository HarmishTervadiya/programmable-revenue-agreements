import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "@/app/router";
import { Providers } from "@/app/providers";
import { ProtocolProvider, createProtocolClient } from "@/protocol";

export function App() {
  // One client for the session — the seam everything else talks through.
  const client = useMemo(() => createProtocolClient(), []);
  return (
    <Providers>
      <ProtocolProvider client={client}>
        <RouterProvider router={router} />
      </ProtocolProvider>
    </Providers>
  );
}
