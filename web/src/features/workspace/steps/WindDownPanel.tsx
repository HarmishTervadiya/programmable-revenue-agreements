import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  canClose,
  canExpire,
  expireReason,
  fmtUsd,
  totalClaimable,
  useProtocol,
  useProtocolSnapshot,
  type AgreementState,
} from "@/protocol";
import { PanelShell } from "./CreatePanel";
import { guardSubmit, txBusy } from "./util";

/**
 * Step 06 — expire + close. Expiry burns the unsold treasury and opens the
 * claim window; close drains the vault. Break-it buttons fire known-failing
 * instructions to show the plain-sentence errors.
 */
export function WindDownPanel({ state, clock }: { state: AgreementState | null; clock: number }) {
  const client = useProtocol();
  const { tx } = useProtocolSnapshot();
  const [submitting, setSubmitting] = useState(false);
  const [breakError, setBreakError] = useState<string | null>(null);

  if (!state) return null;

  const busy = txBusy(tx) || submitting;
  const expireOk = canExpire(state, clock);
  const closeOk = canClose(state, clock);

  const expire = () => {
    if (busy) return;
    setSubmitting(true);
    void guardSubmit(() => client.submit({ ix: "expire_agreement" })).finally(() => setSubmitting(false));
  };

  const close = () => {
    if (busy) return;
    setSubmitting(true);
    void guardSubmit(() => client.submit({ ix: "close_agreement" })).finally(() => setSubmitting(false));
  };

  const breakIt = (ix: "expire_agreement" | "close_agreement") => {
    if (busy) return;
    setBreakError(null);
    setSubmitting(true);
    void (async () => {
      try {
        await client.submit({ ix });
      } catch (err) {
        setBreakError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    })();
  };

  const statusPill = (s: AgreementState["status"]) => {
    const color =
      s === "active"
        ? "text-mint-700 border-mint-700/40 bg-mint-700/10"
        : s === "expired"
          ? "text-amber-800 border-amber-500/40 bg-amber-500/10"
          : "text-secondary border-purple-500/20 bg-purple-50";
    return <span className={`mono-label rounded-full border px-2.5 py-0.5 text-xs font-semibold ${color}`}>{s.toUpperCase()}</span>;
  };

  const daysLeft =
    state.expTime !== null && state.status === "active"
      ? Math.max(0, Math.ceil((state.expTime - clock) / 86_400))
      : null;

  const claimDaysLeft =
    state.claimDeadline !== null && state.status === "expired"
      ? Math.max(0, Math.ceil((state.claimDeadline - clock) / 86_400))
      : null;

  return (
    <PanelShell
      title="Expire + close"
      hint="Expiry burns unsold treasury, opens a 30-day claim window. Close drains the vault to zero."
    >
      <div className="space-y-4">
        {/* Status header */}
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-inset)] p-3.5">
          <span className="mono-label text-xs font-semibold text-secondary">STATUS</span>
          {statusPill(state.status)}
        </div>

        {/* Clock readouts */}
        <dl className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-inset)] p-3.5">
          {daysLeft !== null && (
            <div className="flex items-center justify-between gap-2">
              <dt className="mono-label text-xs font-medium text-secondary">EXPIRES IN</dt>
              <dd className="mono-data text-xs font-semibold text-primary tnum">{daysLeft} DAYS</dd>
            </div>
          )}
          {claimDaysLeft !== null && (
            <div className="flex items-center justify-between gap-2">
              <dt className="mono-label text-xs font-medium text-secondary">CLAIM WINDOW CLOSES IN</dt>
              <dd className="mono-data text-xs font-semibold text-primary tnum">{claimDaysLeft} DAYS</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <dt className="mono-label text-xs font-medium text-secondary">VAULT (CLAIMABLE)</dt>
            <dd className="mono-data text-xs font-semibold text-primary tnum">{fmtUsd(totalClaimable(state))}</dd>
          </div>
        </dl>

        {/* Expire button */}
        <div className="rounded-lg border border-[var(--border-subtle)] p-3.5">
          <span className="mono-label text-xs font-semibold text-secondary">EXPIRE</span>
          {!expireOk && state.status === "active" && (
            <p className="mt-2 text-sm font-medium text-amber-900">{expireReason(state, clock)}</p>
          )}
          <Button onClick={expire} disabled={!expireOk || busy} loading={busy} className="mt-3 w-full">
            Sign expire_agreement
          </Button>
        </div>

        {/* Close button */}
        <div className="rounded-lg border border-[var(--border-subtle)] p-3.5">
          <span className="mono-label text-xs font-semibold text-secondary">CLOSE</span>
          {!closeOk.ok && state.status === "expired" && (
            <p className="mt-2 text-sm font-medium text-amber-900">{closeOk.reason}</p>
          )}
          <Button onClick={close} disabled={!closeOk.ok || busy} loading={busy} className="mt-3 w-full">
            Sign close_agreement
          </Button>
        </div>

        {/* Break-it section */}
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3.5">
          <span className="mono-label text-xs font-bold text-red-600">BREAK-IT — WATCH THE ERROR</span>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            Fire a known-failing instruction to see the program's plain-sentence rejection.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => breakIt("close_agreement")} disabled={busy} size="sm" variant="secondary">
              CLOSE BEFORE EXPIRY
            </Button>
            <Button onClick={() => breakIt("expire_agreement")} disabled={busy} size="sm" variant="secondary">
              EXPIRE BEFORE END CONDITION
            </Button>
          </div>
          {breakError && (
            <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-sm font-medium text-red-700">
              {breakError}
            </p>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
