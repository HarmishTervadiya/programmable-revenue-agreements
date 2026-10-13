import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** No zebra, hairline rows, mono headers, right-aligned numbers. */
export function Table({
  headers,
  rows,
  className,
}: {
  headers: ReactNode[];
  rows: ReactNode[][];
  className?: string;
}) {
  return (
    <table className={cn("w-full border-collapse text-left", className)}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={i}
              className={cn(
                "mono-label border-b border-[var(--border-subtle)] pb-2.5 text-xs font-semibold tracking-wider text-secondary",
                i > 0 && "text-right",
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="transition-colors hover:bg-purple-50/60">
            {r.map((c, j) => (
              <td
                key={j}
                className={cn(
                  "border-b border-[var(--border-subtle)] py-3.5 text-sm",
                  j > 0 && "text-right",
                )}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
