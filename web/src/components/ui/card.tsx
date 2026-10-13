import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** White card on lavender — no shadow, depth from contrast only. */
export function RowCard({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      className={cn(
        "rounded-card bg-surface p-5 text-secondary",
        onClick && "cursor-pointer transition-transform duration-[180ms] ease-[var(--ease-out-expo)] hover:-translate-y-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Dark metric card: mono label, big tabular number, hairline border. */
export function MetricCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-[var(--border-subtle)] bg-ink-800 p-5",
        className,
      )}
    >
      <div className="mono-label text-text-muted-dark">{label}</div>
      <div className="mt-2 font-display text-2xl tnum text-white">{value}</div>
      {hint && <div className="mt-1 text-sm text-text-muted-dark">{hint}</div>}
    </div>
  );
}

/** Stat list row: label left, value right, hairline, optional ? tooltip slot. */
export function StatRow({
  label,
  value,
  help,
  className,
}: {
  label: string;
  value: ReactNode;
  help?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] py-3 last:border-0",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-sm text-secondary">
        {label}
        {help}
      </span>
      <span className="mono-data tnum text-primary">{value}</span>
    </div>
  );
}
