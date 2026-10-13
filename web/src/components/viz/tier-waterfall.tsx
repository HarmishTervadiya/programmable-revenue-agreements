import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { HelpTip } from "@/components/ui/tooltip";
import { fmtUsdc, fmtBps } from "@/lib/format";
import { holdersBps, PRECISION, type Tier } from "@/lib/math/accumulator";

interface WaterfallProps {
  tiers: Tier[];
  totalDeposited: bigint;
  supply: bigint;
  endCap?: bigint | null;
  /** Pulsing incoming fill preview (deposit screen). */
  previewAmount?: bigint;
  /** Label currency for thresholds (whole units of 6dp). */
  className?: string;
}

const LAST_SHARE = 0.24; // uncapped tier gets a fixed slot

/**
 * The Tier Waterfall — the one memorable thing (style guide §8.1).
 * Horizontal stacked timeline; per-tier cells, split strips, moving cursor,
 * CAP marker, hover details, and a hidden table equivalent.
 */
export function TierWaterfall({
  tiers,
  totalDeposited,
  supply,
  endCap = null,
  previewAmount = 0n,
  className,
}: WaterfallProps) {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);

  // Geometry -------------------------------------------------------------
  const geom = useMemo(() => {
    const finite = tiers.filter((t) => t.threshold !== null);
    const lastFinite = finite.length
      ? (finite[finite.length - 1].threshold ?? 0n)
      : 0n;
    // sqrt scaling so huge tiers don't swallow the track
    const widths = tiers.map((t, i) => {
      if (t.threshold === null) return LAST_SHARE;
      const prev = i === 0 ? 0n : (tiers[i - 1].threshold ?? 0n);
      const w = Number(t.threshold - prev);
      return Math.sqrt(Math.max(w, 1));
    });
    const finiteTotal = widths
      .slice(0, finite.length)
      .reduce((a, b) => a + b, 0);
    const slotPct = widths.map((w, i) =>
      tiers[i].threshold === null ? LAST_SHARE : (w / finiteTotal) * (1 - LAST_SHARE),
    );
    // cursor position for an amount
    const posFor = (v: bigint): number => {
      if (lastFinite === 0n) return 0;
      if (v <= lastFinite) {
        let acc = 0;
        for (let i = 0; i < tiers.length; i++) {
          const t = tiers[i];
          if (t.threshold === null) break;
          const prev = i === 0 ? 0n : (tiers[i - 1].threshold ?? 0n);
          const seg = t.threshold - prev;
          if (v <= t.threshold) {
            return ((acc + (Number(v - prev) / Number(seg || 1n)) * slotPct[i]) * 100);
          }
          acc += slotPct[i];
        }
        return acc * 100;
      }
      // in the uncapped slot
      const over = Number(v - lastFinite) / Number(lastFinite || 1n);
      const uncapped = slotPct[slotPct.length - 1] ?? LAST_SHARE;
      const start = slotPct.slice(0, -1).reduce((a, b) => a + b, 0);
      return (start + Math.min(1, over) * uncapped) * 100;
    };
    return { slotPct, posFor, lastFinite };
  }, [tiers]);

  const cursorPct = geom.posFor(totalDeposited);
  const previewPct = previewAmount > 0n ? geom.posFor(totalDeposited + previewAmount) : null;

  return (
    <div className={cn("w-full", className)}>
      {/* Track */}
      <div className="relative flex items-stretch gap-[6px]" aria-label={waterfallSummary(tiers, totalDeposited, supply)}>
        {tiers.map((t, i) => {
          const prev = i === 0 ? 0n : (tiers[i - 1].threshold ?? 0n);
          const width = t.threshold === null ? null : t.threshold - prev;
          const filled = t.filled;
          const fillRatio =
            width === null || width === 0n
              ? 1
              : Math.min(1, Number(filled) / Number(width));
          const hb = holdersBps(t);
          const creatorBps = t.splits.reduce(
            (s, x) => (x.party.kind === "wallet" ? s + BigInt(x.bps) : s),
            0n,
          );
          const isLast = t.threshold === null;
          const hovered = hover === i;

          return (
            <div
              key={i}
              className="group relative flex flex-col"
              style={{ width: `${geom.slotPct[i] * 100}%`, minWidth: 64 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* Above: label + threshold */}
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="mono-label text-text-muted-dark">T{i}</span>
                <span className="mono-data text-text-muted-dark">
                  {isLast ? "∞" : fmtUsdc(width!, 0)}
                </span>
              </div>

              {/* Cells */}
              <div className="relative flex h-8 items-center gap-[3px] overflow-hidden rounded-md bg-ink-700 px-[3px]">
                <Cells
                  ratio={fillRatio}
                  reduced={!!reduced}
                  index={i}
                  preview={previewFill(tiers, i, previewAmount)}
                />
                {isLast && (
                  <div
                    className="pointer-events-none absolute inset-y-0 right-0 w-10"
                    style={{
                      background:
                        "linear-gradient(90deg, transparent, var(--bg-page, #0B0A12))",
                    }}
                  />
                )}
              </div>

              {/* Split strip: purple holders / coral wallet, always labelled in tooltip */}
              <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div className="bg-holders-share" style={{ width: `${Number(hb) / 100}%` }} />
                <div className="bg-creator-share" style={{ width: `${Number(creatorBps) / 100}%` }} />
              </div>

              {/* Below: acc_per_token */}
              <div className="mono-data mt-1.5 flex items-center gap-1 text-xs text-text-muted-dark">
                <span>acc {(Number(t.accPerToken) / Number(PRECISION)).toFixed(2)}</span>
                <HelpTip
                  content={`Revenue earned per token in this tier. A holder's claim is balance × (acc − last_acc) / 1e12 + pending.`}
                />
              </div>

              {/* Hover tooltip */}
              {hovered && (
                <div className="absolute -top-14 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink-950 px-3 py-2 text-xs text-white ring-1 ring-ink-600">
                  <div className="mono-label text-xs font-semibold text-text-muted-dark">
                    TIER {i} · {fmtUsdc(filled, 0)} / {isLast ? "∞" : fmtUsdc(width!, 0)}
                  </div>
                  <div className="mt-1">
                    <span className="text-purple-300">Holders {fmtBps(Number(hb))}</span>
                    {creatorBps > 0n && (
                      <span className="ml-2 text-coral-500">Wallet {fmtBps(Number(creatorBps))}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* CAP marker */}
        {endCap !== null && endCap > 0n && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10"
            style={{
              left: `calc(${geom.posFor(endCap)}% - 1px)`,
              borderLeft: "1px dashed var(--color-amber-500)",
            }}
          >
            <span className="mono-label absolute -top-6 -translate-x-1/2 text-xs font-bold text-amber-500">
              CAP
            </span>
          </div>
        )}

        {/* Cursor: total deposited */}
        <motion.div
          className="pointer-events-none absolute inset-y-0 z-10"
          initial={false}
          animate={{ left: `${cursorPct}%` }}
          transition={{ duration: reduced ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2 py-0.5">
            <span className="mono-data text-xs font-bold text-ink-950 tnum">
              {fmtUsdc(totalDeposited, 0)}
            </span>
          </div>
          <div className="h-full w-0.5 -translate-x-1/2 bg-white/80" />
        </motion.div>

        {/* Preview cursor (incoming deposit) */}
        {previewPct !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 animate-pulse"
            style={{ left: `${previewPct}%` }}
          >
            <div className="h-full w-0.5 -translate-x-1/2 bg-purple-300" />
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <LegendSwatch color="var(--holders-share)" label="Holders share" hatch={false} />
        <LegendSwatch color="var(--creator-share)" label="Wallet party (creator)" hatch />
        <span className="mono-label text-xs font-semibold text-text-muted-dark">
          CURSOR = TOTAL DEPOSITED
        </span>
      </div>

      {/* Accessible table equivalent */}
      <table className="sr-only">
        <caption>Tier waterfall data</caption>
        <thead>
          <tr><th>Tier</th><th>Threshold</th><th>Filled</th><th>Acc per token</th></tr>
        </thead>
        <tbody>
          {tiers.map((t, i) => (
            <tr key={i}>
              <td>T{i}</td>
              <td>{t.threshold === null ? "uncapped" : t.threshold.toString()}</td>
              <td>{t.filled.toString()}</td>
              <td>{t.accPerToken.toString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Staggered cells: 14px wide, 3px gap, 8ms stagger on fill change. */
function Cells({
  ratio,
  reduced,
  index,
  preview,
}: {
  ratio: number;
  reduced: boolean;
  index: number;
  preview: number; // 0..1 additional fill from a pending deposit
}) {
  const count = Math.max(4, Math.round(100 / 17)); // fit slot with 14px+3px cells
  const filled = Math.round(ratio * count);
  const previewCells = Math.round((ratio + preview) * count) - filled;
  return (
    <>
      {Array.from({ length: count }, (_, c) => {
        const isFilled = c < filled;
        const isPreview = c >= filled && c < filled + previewCells;
        return (
          <span
            key={c}
            className={cn(
              "h-5 flex-1 rounded-[2px] transition-colors",
              isFilled
                ? "bg-holders-share"
                : isPreview
                  ? "bg-purple-300/70"
                  : "bg-ink-600",
            )}
            style={
              reduced
                ? undefined
                : {
                    transitionDelay: isFilled ? `${index * 40 + c * 8}ms` : "0ms",
                  }
            }
          />
        );
      })}
    </>
  );
}

function previewFill(
  tiers: Tier[],
  index: number,
  incoming: bigint,
): number {
  if (incoming <= 0n) return 0;
  // Simulate where the incoming deposit lands without mutating.
  let remaining = incoming;
  let prev = 0n;
  for (let i = 0; i <= index; i++) {
    const t = tiers[i];
    const width = t.threshold === null ? remaining + t.filled : t.threshold - prev;
    const room = width - t.filled;
    const take = remaining < room ? remaining : room;
    if (i === index) {
      if (t.threshold === null || t.threshold === 0n) return 0;
      return Number(take) / Number(t.threshold - prev || 1n);
    }
    remaining -= take;
    if (remaining <= 0n) return 0;
    if (t.threshold !== null) prev = t.threshold;
  }
  return 0;
}

function LegendSwatch({
  color,
  label,
  hatch,
}: {
  color: string;
  label: string;
  hatch: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-block h-3 w-6 rounded-sm"
        style={{
          background: hatch
            ? `repeating-linear-gradient(45deg, ${color}, ${color} 3px, transparent 3px, transparent 6px), ${color}`
            : color,
        }}
      />
      <span className="mono-label text-xs font-medium text-text-muted-dark">{label}</span>
    </span>
  );
}

function waterfallSummary(tiers: Tier[], deposited: bigint, supply: bigint): string {
  return `Tier waterfall: ${tiers.length} tiers, ${fmtUsdc(deposited, 0)} USDC deposited of ${fmtUsdc(supply, 0)} token supply.`;
}
