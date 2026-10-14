import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { truncAddress } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Wallet sign-in button — the ONLY authentication method.
 * Disconnected → "Connect wallet". Connected → truncated address + disconnect.
 * All wallet errors are surfaced as inline copy, never silent.
 */
export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();

  const label = useMemo(() => {
    if (connecting) return "Connecting…";
    if (connected && publicKey) return truncAddress(publicKey.toBase58());
    return "Connect wallet";
  }, [connecting, connected, publicKey]);

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="mono-label hidden items-center gap-1.5 rounded-full border border-mint-700/40 bg-mint-700/10 px-2.5 py-1 text-xs font-semibold text-healthy sm:inline-flex"
          title={`Connected: ${publicKey.toBase58()}`}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {wallet?.adapter.name ?? "Wallet"}
        </span>
        <button
          onClick={() => void disconnect()}
          title={`Disconnect ${publicKey.toBase58()}`}
          aria-label={`Disconnect wallet ${publicKey.toBase58()}`}
          className={cn(
            "mono-label inline-flex items-center rounded-full bg-accent font-semibold text-white transition-colors hover:bg-purple-400",
            compact ? "h-11 px-4 text-xs" : "h-11 px-5 text-xs",
          )}
        >
          {label}
          <span aria-hidden className="ml-2 opacity-70">
            ⏻
          </span>
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setVisible(true)}
      disabled={connecting}
      aria-label="Connect your wallet to sign in"
      className={cn(
        "mono-label inline-flex items-center rounded-full bg-accent font-semibold text-white transition-colors hover:bg-purple-400 disabled:opacity-60",
        compact ? "h-11 px-4 text-xs" : "h-12 px-7 text-xs",
      )}
    >
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

/** Inline gate: prompts to connect before any on-chain action. */
export function RequireWallet({ children }: { children?: React.ReactNode }) {
  const { connected, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  if (connected) return <>{children}</>;
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-surface-inset p-5 text-center">
      <p className="text-sm font-medium text-primary">
        {connecting ? "Connecting your wallet…" : "Connect your wallet to continue"}
      </p>
      <p className="mt-1.5 text-sm text-secondary">
        Wallet sign-in is the only account you need. No email, no password.
      </p>
      <button
        onClick={() => setVisible(true)}
        disabled={connecting}
        className="mono-label mt-4 inline-flex h-11 items-center rounded-full bg-accent px-5 text-xs font-semibold text-white transition-colors hover:bg-purple-400 disabled:opacity-60"
      >
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    </div>
  );
}
