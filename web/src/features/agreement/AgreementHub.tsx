import { Link, useNavigate, useParams } from "react-router-dom";
import { TopChrome } from "@/features/journey/chrome";
import { JourneyBar } from "@/features/journey/journey-bar";
import { ACTORS, useEnsureAgreement } from "@/features/journey/seed";
import { TierWaterfall } from "@/components/viz/tier-waterfall";
import { CellGrid } from "@/components/viz/cell-grid";
import { KpiBadge, StatusPill, Chip } from "@/components/ui/chip";
import { StatRow } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSim } from "@/state/sim";
import { useJourney } from "@/state/journey";
import { fmtUsdc, fmtTokens, fmtBps, truncAddress, fmtTime } from "@/lib/format";
import type { StepId } from "@/features/journey/stepper";

/**
 * S2 Agreement Hub — the agreement's instrument panel (black world).
 * Hero + KPI pills, waterfall in a framed dashboard, stats, cell grid.
 */
export function AgreementHub() {
  useEnsureAgreement();
  const a = useSim((s) => s.agreement);
  const role = useJourney((s) => s.role);
  const { config } = useParams();
  const nav = useNavigate();

  if (!a) return <NoAgreement config={config ?? "demo"} />;

  const step: StepId =
    a.sharesSold === 0n ? "buy" : a.totalDeposited === 0n ? "deposit" : "claim";

  const you = a.holders.find((h) => h.id === ACTORS.buyer.id);
  const frozenHolders = a.holders.filter((h) => h.claim.frozen);
  const perCell = a.supply >= 100n ? a.supply / 100n : 1n;
  const cells = (v: bigint) => Number(v / perCell);
  const yoursCells = you ? cells(you.balance) : 0;
  const frozenCells = frozenHolders.reduce((s, h) => s + cells(h.balance), 0);

  const cta =
    role === "depositor"
      ? { label: "Deposit revenue", to: `/a/${config}/deposit` }
      : role === "holder"
        ? { label: "Claim earnings", to: `/a/${config}/claim` }
        : role === "admin"
          ? { label: "Admin panel", to: `/a/${config}/admin` }
          : role === "creator"
            ? { label: "Wind down", to: `/a/${config}/wind-down` }
            : { label: "Buy shares", to: `/a/${config}/buy` };

  return (
    <div className="theme-dark min-h-screen bg-[var(--bg-page)] pb-16 text-white">
      <TopChrome eyebrow="AGREEMENT" invert />
      <div className="px-6">
        <JourneyBar active={step} progress={0.5} />
      </div>

      <div className="mx-auto max-w-[1200px] px-6 md:px-12">
        {/* Hero */}
        <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Chip>{`AGREEMENT ${String(a.agreementId).slice(-6)}`}</Chip>
              <StatusPill status={a.status} />
              {frozenHolders.length > 0 && <StatusPill status="frozen" />}
            </div>
            <h1
              className="mt-3 font-display"
              style={{ fontSize: "clamp(36px, 4.5vw, 64px)", lineHeight: 1.02, letterSpacing: "-0.03em" }}
            >
              {a.name}
            </h1>
            <p className="mono-label mt-2 text-text-muted-dark">
              CREATOR {truncAddress(a.creator)} · {a.tiers.length} TIERS · FIXED
              SUPPLY
            </p>
          </div>
          <Button onClick={() => nav(cta.to)}>{cta.label}</Button>
        </div>

        {/* KPI row */}
        <div className="mt-6 flex flex-wrap gap-3">
          <KpiBadge invert value={fmtUsdc(a.totalDeposited, 0)} label="REVENUE DEPOSITED" />
          <KpiBadge
            invert
            value={`${fmtTokens(a.sharesSold)}/${fmtTokens(a.supply)}`}
            label="SHARES SOLD"
          />
          <KpiBadge invert value={fmtUsdc(a.vault, 0)} label="VAULT (UNCLAIMED)" tone="black" />
          <KpiBadge invert value={fmtUsdc(a.sharePrice, 0)} label="SHARE PRICE" tone="coral" />
        </div>

        {/* Waterfall in framed dashboard */}
        <section className="framed-dashboard mt-8 rounded-panel border border-ink-700 bg-ink-900/70 p-6 md:p-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <span className="mono-label text-text-muted-dark">
              TIER WATERFALL — EVERY DOLLAR ROUTED IN ORDER
            </span>
            <span className="mono-label text-purple-300">
              {a.endCap !== null && `CAP ${fmtUsdc(a.endCap, 0)} · `}
              {a.expTime !== null ? `EXPIRES ${fmtTime(a.expTime)}` : "NO DATE EXPIRY"}
            </span>
          </div>
          <TierWaterfall
            tiers={a.tiers}
            totalDeposited={a.totalDeposited}
            supply={a.supply}
            endCap={a.endCap}
          />
        </section>

        {/* Stats + cell grid */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="rounded-card border border-[var(--border-subtle)] bg-ink-800 p-5">
            <div className="mono-label text-text-muted-dark">TERMS</div>
            <div className="mt-2 font-display text-2xl tnum text-white">
              {fmtUsdc(a.sharePrice, 0)} USDC / SHARE
            </div>
            <div className="mt-3">
              <StatRow label="Supply" value={`${fmtTokens(a.supply)} tokens`} />
              <StatRow label="Treasury left" value={`${fmtTokens(a.treasury)} shares`} />
              <StatRow label="Cumulative cap" value={a.endCap ? `${fmtUsdc(a.endCap, 0)} USDC` : "—"} />
              <StatRow label="Claim window" value={a.claimWindow ? `${a.claimWindow / 86_400} days` : "—"} />
              <StatRow label="Depositor" value={truncAddress(a.depositor)} />
              <StatRow label="Compliance admin" value={truncAddress(a.complianceAdmin)} />
            </div>
          </div>

          <div className="rounded-card border border-[var(--border-subtle)] bg-ink-800 p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="mono-label text-text-muted-dark">
                TOKEN SUPPLY — {fmtTokens(a.supply)} CELLS SCALE
              </span>
              <span className="mono-label text-purple-300">
                SOLD {fmtBps(Math.round((Number(a.sharesSold) / Number(a.supply)) * 10_000))}
              </span>
            </div>
            <CellGrid
              totalCells={100}
              counts={{
                yours: yoursCells,
                sold: Math.max(0, cells(a.sharesSold) - yoursCells - frozenCells),
                unsold: cells(a.treasury),
                frozen: frozenCells,
              }}
            />
          </div>
        </div>

        {/* Action rail */}
        <nav className="mt-8 flex flex-wrap gap-3">
          {[
            ["Buy", `/a/${config}/buy`],
            ["Deposit", `/a/${config}/deposit`],
            ["Claim", `/a/${config}/claim`],
            ["Transfer lab", `/a/${config}/transfer`],
            ["Admin", `/a/${config}/admin`],
            ["Wind down", `/a/${config}/wind-down`],
          ].map(([label, to]) => (
            <Link
              key={label}
              to={to}
              className="mono-label rounded-full border border-white/15 px-4 py-2.5 text-white/70 transition-colors hover:border-purple-400 hover:text-white"
            >
              {label.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function NoAgreement({ config }: { config: string }) {
  return (
    <div className="theme-dark flex min-h-screen flex-col items-center justify-center gap-5 bg-[var(--bg-page)] p-8 text-center text-white">
      <Chip>N° 02</Chip>
      <h1 className="font-display text-4xl">No agreement loaded</h1>
      <p className="max-w-md text-text-muted-dark">
        Demo Mode seeds the worked example automatically. In live mode, open
        an agreement config address to load it from devnet.
      </p>
      <div className="flex gap-3">
        <Link to="/create" className="mono-label rounded-full bg-purple-500 px-5 py-3">
          CREATE ONE
        </Link>
        <Link to="/open" className="mono-label rounded-full border border-white/20 px-5 py-3">
          OPEN EXISTING ({config})
        </Link>
      </div>
    </div>
  );
}
