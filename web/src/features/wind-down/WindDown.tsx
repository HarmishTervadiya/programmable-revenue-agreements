import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TopChrome } from "@/features/journey/chrome";
import { RoleSwitcher } from "@/features/journey/stepper";
import { ACTORS, useEnsureAgreement } from "@/features/journey/seed";
import { useTxSequence } from "@/features/journey/use-tx-sequence";
import { CellGrid } from "@/components/viz/cell-grid";
import { Button } from "@/components/ui/button";
import { StatRow } from "@/components/ui/card";
import { Chip, StatusPill } from "@/components/ui/chip";
import { TxDrawer } from "@/components/ui/tx-drawer";
import { useExecute } from "@/lib/execute";
import { useJourney } from "@/state/journey";
import { useSim } from "@/state/sim";
import { fmtUsdc, fmtTokens, fmtCountdown, fmtTime } from "@/lib/format";

const EXPIRE_CHECKS = [
  "End condition verified (time passed or cap reached)",
  "Unsold treasury shares burned",
  "Claim window clock started",
  "Post-expiry: purchases + deposits now reject",
];

const CLOSE_CHECKS = [
  "Claim window passed or vault under dust allowance",
  "Remaining vault USDC returned to creator",
  "Rent reclaimed, agreement accounts closed",
];

/**
 * S8 Wind-down — expire (anyone, public) then close (creator).
 * Segmented countdown/cap bar, visible burn, explicit returned-USDC panel.
 */
export function WindDown() {
  useEnsureAgreement();
  const a = useSim((s) => s.agreement);
  const exec = useExecute();
  const role = useJourney((s) => s.role);
  const { config = "demo" } = useParams();
  const tx = useTxSequence();
  const [burned, setBurned] = useState<bigint | null>(null);
  const [closed, setClosed] = useState<{ returned: bigint; rent: number } | null>(null);
  const [lastIx, setLastIx] = useState("expire_agreement");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Drive the countdown bar.
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  if (!a) return <BackTo config={config} />;

  const canExpire = useSim.getState().canExpire(now);
  const closeState = useSim.getState().canClose(now);
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

  // Segmented bar: cap progress if a cap exists, otherwise time progress.
  const capProgress =
    a.endCap !== null && a.endCap > 0n
      ? Math.min(1, Number(a.totalDeposited) / Number(a.endCap))
      : null;
  const timeProgress =
    a.expTime !== null && a.startTime !== null
      ? Math.min(1, (now - a.startTime) / Math.max(1, a.expTime - a.startTime))
      : a.expTime !== null
        ? Math.min(1, now / Math.max(1, a.expTime))
        : null;
  const progress = capProgress ?? timeProgress ?? 0;

  function expire() {
    setError(null);
    try {
      const b = exec.expire();
      setBurned(b);
      setLastIx("expire_agreement");
      tx.run(EXPIRE_CHECKS);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function closeAgreement() {
    setError(null);
    if (role !== "creator") {
      setError("Only the Creator can close. Switch the active role to Creator.");
      return;
    }
    try {
      const r = exec.close();
      setClosed(r);
      setLastIx("close_agreement");
      tx.run(CLOSE_CHECKS);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="theme-light min-h-screen bg-purple-100 pb-16">
      <TopChrome eyebrow="WIND-DOWN" />
      <div className="flex justify-center px-6">
        <div className="rounded-full bg-ink-950 p-1">
          <RoleSwitcher />
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-[1200px] px-6 md:px-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="font-display"
              style={{ fontSize: "clamp(34px, 4vw, 56px)", lineHeight: 1.03, letterSpacing: "-0.03em" }}
            >
              <span className="text-text-on-light">End it cleanly,</span>{" "}
              <span style={{ color: "var(--color-purple-500)" }}>
                burn, then close
              </span>
            </h1>
            <p className="body-lg mt-3 max-w-2xl text-text-muted-light">
              Anyone can call expire once an end condition is met — it starts
              the claim clock and burns unsold tokens. Then the creator closes,
              reclaiming rent and any unclaimed revenue.
            </p>
          </div>
          <span className="flex items-center gap-3">
            <StatusPill status={a.status} />
            <Chip>expire / close</Chip>
          </span>
        </div>

        {/* End-condition bar */}
        <section className="framed-dashboard mt-6 rounded-panel border border-ink-700 bg-ink-950 p-6 text-white md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="mono-label text-text-muted-dark">
              {a.endCap !== null
                ? `CAP ${fmtUsdc(a.endCap, 0)} USDC`
                : a.expTime !== null
                  ? `EXPIRES ${fmtTime(a.expTime)}`
                  : "NO END CONDITION (SHOULDN'T HAPPEN)"}
            </span>
            <span className="mono-label text-purple-300">
              {a.expTime !== null && a.status === "active"
                ? `${fmtCountdown(a.expTime, now)} LEFT`
                : capProgress !== null
                  ? `${fmtUsdc(a.totalDeposited, 0)} / ${fmtUsdc(a.endCap!, 0)}`
                  : ""}
            </span>
          </div>

          {/* 20-cell segmented bar */}
          <div className="mt-4 flex gap-[3px]" aria-label={`End progress ${Math.round(progress * 100)}%`}>
            {Array.from({ length: 20 }, (_, i) => (
              <span
                key={i}
                className="h-6 flex-1 rounded-sm transition-colors duration-300"
                style={{
                  background: i / 20 < progress ? "var(--color-purple-500)" : "#1B1930",
                }}
              />
            ))}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-white/5 p-4">
              <div className="mono-label text-text-muted-dark">UNSOLD (BURN TARGET)</div>
              <div className="mono-data mt-1 text-xl tnum text-white">
                {fmtTokens(a.treasury)} shares
              </div>
            </div>
            <div className="rounded-lg bg-white/5 p-4">
              <div className="mono-label text-text-muted-dark">VAULT AFTER EXPIRY</div>
              <div className="mono-data mt-1 text-xl tnum text-mint-400">
                {fmtUsdc(a.vault, 0)} USDC
              </div>
            </div>
            <div className="rounded-lg bg-white/5 p-4">
              <div className="mono-label text-text-muted-dark">CLAIM WINDOW</div>
              <div className="mono-data mt-1 text-xl tnum text-white">
                {a.claimWindow ? `${a.claimWindow / 86_400} days` : "none"}
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Expire card */}
          <div className="rounded-panel bg-ink-950 p-6 text-white">
            <div className="flex items-center justify-between">
              <span className="mono-label text-text-muted-dark">STEP 1 · ANYONE</span>
              <StatusPill status={a.status} />
            </div>
            <h2 className="mt-3 font-display text-2xl">Expire agreement</h2>
            <p className="mt-2 text-sm text-text-muted-dark">
              Starts the claim clock and burns unsold tokens. Enabled only when
              the time has passed or the cap is reached.
            </p>

            {burned !== null ? (
              <div className="mt-4 rounded-lg bg-mint-400/10 p-4 ring-1 ring-mint-400/40">
                <span className="mono-label text-mint-400">BURNED</span>
                <div className="mono-data mt-1 text-2xl tnum text-white">
                  {fmtTokens(burned)} shares destroyed
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg bg-white/5 p-4">
                <span className="mono-label text-text-muted-dark">
                  BURNING ON EXPIRY
                </span>
                <div className="mono-data mt-1 text-2xl tnum text-white">
                  {fmtTokens(a.treasury)} shares
                </div>
              </div>
            )}

            <Button
              className="mt-5 w-full"
              onClick={expire}
              disabled={!canExpire || a.status !== "active"}
              variant={canExpire ? "primary" : "ghostDark"}
            >
              {a.status !== "active" ? "Already expired" : canExpire ? "Expire agreement" : "End condition not met yet"}
            </Button>
            {error && a.status === "active" && (
              <p className="mt-2 text-sm text-red-400">{error}</p>
            )}
          </div>

          {/* Close card */}
          <div className="rounded-panel bg-ink-950 p-6 text-white">
            <div className="flex items-center justify-between">
              <span className="mono-label text-text-muted-dark">STEP 2 · CREATOR</span>
              <Chip>claim_party first?</Chip>
            </div>
            <h2 className="mt-3 font-display text-2xl">Close agreement</h2>
            <p className="mt-2 text-sm text-text-muted-dark">
              {a.status === "expired"
                ? closeState.ok
                  ? "The claim window has done its job — the vault returns to the creator."
                  : closeState.reason
                : "Expire the agreement first."}
            </p>

            {closed ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg bg-mint-400/10 p-4 ring-1 ring-mint-400/40">
                  <span className="mono-label text-mint-400">RETURNED TO CREATOR</span>
                  <div className="mono-data mt-1 text-3xl tnum text-white">
                    {fmtUsdc(closed.returned)} USDC
                  </div>
                  <div className="mono-label mt-1 text-text-muted-dark">
                    + {closed.rent.toLocaleString()} LAMPORTS OF RENT RECLAIMED
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                  <span className="mono-label text-amber-400">POST-CLOSE</span>
                  <p className="mt-2 text-sm text-text-muted-dark">
                    Tokens still linger in wallets — but they are inert now.
                    The agreement account is gone; the tokens simply do nothing.
                  </p>
                  <Link
                    to="/closer"
                    className="mono-label mt-3 inline-block text-purple-300 underline"
                  >
                    CONTINUE TO THE CLOSER →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-white/5 p-4">
                  <div className="mono-label text-text-muted-dark">
                    RETURNS TO CREATOR
                  </div>
                  <div className="mono-data mt-1 text-2xl tnum text-mint-400">
                    {fmtUsdc(a.vault, 0)}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 p-4">
                  <div className="mono-label text-text-muted-dark">RENT BACK</div>
                  <div className="mono-data mt-1 text-2xl tnum text-white">
                    ~0.05 SOL
                  </div>
                </div>
              </div>
            )}

            {!closed && (
              <>
                <Button
                  className="mt-5 w-full"
                  onClick={closeAgreement}
                  disabled={!closeState.ok}
                  variant={role === "creator" ? "primary" : "ghostDark"}
                >
                  {role === "creator" ? "Close agreement" : "Switch to Creator to close"}
                </Button>
                {walletOwed > 0n && (
                  <p className="mt-3 rounded-lg bg-amber-500/15 px-3 py-2.5 text-sm text-amber-400">
                    You still have {fmtUsdc(walletOwed)} USDC of wallet-party
                    share waiting.{" "}
                    <Link to={`/a/${config}/claim`} className="underline">
                      Claim it first →
                    </Link>
                  </p>
                )}
                {error && (
                  <p className="mt-3 text-sm text-red-400">{error}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Burned cells */}
        {(burned !== null || closed) && (
          <section className="mt-6 rounded-panel border border-ink-700 bg-ink-950 p-6 text-white">
            <span className="mono-label text-text-muted-dark">
              SUPPLY AFTER {closed ? "CLOSE" : "EXPIRY"} — BURNED CELLS OUTLINED
            </span>
            <CellGrid
              className="mt-4"
              totalCells={100}
              counts={{
                sold: Number((a.sharesSold * 100n) / (a.supply || 1n)),
                yours: 0,
                unsold: 0,
                burned: burned !== null ? Number((burned * 100n) / (a.supply || 1n)) : 0,
              }}
            />
          </section>
        )}

        <div className="mt-6">
          <StatRow
            className="max-w-md text-text-muted-light"
            label="Active role"
            value={role.toUpperCase()}
          />
        </div>

        <p className="mono-label mt-4 text-text-muted-light">
          <Link to={`/a/${config}`} className="text-purple-500 underline">
            BACK TO HUB
          </Link>
          {" · DUST ALLOWANCE 1,000 · DUST STAYS IN THE VAULT"}
        </p>
      </div>

      <TxDrawer
        open={tx.open}
        onClose={() => tx.setOpen(false)}
        title={lastIx}
        stage={tx.stage}
        checklist={tx.checks}
        computeUnits={lastIx === "close_agreement" ? 46_000 : 64_000}
        logs={
          lastIx === "close_agreement"
            ? ["Program log: vault drained to creator", "Program log: accounts closed"]
            : ["Program log: treasury burned", "Program log: claim deadline set"]
        }
      />
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
