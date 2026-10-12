import { cn } from "@/lib/cn";

/**
 * Product mark: stepped waterfall glyph (three descending bars) in a rounded
 * square, purple-500, 2px strokes, sharp joins. Original — not the Arcium logo.
 */
export function Mark({
  size = 40,
  className,
  inverted = false,
}: {
  size?: number;
  className?: string;
  inverted?: boolean;
}) {
  const stroke = inverted ? "#FFFFFF" : "var(--color-purple-500)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <rect
        x="1"
        y="1"
        width="38"
        height="38"
        rx="11"
        stroke={stroke}
        strokeWidth="2"
      />
      {/* Three descending bars = the tier waterfall */}
      <path d="M9 13h22" stroke={stroke} strokeWidth="3" strokeLinecap="square" />
      <path d="M9 20h15" stroke={stroke} strokeWidth="3" strokeLinecap="square" />
      <path d="M9 27h9" stroke={stroke} strokeWidth="3" strokeLinecap="square" />
    </svg>
  );
}

/** Wordmark: PRA / full name in Geist Mono uppercase, wide tracking. */
export function Wordmark({
  short = true,
  inverted = false,
  className,
}: {
  short?: boolean;
  inverted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mono-label whitespace-nowrap",
        inverted ? "text-white" : "text-primary",
        className,
      )}
      style={{ letterSpacing: "0.2em" }}
    >
      {short ? "PRA" : "PROGRAMMABLE REVENUE AGREEMENTS"}
    </span>
  );
}

/** Mark + wordmark lockup (top-right chrome, like the deck's ARCIUM). */
export function Lockup({ inverted = false }: { inverted?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Mark size={24} inverted={inverted} />
      <Wordmark inverted={inverted} />
    </div>
  );
}
