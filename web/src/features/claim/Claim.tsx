import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TopChrome } from "@/features/journey/chrome";
import { JourneyBar } from "@/features/journey/journey-bar";
import { ACTORS, activeHolderId, useEnsureAgreement } from "@/features/journey/seed";
import { useTxSequence } from "@/features/journey/use-tx-sequence";
import { Interstitial, AnimatePresence } from "@/features/journey/interstitial";
import { Button } from "@/components/ui/button";
import { RowCard, StatRow } from "@/components/ui/card";
import { Chip, StatusPill } from "@/components/ui/chip";
import { Table } from "@/components/ui/table";
import { TxDrawer } from "@/components/ui/tx-drawer";
import { useExecute } from "@/lib/execute";
import { useJourney } from "@/state/journey";
import { useSim } from "@/state/sim";
import { claimable } from "@/lib/sim/simulator";
import { claimablePerTier } from "@/lib/math/accumulator";
import { fmtUsdc, fmtTokens, fmtBps, fmtCountdown, truncAddress } from "@/lib/format";

const HOLDER_CHECKS = [
  "Claim record synced to current accumulators",
  "Payout computed balance × Δacc + pending (floor)",
  "Vault debited, USDC landed in your ATA",
];

const PARTY_CHECKS = [
  "Wallet splits summed across all tiers",
  "Owed zeroed after payout",
  "Vault debited, USDC landed in your wallet",
];

/**
 * S5 Claim — the loop closes: portfolio, per-tier claimable, wallet-party
 * claim, and the claim-window deadline.
 */
export function Claim() {
  useEnsureAgreement();
  const a = useSim((s) => s.agreement);
  const exec = useExecute();
  const role = useJourney((s) => s.role);
  const { config = "demo" } = useParams();
  const tx = useTxSequence();
  const [after, setAfter] = useState(false);

  if (!a) return <BackTo config={config} />;

  const holderId = activeHolderId(a.holders.map((h) => h.id));
  const holder = holderId ? a.holders.find((h) => h.id === holderId)! : null;
  const frozen = holder?.claim.frozen ?? false;
  const payout = holder && !frozen ? claimable(a, holder.id) : 0n;
  const perTier = holder ? claimablePerTier(holder.balance, holder.claim, a.tiers) : [];
  const walletOwed = a.tiers.reduce(
    (sum, t) =>
      sum +
      t.splits.reduce(
        (s, x) =>
          x.party.kind === "wallet" && x.party.address === ACTORS.creator.id
            ? s + x.owed
            : s,
        0n,
      ),
    0n,
  );
  const nowTs = Math.floor(Date.now() / 1000);
  const windowLeft =
    a.claimDeadline !== null ? fmtCountdown(a.claimDeadline, nowTs) : null;

  function claimHolder() {
    if (!holder) return;
    try {
      exec.claim(holder.id);
      tx.run(HOLDER_CHECKS);
      setAfter(true);
    } catch {
      /* toast already surfaced the program error */
    }
  }

  function claimParty() {
    try {
      exec.claimParty(ACTORS.creator.id);
      tx.run(PARTY_CHECKS);
      setAfter(true);
    } catch {
      /* toast already surfaced the program error */
    }
  }

  return (
    <div className="theme-light min-h-screen bg-purple-100 pb-16">
      <TopChrome n="04" eyebrow="CLAIM" />
      <div className="px-6">
        <JourneyBar
          active="claim"
          progress={payout > 0n ? 0.9 : a.totalDeposited > 0n ? 0.5 : 0.1}
        />
      </div>

      <div className="mx-auto mt-8 grid max-w-[1200px] gap-8 px-6 lg:grid-cols-[1fr_1.1fr] lg:px-12">
        {/* Left: explanation + portfolio */}
        <div>
          <h1
            className="font-display"
            style={{ fontSize: "clamp(34px, 4vw, 56px)", lineHeight: 1.03, letterSpacing: "-0.03em" }}
          >
            <span className="text-text-on-light">Revenue lands</span>
            <br />
            <span style={{ color: "var(--color-purple-500)" }}>
              in your wallet
            </span>
          </h1>
          <p className="body-lg mt-4 max-w-lg text-text-muted-light">
            Every deposit raised the accumulators your tokens are sitting on.
            Claiming pays balance × Δacc + pending — dust stays in the vault,
            exact on-chain maths.
          </p>

          {frozen && (
            <div className="mt-5 rounded-card border border-red-500/40 bg-red-500/10 p-4">
              <StatusPill status="frozen" />
              <p className="mt-2 text-sm text-text-on-light">
                This position is frozen by the compliance admin. Claims and
                transfers are blocked — accrued revenue is kept, nothing is
                lost.
              </p>
            </div>
          )}

          <div className="mt-6 space-y-3">
            <RowCard className="text-text-on-light">
              <div className="flex items-center justify-between">
                <span className="mono-label text-text-muted-light">
                  YOUR POSITION
                </span>
                {holder && <Chip>{`N° ${holder.id}`}</Chip>}
              </div>
              {holder ? (
                <div className="mt-3">
                  <StatRow
                    label="Shares"
                    value={`${fmtTokens(holder.balance)} / ${fmtTokens(a.supply)}`}
                  />
                  <StatRow
                    label="Share of supply"
                    value={fmtBps(
                      Math.round((Number(holder.balance) / Number(a.supply)) * 10_000),
                    )}
                  />
                  <StatRow
                    label="Invested"
                    value={`${fmtUsdc(holder.balance * a.sharePrice)} USDC`}
                  />
                  <StatRow
                    label="Claim record"
                    value={frozen ? "FROZEN" : "Synced"}
                  />
                </div>
              ) : (
                <p className="mt-3 text-sm text-text-muted-light">
                  No position yet. Buy shares first — the buyer and holder
                  roles share one demo wallet.
                </p>
              )}
            </RowCard>

            <RowCard className="text-text-on-light">
              <span className="mono-label text-text-muted-light">
                PER-TIER CLAIMABLE
              </span>
              <Table
                className="mt-3"
                headers={["Tier", "acc", "Your last_acc", "Claimable"]}
                rows={
                  holder
                    ? a.tiers.map((t, i) => [
                        <span key={i} className="font-medium">
                          T{i}
                        </span>,
                        (Number(t.accPerToken) / 1e12).toFixed(2),
                        (Number(holder.claim.lastAcc[i] ?? 0n) / 1e12).toFixed(2),
                        <span key={`c${i}`} className="mono-data text-purple-500 tnum">
                          {fmtUsdc(perTier[i] ?? 0n)}
                        </span>,
                      ])
                    : [["—", "—", "—", "—"]]
                }
              />
            </RowCard>

            {a.status !== "active" && (
              <RowCard className="border border-amber-500/40 text-text-on-light">
                <span className="mono-label text-amber-500">CLAIM WINDOW</span>
                <p className="mt-2 text-sm text-text-on-light">
                  {a.status === "closed"
                    ? "This agreement is closed."
                    : windowLeft
                      ? `Claim within ${windowLeft}, or unclaimed revenue goes to the creator on close.`
                      : "Claim any time before close."}
                </p>
              </RowCard>
            )}
          </div>
        </div>

        {/* Right: black claim instrument */}
        <div className="rounded-panel bg-ink-950 p-6 text-white md:p-8">
          <div className="flex items-center justify-between">
            <span className="mono-label text-text-muted-dark">CLAIM PANEL</span>
            <span className="mono-label text-mint-400">
              VAULT {fmtUsdc(a.vault, 0)}
            </span>
          </div>

          <div className="mt-6">
            <span className="mono-label text-text-muted-dark">
              {holder ? "AVAILABLE TO CLAIM" : "NO POSITION"}
            </span>
            <div className="font-display text-5xl tnum text-white">
              {fmtUsdc(payout)}
            </div>
            <div className="mono-label mt-1 text-text-muted-dark">
              USDC · BALANCE × ΔACC + PENDING
            </div>
          </div>

          <Button
            className="mt-5 w-full"
            onClick={claimHolder}
            disabled={!holder || payout === 0n || frozen}
            variant={role === "holder" || role === "buyer" ? "primary" : "ghostDark"}
          >
            Claim as holder
          </Button>
          {!holder && (
            <p className="mono-label mt-2 text-text-muted-dark">
              BUY SHARES FIRST (ROLE · BUYER)
            </p>
          )}
          {holder && payout === 0n && !frozen && (
            <p className="mono-label mt-2 text-text-muted-dark">
              NOTHING TO CLAIM YET — DEPOSIT REVENUE FIRST
            </p>
          )}

          <div className="mt-7 border-t border-white/10 pt-6">
            <div className="flex items-center justify-between">
              <span className="mono-label text-text-muted-dark">
                WALLET PARTY SHARE
              </span>
              <span className="mono-label text-coral-500">CREATOR SPLITS</span>
            </div>
            <div className="mt-3 font-display text-3xl tnum text-white">
              {fmtUsdc(walletOwed)}
            </div>
            <div className="mono-label mt-1 text-text-muted-dark">
              OWED ACROSS {a.tiers.length} TIERS · WALLET{" "}
              {truncAddress(ACTORS.creator.id)}
            </div>
            <Button
              className="mt-4 w-full"
              onClick={claimParty}
              disabled={walletOwed === 0n}
              variant={role === "creator" ? "primary" : "ghostDark"}
            >
              Claim wallet share
            </Button>
            {walletOwed === 0n && (
              <p className="mono-label mt-2 text-text-muted-dark">
                WALLET SPLITS ACCRUE ON EACH DEPOSIT
              </p>
            )}
          </div>

          <div className="mt-7 grid grid-cols-2 gap-3 border-t border-white/10 pt-6">
            <div className="rounded-lg bg-white/5 p-3">
              <div className="mono-label text-text-muted-dark">HOLDER WALLET</div>
              <div className="mono-data mt-1 tnum text-white">
                {fmtUsdc(a.buyerUsdc)}
              </div>
            </div>
            <div className="rounded-lg bg-white/5 p-3">
              <div className="mono-label text-text-muted-dark">CREATOR WALLET</div>
              <div className="mono-data mt-1 tnum text-coral-500">
                {fmtUsdc(a.creatorUsdc)}
              </div>
            </div>
          </div>

          <p className="mono-label mt-6 leading-relaxed text-text-muted-dark">
            <Link to={`/a/${config}`} className="text-purple-300 underline">
              BACK TO HUB
            </Link>
            {" · FLOOR DIVISION · DUST STAYS IN THE VAULT"}
          </p>
        </div>
      </div>

      <TxDrawer
        open={tx.open}
        onClose={() => tx.setOpen(false)}
        title="claim_tier_share"
        stage={tx.stage}
        checklist={tx.checks}
        computeUnits={74_000}
        logs={["Program log: claim settled", "Program log: vault debited"]}
      />

      <AnimatePresence>
        {after && (
          <Interstitial
            sentence="Revenue is in your wallet — the loop is closed."
            pill="NEXT · N° 06 TRANSFER LAB"
            onDone={() => setAfter(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function BackTo({ config }: { config: string }) {
  return (
    <div className="theme-light flex min-h-screen flex-col items-center justify-center gap-4 bg-purple-100 p-8 text-center">
      <h1 className="font-display text-3xl">No agreement loaded</h1>
      <Link to={`/a/${config}`} className="mono-label text-purple-500 underline">
        BACK TO HUB
      </Link>
    </div>
  );
}
