import { useRef, useState } from "react";
import type { TxStage } from "@/components/ui/tx-drawer";

const STAGES: TxStage[] = ["Build", "Simulate", "Sign", "Confirm", "Finalized"];
const STAGE_MS = 320;

/**
 * Runs the five-stage transaction animation with a ticking checklist.
 * The drawer auto-closes ~1.2s after the checklist finishes, so the page
 * never stays stuck behind the modal overlay.
 * Used by Buy / Deposit / Claim / Admin / Wind-down (Create has its own
 * seven-step init variant).
 */
export function useTxSequence() {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<TxStage | null>(null);
  const [checks, setChecks] = useState<{ label: string; done: boolean }[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function run(labels: string[]) {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const later = (ms: number, fn: () => void) =>
      timers.current.push(setTimeout(fn, ms));

    setChecks(labels.map((label) => ({ label, done: false })));
    setOpen(true);
    setStage("Build");
    STAGES.forEach((s, i) => {
      later(STAGE_MS * (i + 1), () => setStage(s));
    });
    const checklistEnd = 1400 + Math.max(0, labels.length - 1) * 200;
    labels.forEach((_, i) => {
      later(1400 + i * 200, () => {
        setChecks((cs) => cs.map((c, j) => (j <= i ? { ...c, done: true } : c)));
      });
    });
    later(STAGE_MS * STAGES.length, () => setStage("Finalized"));
    later(Math.max(STAGE_MS * STAGES.length, checklistEnd) + 1200, () =>
      setOpen(false),
    );
  }

  return { open, setOpen, stage, checks, run };
}
