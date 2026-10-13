import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Lockup } from "@/components/ui/logo";
import { Eyebrow } from "@/components/ui/chip";
import { useJourney } from "@/state/journey";
import { cn } from "@/lib/cn";
import { truncAddress } from "@/lib/format";

/**
 * Global chrome (every screen except Splash):
 * top-left N° chip + mono eyebrow, top-right wordmark + wallet + Demo toggle.
 */
export function TopChrome({
  n,
  eyebrow,
  invert = false,
}: {
  n?: string;
  eyebrow: string;
  invert?: boolean;
}) {
  const { demoMode, setDemoMode, presentation, setPresentation } = useJourney();
  return (
    <header className="relative z-30 flex items-center justify-between px-6 py-5 md:px-12">
      <Eyebrow n={n} label={eyebrow} invert={invert} />
      <div className="flex items-center gap-3">
        <Toggle label="DEMO" on={demoMode} onChange={setDemoMode} invert={invert} />
        <Toggle label="Aa" on={presentation} onChange={setPresentation} invert={invert} />
        <WalletButton invert={invert} />
        <Lockup inverted={invert} />
      </div>
    </header>
  );
}

function Toggle({
  label,
  on,
  onChange,
  invert,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  invert?: boolean;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={label === "DEMO" ? "Demo Mode — run the journey offline" : "Presentation Mode — 125% type"}
      className={cn(
        "mono-label flex h-7 items-center gap-1.5 rounded-full border px-2.5 transition-colors",
        on
          ? "border-accent bg-accent/15 text-accent"
          : invert
            ? "border-white/40 text-white/80"
            : "border-[var(--border-strong)] text-secondary",
      )}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          on ? "bg-accent" : "bg-current opacity-50",
        )}
      />
      {label}
      {label === "DEMO" && <span className="hidden md:inline">{on ? " ON" : " OFF"}</span>}
    </button>
  );
}

/** Wallet button — opens wallet-standard modal (custom, unstyled wrapper). */
export function WalletButton({ invert = false }: { invert?: boolean }) {
  const { publicKey, disconnect, connected } = useWallet();
  const { setVisible } = useWalletModal();

  if (connected && publicKey) {
    return (
      <button
        onClick={() => disconnect()}
        className={cn(
          "mono-label flex h-8 items-center gap-2 rounded-full px-3 transition-colors",
          invert
            ? "bg-white text-ink-950 hover:bg-purple-100"
            : "bg-ink-900 text-white hover:bg-ink-800",
        )}
        title="Disconnect"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-mint-400" />
        {truncAddress(publicKey.toBase58())}
      </button>
    );
  }
  return (
    <button
      onClick={() => setVisible(true)}
      className={cn(
        "mono-label flex h-8 items-center rounded-full px-3.5 transition-colors",
        invert
          ? "bg-white text-ink-950 hover:bg-purple-100"
          : "bg-ink-900 text-white hover:bg-ink-800",
      )}
    >
      CONNECT WALLET
    </button>
  );
}
