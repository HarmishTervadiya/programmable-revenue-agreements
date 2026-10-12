import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as RDialog from "@radix-ui/react-dialog";
import { motion } from "motion/react";
import { TopChrome } from "@/features/journey/chrome";
import { RoleSwitcher } from "@/features/journey/stepper";
import { useEnsureAgreement } from "@/features/journey/seed";
import { useTxSequence } from "@/features/journey/use-tx-sequence";
import { Button } from "@/components/ui/button";
import { StatusPill, Chip } from "@/components/ui/chip";
import { Table } from "@/components/ui/table";
import { TxDrawer } from "@/components/ui/tx-drawer";
import { useExecute } from "@/lib/execute";
import { useJourney } from "@/state/journey";
import { useSim } from "@/state/sim";
import { claimable } from "@/lib/sim/simulator";
import { fmtUsdc, fmtTokens, fmtBps } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * S7 Admin — black compliance panel. Freeze / unfreeze with a required
 * confirm dialog; frozen rows get a red border + lock glyph.
 */
export function Admin() {
  useEnsureAgreement();
  const a = useSim((s) => s.agreement);
  const exec = useExecute();
  const role = useJourney((s) => s.role);
  const { config = "demo" } = useParams();
  const tx = useTxSequence();
  const [pending, setPending] = useState<{ id: string; label: string; freeze: boolean } | null>(null);
  const [ack, setAck] = useState(false);

  if (!a) return <BackTo config={config} />;

  const isAdmin = role === "admin";

  function confirm() {
    if (!pending) return;
    try {
      if (pending.freeze) exec.freeze(pending.id);
      else exec.unfreeze(pending.id);
      tx.run([
        pending.freeze
          ? "Position flag set to frozen in claim record"
          : "Position flag cleared",
        "Transfers + claims now blocked" + (pending.freeze ? "" : " — nothing moved"),
        "Balances and USDC untouched by design",
      ]);
    } catch {
      /* toast surfaced the error */
    }
    setPending(null);
    setAck(false);
  }

  return (
    <div className="theme-dark min-h-screen bg-[var(--bg-page)] pb-16 text-white">
      <TopChrome eyebrow="COMPLIANCE" invert />
      <div className="flex justify-center px-6">
        <div className="rounded-full bg-ink-950 p-1">
          <RoleSwitcher />
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-[1200px] px-6 md:px-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="font-display"
              style={{ fontSize: "clamp(34px, 4vw, 56px)", lineHeight: 1.03, letterSpacing: "-0.03em" }}
            >
              <span className="text-white">Freeze when needed,</span>{" "}
              <span style={{ color: "var(--color-red-500)" }}>move nothing</span>
            </h1>
            <p className="mt-3 max-w-2xl text-text-muted-dark">
              A freeze blocks transfers and claims. It never moves tokens or
              USDC — accrued revenue is kept and pays out on unfreeze.
            </p>
          </div>
          <Chip>freeze_position / unfreeze_position</Chip>
        </div>

        {!isAdmin && (
          <div className="mt-6 rounded-card border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
            Switch the active role to <strong>Compliance Admin</strong> to act.
            You can still inspect every position below.
          </div>
        )}

        <RowCardish>
          <div className="flex items-center justify-between">
            <span className="mono-label text-text-muted-dark">HOLDERS</span>
            <span className="mono-label text-text-muted-dark">
              {a.holders.length} POSITIONS ·{" "}
              {a.holders.filter((h) => h.claim.frozen).length} FROZEN
            </span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table
              headers={["Holder", "Shares", "% supply", "Claimable", "Status", "Action"]}
              rows={
                a.holders.length === 0
                  ? [["No holders yet.", "—", "—", "—", "—", "—"]]
                  : a.holders.map((h) => [
                      <span key={h.id} className="flex items-center gap-2 font-medium text-white">
                        <span
                          className={cn(
                            "inline-block h-4 w-1",
                            h.claim.frozen ? "bg-red-500" : "bg-transparent",
                          )}
                          aria-hidden
                        />
                        {h.claim.frozen && <LockGlyph />}
                        {h.label}
                      </span>,
                      fmtTokens(h.balance),
                      fmtBps(Math.round((Number(h.balance) / Number(a.supply)) * 10_000)),
                      fmtUsdc(claimable(a, h.id)),
                      <StatusPill key={`s${h.id}`} status={h.claim.frozen ? "frozen" : "active"} />,
                      <Button
                        key={`b${h.id}`}
                        size="sm"
                        variant={h.claim.frozen ? "ghostDark" : "danger"}
                        disabled={!isAdmin}
                        onClick={() =>
                          setPending({
                            id: h.id,
                            label: h.label,
                            freeze: !h.claim.frozen,
                          })
                        }
                      >
                        {h.claim.frozen ? "Unfreeze" : "Freeze"}
                      </Button>,
                    ])
              }
            />
          </div>
        </RowCardish>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            ["WHAT A FREEZE DOES", "Blocks transfer_hook and claim_tier_share for that holder."],
            ["WHAT IT NEVER DOES", "Never moves tokens, never touches the vault, never changes balances."],
            ["REVENUE IS KEPT", "Accrual continues while frozen; everything pays out on unfreeze."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-card border border-white/10 bg-ink-900 p-4">
              <span className="mono-label text-red-400">{t}</span>
              <p className="mt-2 text-sm text-text-muted-dark">{b}</p>
            </div>
          ))}
        </div>

        <p className="mono-label mt-6 text-text-muted-dark">
          <Link to={`/a/${config}`} className="text-purple-300 underline">
            BACK TO HUB
          </Link>
          {" · THE CLAIM BUTTON ON S5 IS DISABLED WHILE FROZEN"}
        </p>
      </div>

      {/* Required confirm dialog */}
      <RDialog.Root
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) {
            setPending(null);
            setAck(false);
          }
        }}
      >
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-[2px]" />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-1/2 z-50 w-[min(480px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-panel border border-white/10 bg-ink-950 p-6 text-white"
          >
            <RDialog.Title className="font-display text-2xl">
              {pending ? (pending.freeze ? `Freeze ${pending.label}?` : `Unfreeze ${pending.label}?`) : ""}
            </RDialog.Title>
            <RDialog.Description className="mt-3 text-sm text-text-muted-dark">
              {pending?.freeze
                ? "Freezing blocks transfers and claims. It never moves funds. The holder keeps every token and every accrued USDC."
                : "Unfreezing re-enables transfers and claims immediately. Nothing moves retroactively."}
            </RDialog.Description>

            {pending?.freeze && (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-red-500/10 p-3 ring-1 ring-red-500/40">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#FF4757]"
                />
                <span className="text-sm text-white">
                  I understand this blocks the holder's transfers and claims
                  until I unfreeze them.
                </span>
              </label>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <RDialog.Close asChild>
                <Button variant="ghostDark" onClick={() => setAck(false)}>
                  Cancel
                </Button>
              </RDialog.Close>
              <Button
                variant={pending?.freeze ? "danger" : "primary"}
                disabled={pending?.freeze ? !ack : false}
                onClick={confirm}
              >
                {pending?.freeze ? "Freeze position" : "Unfreeze position"}
              </Button>
            </div>
          </motion.div>
        </RDialog.Portal>
      </RDialog.Root>

      <TxDrawer
        open={tx.open}
        onClose={() => tx.setOpen(false)}
        title="freeze_position"
        stage={tx.stage}
        checklist={tx.checks}
        computeUnits={32_000}
        logs={["Program log: claim record flag updated"]}
      />
    </div>
  );
}

function RowCardish({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-card border border-white/10 bg-ink-900 p-5">
      {children}
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="2" y="5" width="8" height="6" rx="1.5" stroke="#FF4757" strokeWidth="1.5" />
      <path d="M4 5V3.5a2 2 0 1 1 4 0V5" stroke="#FF4757" strokeWidth="1.5" />
    </svg>
  );
}

function BackTo({ config }: { config: string }) {
  return (
    <div className="theme-dark flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--bg-page)] p-8 text-center text-white">
      <h1 className="font-display text-3xl">No agreement loaded</h1>
      <Link to={`/a/${config}`} className="mono-label text-purple-300 underline">
        BACK TO HUB
      </Link>
    </div>
  );
}
