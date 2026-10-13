import { useNavigate } from "react-router-dom";
import { DotFrame } from "@/components/viz/dot-frame";
import { Mark, Wordmark } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { useJourney } from "@/state/journey";

/**
 * S0 Splash — deck slide 1: dot-matrix lavender, centred mark, two-tone
 * headline, mono subtitle, one primary CTA. Light world.
 */
export function Splash() {
  const nav = useNavigate();
  const setDemoMode = useJourney((s) => s.setDemoMode);

  return (
    <div className="theme-light relative min-h-screen overflow-hidden bg-purple-100">
      <DotFrame tone="light" />
      {/* Oversized chevron glyph bleeding off the edge, 4% purple */}
      <svg
        className="pointer-events-none absolute -right-24 top-1/2 h-[130vh] w-auto -translate-y-1/2"
        viewBox="0 0 200 260"
        fill="none"
        aria-hidden
      >
        <path
          d="M20 240 L100 30 L180 240 M55 240 L100 120 L145 240"
          stroke="#6D45FE"
          strokeWidth="10"
          opacity="0.04"
        />
      </svg>

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="flex flex-col items-center gap-6">
          <Mark size={56} />
          <Wordmark short={false} className="text-text-muted-light" />
        </div>

        <h1
          className="mt-10 font-display"
          style={{ fontSize: "clamp(44px, 6vw, 72px)", lineHeight: 1.02, letterSpacing: "-0.035em" }}
        >
          <span className="text-text-on-light">Revenue deals that</span>
          <br />
          <span style={{ color: "var(--color-purple-500)" }}>
            enforce themselves
          </span>
        </h1>

        <p className="mono-label mt-6 text-text-muted-light">
          PROGRAMMABLE REVENUE AGREEMENTS // BUILT ON SOLANA
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button
            onClick={() => {
              setDemoMode(true);
              nav("/create");
            }}
          >
            Start the demo
          </Button>
          <button
            onClick={() => nav("/open")}
            className="h-12 rounded-full border border-purple-500/20 bg-white px-6 text-base text-text-on-light transition-colors hover:border-purple-500/50"
          >
            Open an existing agreement
          </button>
        </div>

        <div className="mono-label mt-14 flex flex-wrap items-center justify-center gap-3 text-text-muted-light">
          <span>TOKEN-2022</span>
          <span className="text-purple-500">·</span>
          <span>TRANSFER HOOK</span>
          <span className="text-purple-500">·</span>
          <span>FIXED SUPPLY</span>
        </div>
      </div>
    </div>
  );
}
