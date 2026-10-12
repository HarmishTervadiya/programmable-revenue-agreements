import { useJourney, ROLES, type Role } from "@/state/journey";
import { cn } from "@/lib/cn";

/**
 * Journey stepper: segmented bar pinned top-centre.
 * N° 01 CREATE · N° 02 BUY · N° 03 DEPOSIT · N° 04 CLAIM
 */
export const JOURNEY_STEPS = [
  { id: "create", n: "01", label: "CREATE", path: "/create" },
  { id: "buy", n: "02", label: "BUY", path: "/a/demo/buy" },
  { id: "deposit", n: "03", label: "DEPOSIT", path: "/a/demo/deposit" },
  { id: "claim", n: "04", label: "CLAIM", path: "/a/demo/claim" },
] as const;

export type StepId = (typeof JOURNEY_STEPS)[number]["id"];

/** Segmented progress cells for the stepper (deck epoch bar). */
export function Stepper({ active, progress = 0 }: { active: StepId; progress?: number }) {
  const activeIndex = JOURNEY_STEPS.findIndex((s) => s.id === active);
  return (
    <nav
      aria-label="Journey steps"
      className="flex flex-wrap items-center justify-center gap-4 px-4"
    >
      {JOURNEY_STEPS.map((s, i) => {
        const isActive = s.id === active;
        const pct = i < activeIndex ? 1 : i === activeIndex ? progress : 0;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <span
              className={cn(
                "mono-label rounded-full px-2.5 py-1 transition-colors",
                isActive
                  ? "glow-purple bg-ink-900 text-white"
                  : i < activeIndex
                    ? "bg-ink-900/80 text-white/70"
                    : "bg-ink-900/40 text-white/40",
              )}
            >
              N° {s.n}
            </span>
            <span
              className={cn(
                "mono-label",
                isActive ? "text-white" : i < activeIndex ? "text-white/60" : "text-white/35",
              )}
            >
              {s.label}
            </span>
            <div className="flex gap-[3px]" aria-hidden>
              {Array.from({ length: 8 }, (_, c) => (
                <span
                  key={c}
                  className={cn(
                    "h-4 w-[6px] rounded-[2px]",
                    c / 8 < pct ? "bg-purple-500" : "bg-ink-700",
                  )}
                />
              ))}
            </div>
            {i < JOURNEY_STEPS.length - 1 && (
              <span className="mx-1 h-3 w-px bg-white/15" aria-hidden />
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** Role switcher — one presenter walks all five actors. */
export function RoleSwitcher({ invert = false }: { invert?: boolean }) {
  const { role, setRole, demoMode } = useJourney();
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full p-1",
        invert ? "bg-white/15" : "bg-ink-900/70",
      )}
      role="radiogroup"
      aria-label="Active role"
    >
      {!demoMode && (
        <span className="mono-label px-2 text-white/50">LIVE · </span>
      )}
      {ROLES.map((r) => (
        <button
          key={r.id}
          role="radio"
          aria-checked={role === r.id}
          onClick={() => setRole(r.id as Role)}
          className={cn(
            "mono-label rounded-full px-2.5 py-1 transition-colors",
            role === r.id
              ? "bg-white text-ink-950"
              : "text-white/60 hover:text-white",
          )}
        >
          {r.label.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
