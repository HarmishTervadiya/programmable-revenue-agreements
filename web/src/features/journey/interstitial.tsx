import { useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useJourney } from "@/state/journey";

/**
 * Full-screen purple interstitial between journey steps (deck slide 7).
 * One centred sentence + a small black pill. 1.2s, skippable with Space
 * or click. Disabled under prefers-reduced-motion.
 */
export function Interstitial({
  sentence,
  pill,
  onDone,
}: {
  sentence: string;
  pill: string;
  onDone: () => void;
}) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const presentation = useJourney((s) => s.presentation);

  const finish = useCallback(() => onDone(), [onDone]);

  useEffect(() => {
    if (reduced || presentation) {
      // Instant state change + 120ms fade handled by AnimatePresence.
      const t = setTimeout(finish, 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(finish, 1200);
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") finish();
    };
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", key);
    };
  }, [finish, reduced, presentation]);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center gap-8 bg-purple-500 px-8 text-center"
      initial={{ opacity: reduced ? 0 : 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.4, ease: [0.22, 1, 0.36, 1] }}
      onClick={finish}
      role="status"
    >
      <h2 className="max-w-4xl font-display text-white" style={{ fontSize: "clamp(40px, 5vw, 72px)", lineHeight: 1.02, letterSpacing: "-0.035em" }}>
        {sentence}
      </h2>
      <span className="inline-flex items-center gap-2 rounded-full bg-ink-950 px-4 py-2">
        <span className="mono-label text-white">{pill}</span>
      </span>
      <span className="mono-label absolute bottom-8 text-white/60">
        SPACE OR CLICK TO CONTINUE
      </span>
    </motion.div>
  );
}

export { AnimatePresence };
