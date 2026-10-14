import { motion } from "motion/react";
import { CellGrid } from "@/components/viz/cell-grid";
import { TierWaterfall } from "@/components/viz/tier-waterfall";
import { Chip, KpiBadge, StatusPill } from "@/components/ui/chip";
import { Table } from "@/components/ui/table";
import { HelpTip } from "@/components/ui/tooltip";
import {
  claimableFor,
  fmtPct,
  fmtShares,
  fmtUsd,
  fmtUsdWhole,
  partyClaimable,
  truncAddress,
  type AgreementState,
} from "@/protocol";
import { fmtBps, fmtTime, fmtTokens } from "@/lib/format";
import { useUi } from "@/state/ui";

/** Staggered fade-in for the board's stacked sections. */
const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
};

/**
 * Center board: the deal itself — identity, money moved, the tier waterfall
 * that routes it, and who owns what. Pure read model over AgreementState.
 */
export function DealBoard({ a, resolvedAs }: { a: AgreementState | null; resolvedAs: string | null }) {
  const setStep = useUi((s) => s.setStep);
  const step = useUi((s) => s.step);

  if (!a) {
    return (
      <motion.section
        {...fadeUp}
        className="rounded-panel border border-[var(--border-subtle)] bg-surface p-6 text-primary md:p-8"
      >
        <span className="mono-label text-xs font-bold tracking-wider text-accent">THE BOARD IS EMPTY</span>
        <h2 className="mt-4 font-display text-3xl text-primary md:text-4xl">
          Create the agreement to light it up.
        </h2>
        <p className="mt-3 max-w-lg text-secondary">
          Step 01 mints the instrument: fixed supply, tier waterfall, expiry and
          claim window — one instruction, one signature.
        </p>
        {step !== "create" && (
          <button
            onClick={() => setStep("create")}
            className="mono-label mt-6 inline-flex h-11 items-center rounded-full bg-accent px-5 text-xs font-semibold text-white transition-colors hover:bg-purple-400"
          >
            GO TO STEP 01 →
          </button>
        )}
      </motion.section>
    );
  }

  const you = resolvedAs ? a.holders.find((h) => h.id === resolvedAs) : undefined;
  const frozen = a.holders.filter((h) => h.claim.frozen);
  const perCell = a.supply >= 100n ? a.supply / 100n : 1n;
  const cells = (v: bigint) => Number(v / perCell);
  const yourCells = you ? cells(you.balance) : 0;
  const frozenCells = frozen.reduce((s, h) => s + cells(h.balance), 0);
  const creatorParty = partyClaimable(a, a.creator);

  return (
    <div className="space-y-5">
      {/* Identity */}
      <motion.section
        {...fadeUp}
        className="rounded-panel border border-[var(--border-subtle)] bg-surface p-6 text-primary md:p-8"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Chip>AGREEMENT {String(a.agreementId).slice(-6)}</Chip>
          <StatusPill status={a.status} />
          {frozen.length > 0 && <StatusPill status="frozen" />}
        </div>
        <h1
          className="mt-3 font-display text-primary"
          style={{ fontSize: "clamp(30px, 4vw, 52px)", lineHeight: 1.03, letterSpacing: "-0.03em" }}
        >
          {a.name}
        </h1>
        <p className="mono-label mt-2.5 text-xs font-medium text-secondary">
          CREATOR {truncAddress(a.creator)} · {a.tiers.length} TIERS ·{" "}
          {fmtTokens(a.supply)} TOKENS · {fmtUsd(a.sharePrice, 0)} / TOKEN
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <KpiBadge value={fmtUsd(a.totalDeposited, 0)} label="REVENUE DEPOSITED" />
          <KpiBadge
            value={`${fmtTokens(a.sharesSold)}/${fmtTokens(a.supply)}`}
            label="SHARES SOLD"
            tone="coral"
          />
          <KpiBadge value={fmtUsd(a.vault, 0)} label="VAULT (UNCLAIMED)" tone="black" />
          <KpiBadge
            value={a.expTime ? fmtTime(a.expTime).replace(/,.*$/, "") : "NONE"}
            label={a.status === "expired" ? "EXPIRED" : "EXPIRES"}
          />
        </div>
      </motion.section>

      {/* Waterfall */}
      <motion.section
        {...fadeUp}
        transition={{ ...fadeUp.transition, delay: 0.08 }}
        className="framed-dashboard rounded-panel border border-ink-700 bg-ink-950 p-6 text-white md:p-8"
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h3 className="mono-label text-xs font-bold tracking-wider text-text-muted-dark">
            TIER WATERFALL — EVERY DOLLAR ROUTED IN ORDER
          </h3>
          <span className="mono-data text-xs font-semibold text-purple-300 tnum">
            {a.endCap !== null && `CAP ${fmtUsdWhole(a.endCap)} · `}
            {a.expTime !== null ? `EXPIRES ${fmtTime(a.expTime)}` : "NO DATE EXPIRY"}
          </span>
        </div>
        <TierWaterfall
          tiers={a.tiers}
          totalDeposited={a.totalDeposited}
          supply={a.supply}
          endCap={a.endCap}
        />
      </motion.section>

      {/* Ownership */}
      <motion.section
        {...fadeUp}
        transition={{ ...fadeUp.transition, delay: 0.16 }}
        className="rounded-panel border border-ink-700 bg-ink-950 p-6 text-white md:p-8"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="mono-label text-xs font-bold tracking-wider text-text-muted-dark">
            TOKEN SUPPLY — {fmtTokens(a.supply)} TOKENS SCALE
          </h3>
          <span className="mono-data text-xs font-semibold text-purple-300 tnum">
            SOLD {fmtBps(Math.round((Number(a.sharesSold) / Number(a.supply)) * 10_000))}
          </span>
        </div>
        <CellGrid
          totalCells={100}
          counts={{
            yours: yourCells,
            sold: Math.max(0, cells(a.sharesSold) - yourCells - frozenCells),
            unsold: cells(a.treasury),
            frozen: frozenCells,
          }}
        />
      </motion.section>

      {/* Holders */}
      <motion.section
        {...fadeUp}
        transition={{ ...fadeUp.transition, delay: 0.24 }}
        className="rounded-panel border border-[var(--border-subtle)] bg-surface p-6 text-primary md:p-8"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="mono-label text-xs font-bold tracking-wider text-secondary">POSITIONS</h3>
          <span className="mono-label flex items-center gap-2 text-xs font-semibold text-secondary">
            CLAIMABLE
            <HelpTip content="Claimable is live: it syncs against today's waterfall position without claiming." />
          </span>
        </div>
        <Table
          headers={["HOLDER", "SHARES", "VALUE", "CLAIMABLE", "STATE"]}
          rows={[
            ...a.holders.map((h) => [
              <span key={h.id} className={h.id === resolvedAs ? "text-accent font-semibold" : "text-primary"}>
                {h.label}
                {h.id === resolvedAs && <span className="mono-label ml-2 text-xs font-semibold text-secondary">YOU</span>}
              </span>,
              fmtShares(h.balance),
              fmtUsd((h.balance * a.sharePrice) / 1_000_000n, 0),
              fmtUsd(claimableFor(a, h.id)),
              h.claim.frozen ? <StatusPill key="f" status="frozen" /> : "—",
            ]),
            ...(creatorParty > 0n
              ? [
                  [
                    <span key="party" className="text-accent font-semibold">
                      {truncAddress(a.creator)}
                      <span className="mono-label ml-2 text-xs font-semibold text-secondary">PARTY</span>
                    </span>,
                    "—",
                    "—",
                    fmtUsd(creatorParty),
                    "—",
                  ],
                ]
              : []),
          ]}
        />
        <div className="mono-label mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-secondary">
          <span>
            VAULT {fmtUsd(a.vault, 0)} · OWED{" "}
            {fmtUsd(a.holders.reduce((s, h) => s + claimableFor(a, h.id), 0n) + creatorParty, 0)}
          </span>
          <span>UNSOLD IN TREASURY {fmtShares(a.treasury)}</span>
          {a.claimDeadline !== null && <span>CLAIM WINDOW ENDS {fmtTime(a.claimDeadline)}</span>}
        </div>
      </motion.section>

      {/* Tier table (numbers behind the waterfall picture) */}
      <motion.section
        {...fadeUp}
        transition={{ ...fadeUp.transition, delay: 0.32 }}
        className="rounded-panel border border-[var(--border-subtle)] bg-surface p-6 text-primary md:p-8"
      >
        <h3 className="mono-label text-xs font-bold tracking-wider text-secondary">
          TIER TABLE — THRESHOLDS & SPLITS
        </h3>
        <div className="mt-4">
          <Table
            headers={["UP TO", "HOLDERS", "PARTY", "PAID SO FAR"]}
            rows={a.tiers.map((t) => {
              const holdersBps = t.splits
                .filter((s) => s.party.kind === "holders")
                .reduce((n, s) => n + s.bps, 0);
              const wallets = t.splits.filter(
                (s) => s.party.kind === "wallet",
              ) as { party: { kind: "wallet"; address: string }; bps: number; owed: bigint }[];
              const paid = t.splits.reduce((n, s) => n + s.owed, 0n);
              return [
                t.threshold === null ? "UNCAPPED" : fmtUsdWhole(t.threshold),
                fmtPct(holdersBps),
                wallets.length
                  ? wallets.map((w) => `${fmtPct(w.bps)} ${truncAddress(w.party.address)}`).join(" · ")
                  : "—",
                fmtUsd(paid, 0),
              ];
            })}
          />
        </div>
      </motion.section>
    </div>
  );
}
