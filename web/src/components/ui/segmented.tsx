import { cn } from "@/lib/cn";

/** Inset pill segmented control (deck slide 5 pattern). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-surface-inset p-1",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-full transition-colors duration-[180ms]",
              size === "sm" ? "mono-label px-2.5 py-1" : "mono-label px-3.5 py-1.5",
              active
                ? "bg-ink-700 text-white"
                : "text-secondary hover:text-primary",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
