import { useCallback, useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import type { WalletError } from "@solana/wallet-adapter-base";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { RPC_ENDPOINT } from "@/lib/config";
import { toastError } from "@/components/ui/toast";
import { useUi } from "@/state/ui";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // RPC lag rule: poll every 2s while confirming; components own refetch.
      refetchInterval: false,
      retry: 1,
      staleTime: 2_000,
    },
  },
});

function applyTheme() {
  document.documentElement.classList.remove("theme-light", "theme-dark");
  // Screens set their own world via useWorld(); default is light.
  document.documentElement.classList.add("theme-light");
}

/** Sets light/dark world per screen. Light = explain/create, dark = money/proof. */
export function useWorld(world: "light" | "dark") {
  useMemo(() => {
    document.documentElement.classList.remove("theme-light", "theme-dark");
    document.documentElement.classList.add(
      world === "light" ? "theme-light" : "theme-dark",
    );
  }, [world]);
}

export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );
  useMemo(applyTheme, []);
  const presentation = useUi((s) => s.presentation);
  useMemo(() => {
    document.documentElement.classList.toggle("presentation", presentation);
  }, [presentation]);

  const onWalletError = useCallback((error: WalletError) => {
    const msg = error?.message ?? String(error);
    if (/rejected|cancelled|canceled|denied|declined/i.test(msg)) {
      toastError("Wallet request was cancelled. Nothing was submitted.");
    } else if (/not found|not installed|unsupported/i.test(msg)) {
      toastError("No supported wallet found. Install Phantom or Solflare, then try again.");
    } else {
      toastError(`Wallet connection failed: ${msg.slice(0, 140)}`);
    }
    console.warn("[wallet]", error);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <ConnectionProvider endpoint={RPC_ENDPOINT}>
        <WalletProvider wallets={wallets} autoConnect onError={onWalletError}>
          <WalletModalProvider>
            <QueryClientProvider client={queryClient}>
              {children}
            </QueryClientProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </MotionConfig>
  );
}
