import { useUi } from "@/state/ui";

const KEYS: [string, string][] = [
  ["← / →", "Previous / next step"],
  ["1 – 4", "Act as creator · backer · depositor · admin"],
  ["D", "Toggle the event log"],
  ["P", "Presentation mode (125% type)"],
  ["R", "Reset the demo"],
  ["?", "This overlay (Esc closes)"],
];

/** Keyboard cheat sheet — `?` to open, Esc or `?` to close. */
export function HelpOverlay() {
  const close = () => useUi.getState().toggleHelp();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={close}
    >
      <div
        className="w-full max-w-lg rounded-panel border border-[var(--border-strong)] bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="mono-label text-xs font-bold tracking-wider text-accent">KEYBOARD</span>
          <button
            onClick={close}
            className="mono-label text-xs font-semibold text-secondary hover:text-primary"
            aria-label="Close"
          >
            ESC ✕
          </button>
        </div>
        <h2 className="mt-3 font-display text-2xl text-primary">Run it hands-free.</h2>
        <dl className="mt-5 space-y-3">
          {KEYS.map(([k, what]) => (
            <div key={k} className="flex items-center justify-between gap-4">
              <dt className="mono-label rounded-md border border-purple-500/20 bg-purple-100 px-3 py-1 text-xs font-bold text-purple-700">{k}</dt>
              <dd className="text-right text-sm font-medium text-secondary">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
