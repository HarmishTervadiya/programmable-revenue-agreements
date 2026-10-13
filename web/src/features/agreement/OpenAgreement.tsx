import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DotFrame } from "@/components/viz/dot-frame";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { RowCard } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { useJourney } from "@/state/journey";

/**
 * Open an existing agreement by config address. Demo Mode jumps straight
 * into the seeded worked example.
 */
export function OpenAgreement() {
  const nav = useNavigate();
  const demo = useJourney((s) => s.demoMode);
  const [config, setConfig] = useState("");
  const [error, setError] = useState<string | null>(null);

  function open() {
    const v = config.trim();
    if (!v) {
      setError("Paste the agreement config address.");
      return;
    }
    if (v.length < 32) {
      setError("That doesn't look like a Solana address (32+ characters).");
      return;
    }
    nav(`/a/${v}`);
  }

  return (
    <div className="theme-light relative min-h-screen overflow-hidden bg-purple-100">
      <DotFrame tone="light" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
        <Chip>N° 02 · OPEN</Chip>
        <h1
          className="mt-5 font-display"
          style={{ fontSize: "clamp(36px, 5vw, 60px)", lineHeight: 1.03, letterSpacing: "-0.03em" }}
        >
          <span className="text-text-on-light">Open an existing</span>{" "}
          <span style={{ color: "var(--color-purple-500)" }}>agreement</span>
        </h1>
        <p className="body-lg mt-4 text-text-muted-light">
          Paste the config address to load live terms from devnet, or jump
          straight into the demo agreement.
        </p>

        <RowCard className="mt-8 text-text-on-light">
          <label className="block">
            <span className="mono-label text-text-muted-light">
              AGREEMENT CONFIG ADDRESS
            </span>
            <TextInput
              className="mt-2"
              value={config}
              onChange={(e) => {
                setConfig(e.target.value);
                setError(null);
              }}
              placeholder="Paste a Solana address…"
              error={error}
              hint={demo ? "Demo Mode is on — the hub will seed the worked example." : "Live mode reads this address from devnet."}
            />
          </label>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={open}>Open agreement</Button>
            <button
              onClick={() => nav("/a/demo")}
              className="h-12 rounded-full border border-purple-500/30 bg-white px-6 text-base text-text-on-light transition-colors hover:border-purple-500"
            >
              Use the demo agreement
            </button>
          </div>
        </RowCard>

        <p className="mono-label mt-6 text-text-muted-light">
          OR START FRESH →{" "}
          <button onClick={() => nav("/create")} className="text-purple-500 underline">
            CREATE A NEW AGREEMENT
          </button>
        </p>
      </div>
    </div>
  );
}
