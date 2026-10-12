import { useState } from "react";
import type { TxStage } from "@/components/ui/tx-drawer";

const STAGES: TxStage[] = ["Build", "Simulate", "Sign", "Confirm", "Finalized"];

/**
 * Runs the five-stage transaction animation with a ticking checklist.
 * Used by Buy / Deposit / Claim / Admin / Wind-down (Create has its own
 * seven-step init variant).
 */
export function useTxSequence() {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<TxStage | null>(null);
  const [checks, setChecks] = useState<{ label: string; done: boolean }[]>([]);

  function run(labels: string[]) {
    setChecks(labels.map((label) => ({ label, done: false })));
    setOpen(true);
    setStage("Build");
    STAGES.forEach((s, i) => {
      setTimeout(() => setStage(s), 320 * (i + 1));
    });
    labels.forEach((_, i) => {
      setTimeout(() => {
        setChecks((cs) => cs.map((c, j) => (j <= i ? { ...c, done: true } : c)));
      }, 1400 + i * 200);
    });
    setTimeout(() => setStage("Finalized"), 320 * STAGES.length);
  }

  return { open, setOpen, stage, checks, run };
}
