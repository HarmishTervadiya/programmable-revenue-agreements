import * as RTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Black pill tooltip, white text, 8px radius, 150ms. */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RTooltip.Provider delayDuration={150}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            side="top"
            className={cn(
              "z-50 max-w-xs rounded-lg bg-ink-950 px-3 py-2 text-sm text-white shadow-none",
              className,
            )}
          >
            {content}
            <RTooltip.Arrow className="fill-ink-950" />
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

/** Small ? icon that explains a term (stat lists, tables). */
export function HelpTip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <button
        type="button"
        aria-label="Explain"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-strong)] text-[10px] leading-none text-secondary hover:border-accent hover:text-accent"
      >
        ?
      </button>
    </Tooltip>
  );
}
