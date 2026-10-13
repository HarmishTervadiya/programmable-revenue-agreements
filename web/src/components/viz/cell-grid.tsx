import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

export type CellState = "sold" | "yours" | "unsold" | "burned" | "frozen";

/**
 * Token cell grid (deck slide 17): scale to supply, diagonal wave on change.
 * Sold = purple, Yours = bright purple-300, Unsold = ink-700,
 * Burned = outlined faint, Frozen = red outline. Legend underneath.
 */
export function CellGrid({
  totalCells,
  counts,
  className,
}: {
  totalCells: number;
  counts: Partial<Record<CellState, number>>;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const cells = useMemo(() => {
    const order: CellState[] = ["yours", "sold", "frozen", "burned"];
    const arr: CellState[] = [];
    for (const s of order) {
      const n = counts[s] ?? 0;
      for (let i = 0; i < n && arr.length < totalCells; i++) arr.push(s);
    }
    while (arr.length < totalCells) arr.push("unsold");
    return arr;
  }, [totalCells, counts]);

  const cols = Math.ceil(Math.sqrt(totalCells * 1.6));
  const fill: Record<CellState, string> = {
    yours: "bg-purple-300",
    sold: "bg-purple-500",
    unsold: "bg-ink-700",
    burned: "border border-ink-600 bg-transparent opacity-50",
    frozen: "border border-red-500 bg-red-500/20",
  };

  return (
    <div className={className}>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        role="img"
        aria-label={`Token grid: ${counts.sold ?? 0} sold, ${counts.yours ?? 0} yours, ${counts.unsold ?? 0} unsold${counts.burned ? `, ${counts.burned} burned` : ""}`}
      >
        {cells.map((state, i) => {
          const x = i % cols;
          const y = Math.floor(i / cols);
          return (
            <motion.span
              key={`${i}-${state}`}
              initial={reduced ? false : { opacity: 0.2, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                duration: 0.4,
                delay: reduced ? 0 : ((x + y) % 12) * 0.02,
                ease: [0.22, 1, 0.36, 1],
              }}
              className={cn("aspect-square rounded-[2px]", fill[state])}
            />
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {(
          [
            ["sold", "Sold"],
            ["yours", "Yours"],
            ["unsold", "Unsold (treasury)"],
            ["burned", "Burned"],
            ["frozen", "Frozen"],
          ] as [CellState, string][]
        ).map(([s, label]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn("inline-block h-2.5 w-2.5 rounded-[2px]", fill[s])} />
            <span className="mono-label text-xs font-medium text-text-muted-dark">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
