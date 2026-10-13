import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TopChrome } from "@/features/journey/chrome";
import { JourneyBar } from "@/features/journey/journey-bar";
import { ACTORS, useEnsureAgreement } from "@/features/journey/seed";
import { useTxSequence } from "@/features/journey/use-tx-sequence";
import { TierWaterfall } from "@/components/viz/tier-waterfall";
import { NumberInput } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RowCard, StatRow } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Table } from "@/components/ui/table";
import { TxDrawer } from "@/components/ui/tx-drawer";
import { useExecute } from "@/lib/execute";
import { useJourney } from "@/state/journey";
import { useSim } from "@/state/sim";
import { holdersBps, waterfall, claimableTotal, PRECISION, type Tier } from "@/lib/math/accumulator";
import type { SimAgreement } from "@/lib/sim/simulator";
import { fmtUsdc, fmtBps } from "@/lib/format";

const DEPOSIT_CHECKS = [
  "Depositor USDC debited into the program vault",
  "Waterfall fills tiers in order (bigint, floor division)",
  "Per-tier accumulators raised — holders accrue",
  "Wallet-party splits credited as owed",
];

/** Where an incoming deposit would land, tier by tier (mirrors waterfall()). */
function previewTakes(tiers: Tier[], supply: bigint, amount: bigint) {
  let remaining = amount;
  let prev = 0n;
  return tiers.map((t) => {
    let take: bigint;
    if (t.threshold === null) {
      take = remaining;
    } else {
      const width = t.threshold - prev;
      const room = width - t.filled;
      take = room > 0n && remaining < room ? remaining : room > 0n ? room : 0n;
      prev = t.threshold;
    }
    remaining -= take;
    const hb = holdersBps(t);
    const holdersTake = (take * hb) / 10_000n;
    const walletTake = take - holdersTake;
    const accDelta =
      hb > 0n && supply > 0n ? (take * hb * PRECISION) / 10_000n / supply : 0n;
    return { take, holdersTake, walletTake, accDelta };
  });
}

/**
 * S4 Deposit — the live waterfall preview: quick chips, per-tier take table,
 * over-cap warning, all recomputed as you type.
 */
export function Deposit() {
  useEnsureAgreement();
  const a = useSim((s) => s.agreement);
  const exec = useExecute();
  const role = useJourney((s) => s.role);
  const { config = "demo" } = useParams();
  const tx = useTxSequence();
  const [amountStr, setAmountStr] = useState("49000");
  const [error, setError] = useState<string | null>(null);

  if (!a) return <BackTo config={config} />;

  const amount = BigInt(Math.max(0, Math.round(Number(amountStr.replace(/,/g, "")) * 1_000_000)));
  const takes = previewTakes(a.tiers, a.supply, amount);
  const projected = a.totalDeposited + amount;
  const capHit =
    a.endCap !== null && projected > a.totalDeposited && projected >= a.endCap;
  const cappedAtCap = a.endCap !== null && a.totalDeposited >= a.endCap;
  const isDepositor = role === "depositor";

  function submit() {
    setError(null);
    if (amount <= 0n) return setError("Enter an amount above 0.");
    if (role !== "depositor")
      return setError("Switch the active role to Depositor to send revenue.");
    try {
      exec.deposit(ACTORS.depositor.id, amount);
      tx.run(DEPOSIT_CHECKS);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="theme-light min-h-screen bg-purple-100 pb-16">
      <TopChrome n="03" eyebrow="DEPOSIT REVENUE" />
      <div className="px-6">
        <JourneyBar active="deposit" progress={0.7} />
      </div>

      <div className="mx-auto mt-8 max-w-[1200px] px-6 md:px-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="font-display"
              style={{ fontSize: "clamp(34px, 4vw, 56px)", lineHeight: 1.03, letterSpacing: "-0.03em" }}
            >
              <span className="text-text-on-light">One deposit,</span>{" "}
              <span style={{ color: "var(--color-purple-500)" }}>
                every tier moves
              </span>
            </h1>
            <p className="body-lg mt-3 max-w-2xl text-text-muted-light">
              Money fills tiers in order. The cursor advances, cells light up,
              accumulators rise — holders can claim the moment it lands.
            </p>
          </div>
          <Chip>N° 03 · deposit_revenue</Chip>
        </div>

        {/* Live waterfall (black world inside light screen) */}
        <section className="framed-dashboard mt-6 rounded-panel border border-ink-700 bg-ink-950 p-6 md:p-8">
          <TierWaterfall
            tiers={a.tiers}
            totalDeposited={a.totalDeposited}
            supply={a.supply}
            endCap={a.endCap}
            previewAmount={amount}
          />
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.25fr]">
          {/* Input instrument */}
          <div className="rounded-panel bg-ink-950 p-6 text-white">
            <div className="flex items-center justify-between">
              <span className="mono-label text-text-muted-dark">DEPOSIT PANEL</span>
              <span className="mono-label text-mint-400">
                VAULT {fmtUsdc(a.vault, 0)}
              </span>
            </div>

            <label className="mt-5 block">
              <span className="mono-label text-text-muted-dark">REVENUE AMOUNT</span>
              <NumberInput
                className="mt-2"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                suffix="USDC"
                error={error}
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              {[5_000, 25_000, 49_000, 60_000].map((n) => (
                <button
                  key={n}
                  onClick={() => setAmountStr(n.toLocaleString("en-US"))}
                  className="mono-label rounded-full border border-white/15 px-3 py-1.5 text-white/70 hover:border-purple-400 hover:text-white"
                >
                  {n.toLocaleString("en-US")}
                </button>
              ))}
            </div>

            <div className="mt-6 space-y-2.5">
              {[
                ["Deposited so far", fmtUsdc(a.totalDeposited, 0)],
                ["This deposit", fmtUsdc(amount, 0)],
                ["Projected total", fmtUsdc(projected, 0)],
                ["Cap", a.endCap ? fmtUsdc(a.endCap, 0) : "none"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-white/10 pb-2.5">
                  <span className="mono-label text-text-muted-dark">{String(k).toUpperCase()}</span>
                  <span className="mono-data tnum text-white">{v}</span>
                </div>
              ))}
            </div>

            {capHit && !cappedAtCap && (
              <p className="mt-4 rounded-lg bg-amber-500/15 px-3 py-2.5 text-sm text-amber-400">
                This deposit reaches the {fmtUsdc(a.endCap!, 0)} USDC cap.
                Nothing is trimmed — but expiry becomes callable right after.
              </p>
            )}
            {cappedAtCap && (
              <p className="mt-4 rounded-lg bg-amber-500/15 px-3 py-2.5 text-sm text-amber-400">
                The cap is already reached. Further deposits still land in the
                waterfall — consider expiring instead.
              </p>
            )}

            <Button
              className="mt-6 w-full"
              onClick={submit}
              variant={isDepositor ? "primary" : "ghostDark"}
            >
              {isDepositor ? "Deposit revenue" : "Switch to Depositor role"}
            </Button>
            {!isDepositor && (
              <p className="mono-label mt-3 text-text-muted-dark">
                ONLY THE DESIGNATED DEPOSITOR WALLET MAY CALL THIS IX
              </p>
            )}
          </div>

          {/* Per-tier take table */}
          <RowCard className="text-text-on-light">
            <div className="flex items-center justify-between">
              <span className="mono-label text-text-muted-light">
                WHERE THIS DEPOSIT LANDS
              </span>
              <span className="mono-data text-purple-500 tnum">
                {fmtUsdc(amount, 0)}
              </span>
            </div>
            <Table
              className="mt-4"
              headers={["Tier", "Take", "Holders", "Wallet", "acc / token"]}
              rows={a.tiers.map((t, i) => {
                const p = takes[i];
                return [
                  <span key={i} className="font-medium">
                    T{i} {t.threshold === null ? "∞" : fmtUsdc(t.threshold, 0)}
                  </span>,
                  fmtUsdc(p.take, 0),
                  <span key={`h${i}`} className="text-purple-500">
                    {fmtUsdc(p.holdersTake, 0)}
                  </span>,
                  <span key={`w${i}`} className="text-coral-500">
                    {fmtUsdc(p.walletTake, 0)}
                  </span>,
                  <span key={`a${i}`} className="mono-data">
                    +{(Number(p.accDelta) / Number(PRECISION)).toFixed(4)}
                  </span>,
                ];
              })}
            />
            <div className="mt-4">
              <StatRow
                label="Holders take"
                value={`${fmtUsdc(takes.reduce((s, p) => s + p.holdersTake, 0n), 0)} USDC`}
              />
              <StatRow
                label="Wallet parties take"
                value={`${fmtUsdc(takes.reduce((s, p) => s + p.walletTake, 0n), 0)} USDC`}
              />
              <StatRow
                label="Your claimable after this deposit"
                value={`${fmtUsdc(projectedClaimable(a, amount), 0)} USDC`}
                help={<span title="Runs the waterfall on a probe copy, then claims with your current balance."> ⓘ</span>}
              />
            </div>
          </RowCard>
        </div>

        <p className="mono-label mt-6 text-text-muted-light">
          <Link to={`/a/${config}`} className="text-purple-500 underline">
            BACK TO HUB
          </Link>
          {" · "}
          {fmtBps(Math.round((Number(a.sharesSold) / Number(a.supply)) * 10_000))} OF
          SUPPLY SOLD · NEXT STEP CLAIM
        </p>
      </div>

      <TxDrawer
        open={tx.open}
        onClose={() => tx.setOpen(false)}
        title="deposit_revenue"
        stage={tx.stage}
        checklist={tx.checks}
        computeUnits={148_000}
        logs={["Program log: waterfall applied", "Program log: acc updated"]}
      />
    </div>
  );
}

/** Holder claimable after the previewed deposit (probe waterfall, no mutation). */
function projectedClaimable(a: SimAgreement, amount: bigint): bigint {
  const h = a.holders.find((x) => x.id === ACTORS.buyer.id) ?? a.holders[0];
  if (!h || h.balance === 0n || amount <= 0n) return 0n;
  const probe = a.tiers.map((t) => ({
    ...t,
    splits: t.splits.map((s) => ({ ...s })),
  }));
  waterfall(probe, a.supply, amount);
  return claimableTotal(h.balance, h.claim, probe);
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
