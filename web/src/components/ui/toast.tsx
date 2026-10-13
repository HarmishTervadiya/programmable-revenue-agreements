import { create } from "zustand";
import { AnimatePresence, motion } from "motion/react";
import { explorerTxUrl } from "@/lib/config";
import { truncAddress } from "@/lib/format";

export interface ToastData {
  id: number;
  message: string;
  signature?: string;
  /** Link the signature to the explorer (devnet only — mock sigs are fake). */
  link?: boolean;
  tone: "success" | "error" | "info";
}

interface ToastState {
  toasts: ToastData[];
  push: (t: Omit<ToastData, "id">) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 8000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Convenience: toast a successful tx. Pass link=false for mock signatures. */
export function toastTx(message: string, signature: string, link = true) {
  useToasts.getState().push({ message, signature, link, tone: "success" });
}
export function toastError(message: string) {
  useToasts.getState().push({ message, tone: "error" });
}

const DOT = {
  success: "bg-mint-400",
  error: "bg-red-500",
  info: "bg-purple-400",
} as const;

/** Dark pill, bottom-centre, mono signature + Explorer link. */
export function ToastHost() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto flex items-center gap-3 rounded-full bg-ink-950 px-4 py-2.5 text-white shadow-none ring-1 ring-ink-600"
            role="status"
          >
            <span className={cn2("h-2 w-2 rounded-full", DOT[t.tone])} />
            <span className="text-sm font-medium">{t.message}</span>
            {t.signature && (
              t.link ? (
                <a
                  href={explorerTxUrl(t.signature)}
                  target="_blank"
                  rel="noreferrer"
                  className="mono-data text-xs text-purple-300 underline-offset-2 hover:underline"
                >
                  {t.signature.startsWith("SIM") ? t.signature.slice(0, 10) + "…" : truncAddress(t.signature)}
                </a>
              ) : (
                <span className="mono-data text-xs text-white/50">{truncAddress(t.signature)}</span>
              )
            )}
            <button
              onClick={() => dismiss(t.id)}
              className="mono-label text-xs text-text-muted-dark hover:text-white"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// local join helper (avoids importing cn just for two classes)
function cn2(a: string, b: string) {
  return `${a} ${b}`;
}
