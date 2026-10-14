import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { EXPLORER_CLUSTER, PAYMENT_MINT, PROGRAM_ID, RPC_ENDPOINT, RPC_PROVIDER } from "@/lib/config";
import { cn } from "@/lib/cn";

/**
 * Devnet status strip: network, program, RPC health, payment-mint setup.
 * Shown on every screen so devnet targeting is always visible.
 */
export function NetworkBanner({ className }: { className?: string }) {
  const { connection } = useConnection();
  const [slot, setSlot] = useState<number | null>(null);
  const [rpcOk, setRpcOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    connection
      .getSlot("confirmed")
      .then((s) => {
        if (!alive) return;
        setSlot(s);
        setRpcOk(true);
      })
      .catch(() => {
        if (!alive) return;
        setRpcOk(false);
      });
    return () => {
      alive = false;
    };
  }, [connection]);

  return (
    <div
      className={cn(
        "mono-label flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-[var(--border-subtle)] bg-surface px-3.5 py-1.5 text-xs font-semibold text-secondary",
        className,
      )}
      role="status"
      aria-label="Network status"
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            rpcOk === false ? "bg-red-500" : "bg-mint-700",
          )}
          aria-hidden
        />
        SOLANA {EXPLORER_CLUSTER.toUpperCase()} · {RPC_PROVIDER}
      </span>
      <span className="hidden text-secondary/60 sm:inline" aria-hidden>
        ·
      </span>
      <span className="hidden sm:inline" title={RPC_ENDPOINT}>
        {rpcOk === false ? "RPC UNREACHABLE" : slot !== null ? `SLOT ${slot.toLocaleString()}` : "CONNECTING…"}
      </span>
      <span className="hidden text-secondary/60 md:inline" aria-hidden>
        ·
      </span>
      <span className="hidden md:inline" title={PROGRAM_ID.toBase58()}>
        PROGRAM {PROGRAM_ID.toBase58().slice(0, 4)}…{PROGRAM_ID.toBase58().slice(-4)}
      </span>
      {!PAYMENT_MINT && (
        <span className="inline-flex items-center gap-1 text-amber-700" role="alert">
          · USDC MINT NOT SET
        </span>
      )}
    </div>
  );
}

/** Full-width setup alert when required devnet config is missing. */
export function ConfigAlert() {
  if (PAYMENT_MINT) return null;
  return (
    <div
      className="rounded-panel border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-900"
      role="alert"
    >
      <p className="font-semibold">Payment mint is not configured.</p>
      <p className="mt-1">
        Set <code className="mono-data text-xs">VITE_PAYMENT_MINT</code> to a 6-decimal USDC mint on
        devnet (create once, fund test wallets). Agreement creation and purchases stay disabled until
        then — deposits, claims and reads still work where accounts exist.
      </p>
    </div>
  );
}
