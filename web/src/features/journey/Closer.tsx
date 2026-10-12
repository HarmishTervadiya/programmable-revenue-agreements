import { useNavigate } from "react-router-dom";
import { Mark } from "@/components/ui/logo";

const GITHUB = "https://github.com/HarmishTervadiya/programmable-revenue-agreements";
const EXPLORER =
  "https://explorer.solana.com/address/2iEFwZ8qPjvEfSAtHqE7G7apQo9tVKFsiLrdAFC5sXop?cluster=devnet";
const DESIGN_DOC =
  "https://docs.google.com/document/d/1y3AuhMfTQc6bgxOIPWIdEFQGnIeNWhCRh3dM10o-LWE/edit?usp=sharing";

/**
 * S9 Closer — solid purple (deck slide 19): the ask, links, team, cohort.
 */
export function Closer() {
  const nav = useNavigate();
  return (
    <div className="theme-dark flex min-h-screen flex-col items-center justify-center gap-10 bg-purple-500 px-6 py-16 text-center">
      <Mark size={48} />

      <h1
        className="max-w-4xl font-display text-white"
        style={{ fontSize: "clamp(44px, 6vw, 80px)", lineHeight: 1.02, letterSpacing: "-0.035em" }}
      >
        Revenue that follows
        <br />
        the rules
      </h1>

      <p className="max-w-xl text-lg text-white/75">
        Programmable revenue agreements: fixed supply, tiered waterfall,
        transfer-hook claims. Built on Solana with Anchor and Token-2022.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {[
          ["GitHub", GITHUB],
          ["Program on Explorer", EXPLORER],
          ["Design doc", DESIGN_DOC],
        ].map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="mono-label inline-flex h-12 items-center rounded-full bg-white px-6 text-ink-950 transition-transform duration-[180ms] ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:bg-purple-100"
          >
            {label.toUpperCase()} ↗
          </a>
        ))}
      </div>

      <div className="space-y-2">
        <p className="mono-label text-white/70">BUILT BY</p>
        <p className="font-display text-2xl text-white">Harmis · harpalll</p>
        <p className="mono-label text-white/60">TURBIN3 COHORT</p>
      </div>

      <button
        onClick={() => nav("/")}
        className="mono-label text-white/70 underline underline-offset-4 hover:text-white"
      >
        BACK TO THE TOP
      </button>
    </div>
  );
}
