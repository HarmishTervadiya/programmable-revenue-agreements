import * as RDialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

export type TxStage = "Build" | "Simulate" | "Sign" | "Confirm" | "Finalized";
const STAGES: TxStage[] = ["Build", "Simulate", "Sign", "Confirm", "Finalized"];

/**
 * Right-side black frosted drawer listing the stages of a transaction:
 * Build → Simulate → Sign → Confirm → Finalized, with a segmented bar.
 */
export function TxDrawer({
  open,
  onClose,
  title,
  stage,
  checklist,
  signature,
  computeUnits,
  logs,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  stage: TxStage | null;
  checklist?: { label: string; done: boolean }[];
  signature?: string;
  computeUnits?: number;
  logs?: string[];
}) {
  const stageIndex = stage ? STAGES.indexOf(stage) : -1;
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-ink-950/60 backdrop-blur-[2px]" />
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-ink-700 bg-ink-950/95 p-6 backdrop-blur"
        >
          <div className="flex items-center justify-between">
            <span className="mono-label text-text-muted-dark">TRANSACTION</span>
            <RDialog.Close className="mono-label text-text-muted-dark hover:text-white">
              ✕ CLOSE
            </RDialog.Close>
          </div>
          <h3 className="mt-4 font-display text-xl text-white">{title}</h3>

          {/* Segmented progress */}
          <div className="mt-6 flex gap-1" aria-label={`Stage: ${stage ?? "idle"}`}>
            {STAGES.map((s, i) => (
              <div
                key={s}
                className={cn(
                  "h-6 flex-1 rounded-sm transition-colors duration-300",
                  i <= stageIndex ? "bg-purple-500" : "bg-ink-700",
                )}
              />
            ))}
          </div>
          <div className="mono-label mt-2 flex justify-between text-text-muted-dark">
            {STAGES.map((s, i) => (
              <span key={s} className={i <= stageIndex ? "text-purple-300" : ""}>
                {s.toUpperCase()}
              </span>
            ))}
          </div>

          {checklist && (
            <ul className="mt-6 space-y-2.5">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-3 text-sm">
                  <span
                    className={cn(
                      "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px]",
                      c.done
                        ? "border-mint-400 bg-mint-400/20 text-mint-400"
                        : "border-ink-600 text-text-muted-dark",
                    )}
                  >
                    {c.done ? "✓" : ""}
                  </span>
                  <span className={c.done ? "text-white" : "text-text-muted-dark"}>
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-auto space-y-3">
            {signature && (
              <div className="mono-data break-all text-purple-300">{signature}</div>
            )}
            {computeUnits !== undefined && (
              <div className="mono-label text-text-muted-dark">
                COMPUTE UNITS {computeUnits.toLocaleString()} · FEE 5000 LAMPORTS
              </div>
            )}
            {logs && logs.length > 0 && (
              <details className="group">
                <summary className="mono-label cursor-pointer text-text-muted-dark hover:text-white">
                  SHOW LOGS
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black p-3 text-[11px] leading-4 text-mint-400/90">
                  {logs.join("\n")}
                </pre>
              </details>
            )}
          </div>
        </motion.div>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Preset: the seven things that happen in initialize_agreement. */
export const INIT_CHECKLIST = [
  "Agreement + tier state created",
  "Token-2022 extensions initialised (frozen default, transfer hook)",
  "Entitlement mint created (6 decimals)",
  "Treasury created and thawed",
  "Vault created (program-owned)",
  "Hook extra-account list registered",
  "Supply minted, mint authority revoked",
].map((label) => ({ label, done: false }));

export { AnimatePresence };
