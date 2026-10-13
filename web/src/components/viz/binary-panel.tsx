import { useMemo } from "react";

/**
 * Binary panel: solid purple column filled with rows of 0/1 in Geist Mono,
 * purple-300 at ~35%, hard-clipped. Right-hand half of explain splits.
 */
export function BinaryPanel({
  className,
  columns = 14,
}: {
  className?: string;
  columns?: number;
}) {
  const rows = useMemo(() => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 48271) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    return Array.from({ length: 60 }, () =>
      Array.from({ length: columns }, () => (rand() > 0.5 ? "1" : "0")).join(" "),
    );
  }, [columns]);

  return (
    <div
      className={`overflow-hidden bg-purple-500 select-none ${className ?? ""}`}
      aria-hidden
    >
      <pre
        className="mono-data h-full whitespace-pre px-6 py-8 text-purple-300"
        style={{ opacity: 0.35, lineHeight: "1.7" }}
      >
        {rows.join("\n")}
      </pre>
    </div>
  );
}
