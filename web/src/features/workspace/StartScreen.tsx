import { Link } from "react-router-dom";
import { useWorld } from "@/app/providers";
import { Lockup, Mark } from "@/components/ui/logo";
import { ToastHost } from "@/components/ui/toast";
import { WalletButton } from "@/components/ui/wallet-button";
import { NetworkBanner } from "@/components/ui/network-banner";
import { useProtocol, SCENARIOS } from "@/protocol";

/**
 * Start screen (`/a/demo`): pick a template, open the workspace.
 * One decision, two cards, no forms.
 */
export function StartScreen() {
  useWorld("light");
  const client = useProtocol();

  return (
    <div className="theme-light min-h-dvh bg-[var(--bg-page)] text-primary">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-6 py-6">
        <Link to="/" aria-label="PRA home">
          <Lockup />
        </Link>
        <div className="flex items-center gap-3">
          <NetworkBanner className="hidden lg:flex" />
          <WalletButton compact />
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 pb-20">
        <div className="pt-10 md:pt-16">
          <span className="mono-label text-xs font-semibold tracking-wider text-accent">PROGRAMMABLE REVENUE AGREEMENTS</span>
          <h1
            className="mt-4 max-w-3xl font-display"
            style={{
              fontSize: "clamp(40px, 6vw, 76px)",
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
            }}
          >
            <span className="text-primary">Revenue deals that </span>
            <span className="text-accent">follow the money.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-secondary">
            Pick a template. Walk six steps from creation to close with your wallet on Solana
            devnet — a live agreement, every rule the program enforces.
          </p>
          {client.mode === "devnet" && (
            <p className="mono-label mt-3 text-xs text-secondary">
              WALLET SIGN-IN ONLY · NO EMAIL · NO PASSWORD
            </p>
          )}
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {SCENARIOS.map((s, i) => (
            <Link
              key={s.id}
              to={`/a/demo/run?scenario=${s.id}&step=create`}
              className="group rounded-panel border border-[var(--border-subtle)] bg-surface p-6 transition-[border-color,transform] duration-[180ms] ease-[var(--ease-out-expo)] hover:border-purple-500/60 hover:-translate-y-0.5 md:p-8"
            >
              <div className="flex items-center justify-between">
                <span className="mono-label text-xs font-bold tracking-wider text-accent">
                  SCENARIO {String(i + 1).padStart(2, "0")}
                </span>
                <Mark size={28} />
              </div>
              <h2 className="mt-5 font-display text-3xl text-primary md:text-4xl">{s.name}</h2>
              <p className="mt-3 min-h-[48px] text-base leading-relaxed text-secondary">{s.blurb}</p>
              <div className="mt-6 flex items-center justify-between">
                <span className="mono-label text-xs font-medium text-secondary">
                  {s.personas.length} PERSONAS · {s.id === "prince" ? "WORKED EXAMPLE" : "BLANK SLATE"}
                </span>
                <span className="mono-label inline-flex h-11 items-center rounded-full bg-accent px-5 text-xs font-semibold text-white transition-transform group-hover:translate-x-0.5">
                  Open →
                </span>
              </div>
            </Link>
          ))}
        </div>

        <p className="mono-label mt-10 text-xs text-secondary">
          LIVE ON SOLANA DEVNET · REAL TRANSACTIONS, REAL FEES · ERRORS EXPLAIN THEMSELVES
        </p>
      </main>
      <ToastHost />
    </div>
  );
}
