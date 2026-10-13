import { truncAddress } from "@/lib/format";
import { fmtUsd, type LogEntry } from "@/protocol";

/** 14:02 — the wall-clock part of a log entry's mock timestamp. */
function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Event log: every instruction the demo has run, newest first —
 * the transcript behind the board.
 */
export function EventLog({ log }: { log: LogEntry[] }) {
  if (log.length === 0) {
    return (
      <div className="flex min-h-32 flex-col justify-center rounded-panel border border-dashed border-[var(--border-subtle)] bg-surface p-5">
        <span className="mono-label text-xs font-semibold text-secondary">NO INSTRUCTIONS YET</span>
        <p className="mt-2 text-sm text-secondary">
          Every submit lands here with its accounts, amounts, and signature.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-panel border border-[var(--border-subtle)] bg-surface text-primary" role="log" aria-live="polite" aria-label="Event log">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="mono-label text-xs font-semibold text-secondary">EVENT LOG</span>
        <span className="mono-label text-xs tnum font-semibold text-accent">{log.length}</span>
      </div>
      <ol className="max-h-[38vh] space-y-0 overflow-y-auto">
        {[...log].reverse().map((e) => (
          <li key={e.seq} className="border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <span className="mono-label truncate text-xs font-semibold text-accent">
                {String(e.seq).padStart(3, "0")} · {e.ix}
              </span>
              <span className="mono-label shrink-0 text-xs text-secondary">{clock(e.ts)}</span>
            </div>
            <p className="mt-1 text-sm font-medium text-primary">{e.label}</p>
            <p className="mono-label mt-1 text-xs text-secondary">→ {e.after}</p>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              {e.amount !== undefined && e.amount > 0n ? (
                <span className="mono-data text-sm tnum font-bold text-healthy">
                  {fmtUsd(e.amount)}
                </span>
              ) : (
                <span />
              )}
              <span className="mono-data text-xs text-secondary">
                {truncAddress(e.signature)}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
