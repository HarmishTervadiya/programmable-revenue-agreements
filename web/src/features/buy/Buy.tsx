import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TopChrome } from "@/features/journey/chrome";
import { JourneyBar } from "@/features/journey/journey-bar";
import { ACTORS, useEnsureAgreement } from "@/features/journey/seed";
import { useTxSequence } from "@/features/journey/use-tx-sequence";
import { Interstitial, AnimatePresence } from "@/features/journey/interstitial";
import { NumberInput } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RowCard } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Table } from "@/components/ui/table";
import { TxDrawer } from "@/components/ui/tx-drawer";
import { useExecute } from "@/lib/execute";
import { useSim } from "@/state/sim";
import { fmtUsdc, fmtTokens, fmtBps } from "@/lib/format";

const BUY_CHECKS = [
  "Buyer USDC debited to creator treasury",
  "Treasury → buyer transfer fires (hook)",
  "Hook settles accrued revenue on both claim records",
  "Claim record synced to current accumulators",
];

/**
 * S3 Buy — dual panel: light explanation + ledger, black instrument panel.
 */
export function Buy() {
  useEnsureAgreement();
  const a = useSim((s) => s.agreement);
  const exec = useExecute();
  const { config = "demo" } = useParams();
  const tx = useTxSequence();
  const [qty, setQty] = useState("100");
  const [error, setError] = useState<string | null>(null);
  const [after, setAfter] = useState(false);

  if (!a) return <BackTo config={config} />;

  const amount = BigInt(Math.max(0, Math.floor(Number(qty) || 0)));
  const cost = amount * a.sharePrice;
  const maxAffordable = a.buyerUsdc / a.sharePrice;
  const max = a.treasury < maxAffordable ? a.treasury : maxAffordable;

  function buy() {
    setError(null);
    if (amount <= 0n) return setError("Enter a number of shares above 0.");
    try {
      exec.purchase(ACTORS.buyer.id, ACTORS.buyer.label, amount);
      tx.run(BUY_CHECKS);
      setAfter(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="theme-light min-h-screen bg-purple-100 pb-16">
      <TopChrome n="02" eyebrow="BUY SHARES" />
      <div className="px-6">
        <JourneyBar active="buy" progress={0.7} />
      </div>

      <div className="mx-auto mt-8 grid max-w-[1200px] gap-8 px-6 lg:grid-cols-[1.05fr_1fr] lg:px-12">
        {/* Left: explanation */}
        <div>
          <h1
            className="font-display"
            style={{ fontSize: "clamp(34px, 4vw, 56px)", lineHeight: 1.03, letterSpacing: "-0.03em" }}
          >
            <span className="text-text-on-light">Own a slice</span>
            <br />
            <span style={{ color: "var(--color-purple-500)" }}>
              of every dollar
            </span>
          </h1>
          <p className="body-lg mt-4 max-w-lg text-text-muted-light">
            {fmtTokens(a.supply)} shares, fixed at {fmtUsdc(a.sharePrice, 0)}{" "}
            USDC each. Every share earns from all {a.tiers.length} tiers in
            order — and the transfer hook keeps claims attached to the token.
          </p>

          <div className="mt-6 space-y-3">
            {[
              ["01", "Fixed price, fixed supply", `No auction, no dilution: ${fmtTokens(a.supply)} shares total, ${fmtTokens(a.treasury)} still in the treasury.`],
              ["02", "Accrual is per-token", "Deposits raise each tier's accumulator. Your claim = balance × accumulator delta + pending."],
              ["03", "The hook follows the token", "Sell or transfer shares and accrued revenue settles at the boundary — never lost, never double-counted."],
            ].map(([n, title, body]) => (
              <RowCard key={n} className="flex gap-4 text-text-on-light">
                <Chip>{`N° ${n}`}</Chip>
                <div>
                  <div className="font-medium text-text-on-light">{title}</div>
                  <p className="mt-1 text-sm text-text-muted-light">{body}</p>
                </div>
              </RowCard>
            ))}
          </div>

          {/* Ledger */}
          <div className="mt-6">
            <span className="mono-label text-text-muted-light">HOLDER LEDGER</span>
            <RowCard className="mt-2 text-text-on-light">
              <Table
                headers={["Holder", "Shares", "% supply", "Status"]}
                rows={
                  a.holders.length === 0
                    ? [["No holders yet — you're first.", "—", "—", "—"]]
                    : a.holders.map((h) => [
                        <span key={h.id} className="font-medium">
                          {h.label}
                        </span>,
                        fmtTokens(h.balance),
                        fmtBps(Math.round((Number(h.balance) / Number(a.supply)) * 10_000)),
                        h.claim.frozen ? "Frozen" : "Active",
                      ])
                }
              />
            </RowCard>
          </div>
        </div>

        {/* Right: black instrument */}
        <div className="rounded-panel bg-ink-950 p-6 text-white md:p-8">
          <div className="flex items-center justify-between">
            <span className="mono-label text-text-muted-dark">PURCHASE PANEL</span>
            <span className="mono-label text-purple-300">
              TREASURY {fmtTokens(a.treasury)} LEFT
            </span>
          </div>

          <label className="mt-6 block">
            <span className="mono-label text-text-muted-dark">SHARES TO BUY</span>
            <NumberInput
              className="mt-2"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              suffix="SHARES"
              error={error}
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            {[10, 50, 100, 250].map((n) => (
              <button
                key={n}
                onClick={() => setQty(String(n))}
                className="mono-label rounded-full border border-white/15 px-3 py-1.5 text-white/70 hover:border-purple-400 hover:text-white"
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => setQty(String(max > 0n ? max : 0n))}
              className="mono-label rounded-full border border-purple-400/50 bg-purple-500/15 px-3 py-1.5 text-purple-300 hover:bg-purple-500/25"
            >
              MAX
            </button>
          </div>

          <div className="mt-6 space-y-2.5">
            {[
              ["Cost", `${fmtUsdc(cost)} USDC`],
              ["Price per share", `${fmtUsdc(a.sharePrice)} USDC`],
              ["Your balance after", `${fmtUsdc(a.buyerUsdc - cost)} USDC`],
              ["Treasury after", `${fmtTokens(a.treasury - amount)} shares`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-white/10 pb-2.5">
                <span className="mono-label text-text-muted-dark">{String(k).toUpperCase()}</span>
                <span className="mono-data tnum text-white">{v}</span>
              </div>
            ))}
          </div>

          <Button className="mt-6 w-full" onClick={buy} disabled={a.treasury === 0n}>
            Buy shares
          </Button>
          {a.treasury === 0n && (
            <p className="mt-3 text-sm text-amber-400">
              The treasury is sold out. Expired or sold-out agreements have no shares left.
            </p>
          )}
          <p className="mono-label mt-5 leading-relaxed text-text-muted-dark">
            ONE TX · HOOK SETTLES CLAIMS ON TRANSFER ·{" "}
            <Link to={`/a/${config}`} className="text-purple-300 underline">
              BACK TO HUB
            </Link>
          </p>
        </div>
      </div>

      <TxDrawer
        open={tx.open}
        onClose={() => tx.setOpen(false)}
        title="purchase_share"
        stage={tx.stage}
        checklist={tx.checks}
        computeUnits={96_000}
        logs={["Program log: transfer hook fired", "Program log: claims settled"]}
      />

      <AnimatePresence>
        {after && (
          <Interstitial
            sentence="Your shares now earn from every future deposit."
            pill="NEXT · N° 03 DEPOSIT"
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
