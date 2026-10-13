import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** N° chip — the deck's signature. Inverts on dark backgrounds. */
export function Chip({
  children,
  invert = false,
  className,
}: {
  children: ReactNode;
  invert?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mono-label inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold",
        invert
          ? "bg-white text-ink-950"
          : "bg-ink-900 text-white",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** N° chip + uppercase mono label, 8px gap. */
export function Eyebrow({
  n,
  label,
  invert = false,
  className,
}: {
  n?: string;
  label: string;
  invert?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {n && <Chip invert={invert}>{n}</Chip>}
      <span className="mono-label text-xs font-semibold text-secondary">{label}</span>
    </div>
  );
}

/** KPI badge: coloured number chip + muted label. */
export function KpiBadge({
  value,
  label,
  tone = "purple",
  invert = false,
}: {
  value: string;
  label: string;
  tone?: "purple" | "black" | "coral";
  invert?: boolean;
}) {
  const toneCls =
    tone === "purple"
      ? "bg-accent text-white"
      : tone === "coral"
        ? "bg-coral-500 text-white"
        : "bg-ink-900 text-white";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border border-[var(--border-subtle)] bg-surface px-2 py-1.5",
        invert && "bg-white",
      )}
    >
      <span
        className={cn(
          "mono-label rounded-full px-3 py-1 text-xs font-semibold tnum",
          toneCls,
        )}
      >
        {value}
      </span>
      <span className="pr-3 text-xs font-semibold uppercase tracking-wider text-text-on-light">
        {label}
      </span>
    </div>
  );
}

const STATUS_TONES = {
  active: "var(--healthy)",
  expired: "var(--color-amber-500)",
  closed: "var(--text-secondary)",
  frozen: "var(--color-red-500)",
} as const;

/** Status pill: mono uppercase, tinted fill, 6px dot. */
export function StatusPill({
  status,
  className,
}: {
  status: keyof typeof STATUS_TONES;
  className?: string;
}) {
  const color = STATUS_TONES[status];
  return (
    <span
      className={cn(
        "mono-label inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
        className,
      )}
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-current"
        aria-hidden
      />
      {status}
    </span>
  );
}
