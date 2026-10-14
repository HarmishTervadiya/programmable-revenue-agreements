import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import type { Persona } from "@/protocol";
import { STEPS, stepIndex, useUi, type StepId } from "@/state/ui";

/**
 * Left rail: where you are (steps), who you are (personas), what time it is
 * (protocol clock), and the mode/reset footer.
 */
export function Rail({
  personas,
  resolvedAs,
  clock,
  mode,
  onReset,
  onAdvanceDays,
  daysToExpiry,
}: {
  personas: Persona[];
  resolvedAs: string | null;
  clock: number;
  mode: "mock" | "devnet";
  onReset: () => void;
  onAdvanceDays: (days: number) => void;
  daysToExpiry: number | null;
}) {
  const step = useUi((s) => s.step);
  const scenario = useUi((s) => s.scenario);
  const autoplay = useUi((s) => s.autoplay);
  const explicitAs = useUi((s) => s.as);
  const setStep = useUi((s) => s.setStep);
  const setAs = useUi((s) => s.setAs);
  const setAutoplay = useUi((s) => s.setAutoplay);
  const current = stepIndex(step);
  const isDevnet = mode === "devnet";

  return (
    <nav
      aria-label="Demo steps"
      className="rounded-panel border border-[var(--border-subtle)] bg-surface p-3 text-primary"
    >
      <p className="mono-label mb-2.5 mt-1 px-3 text-xs font-bold tracking-wider text-secondary">
        {mode === "devnet" ? "PRA · DEVNET" : scenario === "prince" ? "PRINCE'S STARTUP" : "BUILD YOUR OWN"}
      </p>

      <ol className="space-y-1">
        {STEPS.map((s, i) => {
          const state = i === current ? "active" : i < current ? "done" : "idle";
          return (
            <li key={s.id}>
              <button
                onClick={() => setStep(s.id as StepId)}
                aria-current={state === "active" ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-3 text-left transition-colors",
                  state === "active" &&
                    "bg-accent text-white shadow-[0_0_24px_-6px_rgb(109_69_254/0.4)]",
                  state === "done" && "text-primary hover:bg-purple-50",
                  state === "idle" && "text-secondary hover:bg-purple-50 hover:text-primary",
                )}
              >
                <span
                  className={cn(
                    "mono-label w-5 shrink-0 text-xs font-semibold",
                    state === "active" ? "text-white" : "text-secondary",
                  )}
                >
                  {s.n}
                </span>
                <span className="truncate text-sm font-medium">{s.label}</span>
                {state === "done" && (
                  <span className="ml-auto text-xs font-bold text-healthy" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <p className="mono-label mb-2 mt-5 px-3 text-xs font-bold tracking-wider text-secondary">
        {isDevnet ? "YOUR WALLET ACTS" : "ACTING AS"}
      </p>
      {isDevnet ? (
        <p className="px-3 text-xs leading-relaxed text-secondary">
          The connected wallet signs every action. There are no demo personas on devnet.
        </p>
      ) : (
      <>
      <div role="radiogroup" aria-label="Active persona" className="space-y-1">
        {personas.map((p) => {
          const on = p.id === resolvedAs;
          const explicit = p.id === explicitAs;
          return (
            <button
              key={p.id}
              role="radio"
              aria-checked={on}
              onClick={() => setAs(p.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left transition-colors",
                on
                  ? "bg-purple-50 text-accent ring-1 ring-purple-500/40"
                  : "text-secondary hover:bg-purple-50 hover:text-primary",
              )}
            >
              <span className="truncate text-sm font-medium">{p.label}</span>
              <span className={cn("mono-label ml-auto shrink-0 text-xs font-semibold", on ? "text-accent" : "text-secondary")}>
                {on && !explicit ? "AUTO" : p.role.slice(0, 3).toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-3 text-xs text-secondary">Auto-set per step · 1-4 to override</p>
      </>
      )}

      <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
        {isDevnet ? (
          <div className="px-3">
            <span className="mono-label text-xs font-semibold text-secondary">DEVNET TIME</span>
            <p className="mono-data mt-1 text-xs font-semibold text-accent tnum">{fmtTime(clock)}</p>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              Real chain time. Expiry follows the agreement&apos;s date or revenue cap.
            </p>
          </div>
        ) : (
        <>
        <div className="flex items-center justify-between px-3">
          <span className="mono-label text-xs font-semibold text-secondary">PROTOCOL CLOCK</span>
          <span className="mono-data text-xs font-semibold text-accent tnum">{fmtTime(clock)}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 px-3">
          <ClockBtn label="+1D" onClick={() => onAdvanceDays(1)} />
          <ClockBtn label="+30D" onClick={() => onAdvanceDays(30)} />
          <ClockBtn label="+1Y" onClick={() => onAdvanceDays(365)} />
          <ClockBtn
            label="TO EXPIRY"
            onClick={() => onAdvanceDays(daysToExpiry ?? 0)}
            disabled={daysToExpiry === null || daysToExpiry <= 0}
          />
        </div>
        <button
          onClick={() => setAutoplay(!autoplay)}
          aria-pressed={autoplay}
          className={cn(
            "mono-label mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-full border text-xs font-semibold transition-colors",
            autoplay
              ? "border-accent bg-accent/15 text-accent"
              : "border-purple-500/20 text-secondary hover:border-accent hover:text-primary hover:bg-purple-50",
          )}
        >
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              autoplay ? "bg-accent" : "bg-current opacity-70",
            )}
          />
          AUTOPLAY {autoplay ? "ON" : "OFF"}
        </button>
        </>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-1 pt-4">
        <p className="mono-label text-xs font-medium text-secondary">
          {mode === "mock" ? "MOCK · OFFLINE" : "LIVE · DEVNET RPC"}
        </p>
        <button
          onClick={onReset}
          className="mono-label text-xs font-medium text-secondary underline-offset-4 hover:text-primary hover:underline"
        >
          {mode === "mock" ? "RESET (R)" : "NEW AGREEMENT"}
        </button>
      </div>
    </nav>
  );
}

function ClockBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "mono-label rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
        disabled
          ? "border-purple-500/15 text-secondary/55 cursor-not-allowed"
          : "border-purple-500/20 text-secondary hover:border-accent hover:text-primary hover:bg-purple-50",
      )}
    >
      {label}
    </button>
  );
}
