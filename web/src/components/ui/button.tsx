import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background,border,box-shadow,transform] duration-[180ms] ease-[var(--ease-out-expo)] disabled:pointer-events-none disabled:opacity-40 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-white h-12 px-6 hover:bg-purple-300 hover:glow-purple active:bg-purple-600",
        secondary:
          "bg-surface text-primary h-11 px-5 border border-purple-500/20 hover:border-purple-500/50",
        ghostDark:
          "bg-transparent text-white h-11 px-5 border border-ink-600 hover:border-purple-400",
        ghost: "text-secondary hover:text-primary underline-offset-4 hover:underline h-9 px-1",
        pillLink:
          "bg-white text-ink-950 h-11 px-5 font-normal hover:bg-purple-100",
        danger:
          "h-11 px-5 border text-red-500 border-red-500/40 bg-red-500/15 hover:bg-red-500/25",
      },
      size: {
        md: "text-base",
        sm: "text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

/** Primary action. Loading swaps the label for a 3-dot pulse, width locked. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <LoadingDots /> : children}
    </button>
  ),
);
Button.displayName = "Button";

export function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60"
          style={{
            animation: "pra-pulse 900ms ease-in-out infinite",
            animationDelay: `${i * 150}ms`,
          }}
        />
      ))}
      <style>{`@keyframes pra-pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
    </span>
  );
}
