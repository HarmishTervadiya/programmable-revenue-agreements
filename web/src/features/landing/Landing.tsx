import { Link } from "react-router-dom";
import { useWorld } from "@/app/providers";
import { Lockup, Mark } from "@/components/ui/logo";
import { ToastHost } from "@/components/ui/toast";
import { WalletButton } from "@/components/ui/wallet-button";
import { NetworkBanner } from "@/components/ui/network-banner";

/**
 * Landing (`/`): product-first, algebra-inspired simplicity.
 * One purpose above the fold, three steps, guarantees, one CTA row.
 * Same purple theme, generous whitespace, no demo jargon.
 */
export function Landing() {
  useWorld("light");

  return (
    <div className="theme-light min-h-dvh bg-[var(--bg-page)] text-primary">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link to="/" aria-label="PRA home">
          <Lockup />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <NetworkBanner className="hidden lg:flex" />
          <Link
            to="/app"
            className="mono-label hidden h-9 items-center rounded-full border border-purple-500/25 px-4 text-xs font-semibold text-secondary transition-colors hover:border-accent hover:text-accent sm:inline-flex"
          >
            Open app
          </Link>
          <WalletButton compact />
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
        {/* Hero */}
        <section className="pt-10 md:pt-16">
          <p className="mono-label text-xs font-semibold tracking-wider text-accent">
            PROGRAMMABLE REVENUE AGREEMENTS · SOLANA DEVNET
          </p>
          <h1
            className="mt-4 max-w-3xl font-display"
            style={{ fontSize: "clamp(40px, 6vw, 76px)", lineHeight: 1.02, letterSpacing: "-0.03em" }}
          >
            <span className="text-primary">Revenue deals that </span>
            <span className="text-accent">follow the money.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-secondary">
            Create a revenue-sharing agreement, sell fixed-supply tokens, deposit revenue into an
            on-chain vault, and let holders claim exactly what the tiers say they are owed — no
            spreadsheets, no manual payouts.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/app?step=create"
              className="mono-label inline-flex h-12 items-center rounded-full bg-accent px-7 text-xs font-semibold text-white transition-colors hover:bg-purple-400"
            >
              Create an agreement →
            </Link>
            <a
              href="#how-it-works"
              className="mono-label inline-flex h-12 items-center rounded-full border border-purple-500/25 bg-surface px-7 text-xs font-semibold text-primary transition-colors hover:border-accent"
            >
              How it works
            </a>
          </div>
          <p className="mono-label mt-4 text-xs text-secondary">
            WALLET SIGN-IN ONLY · NO EMAIL · NO PASSWORD · DEVNET
          </p>
        </section>

        {/* How it works */}
        <section id="how-it-works" aria-label="How it works" className="mt-14 scroll-mt-20 md:mt-20">
          <h2 className="font-display text-2xl text-primary md:text-3xl">How it works</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <StepCard
              n="01"
              title="Create the terms"
              body="Set supply, price, tier thresholds and splits, expiry and claim window. One transaction mints a fixed-supply Token-2022 instrument."
            />
            <StepCard
              n="02"
              title="Sell & earn revenue"
              body="Buyers pay USDC straight to you. The depositor routes revenue into the vault; tiers fill in order, per-token earnings accrue automatically."
            />
            <StepCard
              n="03"
              title="Claim & close"
              body="Holders claim anytime. Expire at the date or cap, let the claim window drain, then close and recover any remainder plus rent."
            />
          </div>
        </section>

        {/* Guarantees */}
        <section aria-label="What the program guarantees" className="mt-12 md:mt-16">
          <div className="rounded-panel border border-[var(--border-subtle)] bg-surface p-6 md:p-8">
            <h2 className="font-display text-2xl text-primary">What the program guarantees</h2>
            <ul className="mt-5 grid gap-x-8 gap-y-4 text-[15px] leading-relaxed text-secondary md:grid-cols-2">
              <li>
                <strong className="font-semibold text-primary">Payouts follow the rules.</strong>{" "}
                Deposits split by tier math only — the depositor never chooses who gets paid.
              </li>
              <li>
                <strong className="font-semibold text-primary">Transfers keep earnings fair.</strong>{" "}
                A transfer hook snapshots both sides so sellers keep what they earned and buyers
                start clean.
              </li>
              <li>
                <strong className="font-semibold text-primary">Funds stay program-owned.</strong>{" "}
                The vault and treasury are PDA-controlled; mint authority is revoked at creation.
              </li>
              <li>
                <strong className="font-semibold text-primary">Endings are explicit.</strong>{" "}
                Expiry burns unsold tokens; close returns leftovers only after the claim window you
                disclosed up front.
              </li>
            </ul>
            <p className="mt-5 text-sm text-secondary">
              What it doesn&apos;t do: verify off-chain revenue is real, act as a legal contract, or
              provide a trading venue. Secondary trading needs venues that support transfer-hook
              tokens.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="mt-12 flex flex-col items-start justify-between gap-5 rounded-panel bg-ink-950 p-6 text-white md:flex-row md:items-center md:p-8">
          <div>
            <h2 className="font-display text-2xl md:text-3xl">Put your first agreement on devnet.</h2>
            <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-text-muted-dark">
              Connect a wallet, fund it with devnet SOL and test USDC, and create an agreement in
              about a minute.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/app?step=create"
              className="mono-label inline-flex h-12 items-center rounded-full bg-accent px-7 text-xs font-semibold text-white transition-colors hover:bg-purple-400"
            >
              Launch the app →
            </Link>
          </div>
        </section>

        <footer className="mono-label mt-10 flex flex-wrap items-center justify-between gap-3 text-xs text-secondary">
          <span className="inline-flex items-center gap-2">
            <Mark size={18} /> PRA · DEVNET ONLY · NOT FINANCIAL ADVICE
          </span>
          <NetworkBanner />
        </footer>
      </main>
      <ToastHost />
    </div>
  );
}

function StepCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-panel border border-[var(--border-subtle)] bg-surface p-6">
      <span className="mono-label text-xs font-bold tracking-wider text-accent">{n}</span>
      <h3 className="mt-3 font-display text-xl text-primary">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-secondary">{body}</p>
    </div>
  );
}
