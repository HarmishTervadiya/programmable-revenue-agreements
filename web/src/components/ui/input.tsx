import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  suffix?: ReactNode;
  error?: string | null;
  hint?: string;
  /** Override hint color on dark panels (defaults to theme secondary). */
  hintClass?: string;
}

/** Light: white fill, 14px radius, mono suffix. Dark: ink-950 + ink-600. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ suffix, error, hint, hintClass, className, ...props }, ref) => (
    <div className="w-full">
      <div
        className={cn(
          "flex h-14 items-center gap-2 rounded-[14px] border bg-surface px-4",
          error
            ? "border-red-500"
            : "border-purple-500/15 focus-within:border-accent focus-within:glow-purple",
          className,
        )}
      >
        <input
          ref={ref}
          className="mono-data min-w-0 flex-1 bg-transparent text-right text-base outline-none placeholder:text-secondary"
          {...props}
        />
        {suffix && (
          <span className="mono-label shrink-0 text-xs font-semibold text-secondary">{suffix}</span>
        )}
      </div>
      {(error || hint) && (
        <p className={cn("mt-1.5 text-xs font-medium", error ? "text-danger" : hintClass ?? "text-secondary")}>
          {error ?? hint}
        </p>
      )}
    </div>
  ),
);
TextInput.displayName = "TextInput";

/** Numeric input: right-aligned mono tabular with live validation beneath. */
export const NumberInput = forwardRef<HTMLInputElement, TextInputProps>(
  (props, ref) => <TextInput inputMode="decimal" {...props} ref={ref} />,
);
NumberInput.displayName = "NumberInput";
