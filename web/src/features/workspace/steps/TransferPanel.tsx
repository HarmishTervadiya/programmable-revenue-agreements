import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/input";
import {
  fmtShares,
  useProtocol,
  useProtocolSnapshot,
  type AgreementState,
  type DemoScenario,
  type Persona,
} from "@/protocol";
import { useUi } from "@/state/ui";
import { PanelShell } from "./CreatePanel";
import { guardSubmit, parseNum, tokens, txBusy } from "./util";

/**
 * Step 05 — transfer + freeze. A backer can move their position; the
 * compliance admin can freeze/unfreeze any holder. Both leave a trace.
 */
export function TransferPanel({
  scenario,
  state,
  persona,
}: {
  scenario: DemoScenario;
  state: AgreementState | null;
  persona: Persona | null;
}) {
  const client = useProtocol();
  const { tx } = useProtocolSnapshot();
  const setAs = useUi((s) => s.setAs);
  const [amount, setAmount] = useState("100");
  const [toId, setToId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!state || !persona) return null;

  const n = parseNum(amount);
  const amountB = tokens(n);
  const holder = state.holders.find((h) => h.id === persona.id);
  const isBacker = persona.role === "backer";
  const isAdmin = persona.address === state.complianceAdmin;
  const recipients = scenario.personas.filter((p) => p.id !== persona.id && p.role !== "creator");
  const target = toId ?? recipients[0]?.id ?? null;

  const errors: string[] = [];
  if (!Number.isFinite(n) || n <= 0) errors.push("Enter a number of tokens above 0.");
  if (amountB > (holder?.balance ?? 0n))
    errors.push(`${persona.label} only holds ${fmtShares(holder?.balance ?? 0n)} tokens.`);
  if (state.status !== "active") errors.push("The agreement is no longer active — transfers are locked.");
  if (holder?.claim.frozen) errors.push("This position is frozen by the compliance admin.");
  if (!target) errors.push("Pick a recipient.");

  const busy = txBusy(tx) || submitting;
  const valid = errors.length === 0 && isBacker;

  const transfer = () => {
    if (!valid || busy) return;
    const toPersona = scenario.personas.find((p) => p.id === target);
    if (!toPersona) return;
    setSubmitting(true);
    void guardSubmit(() =>
      client.submit({
        ix: "transfer_hook",
        fromId: persona.id,
        fromLabel: persona.label,
        toId: toPersona.id,
        toLabel: toPersona.label,
        amount: amountB,
      }),
    ).finally(() => setSubmitting(false));
  };

  const freezeToggle = (id: string, frozen: boolean) => {
    if (busy) return;
    setSubmitting(true);
    void guardSubmit(() =>
      client.submit({ ix: frozen ? "unfreeze_position" : "freeze_position", holderId: id }),
    ).finally(() => setSubmitting(false));
  };

  return (
    <PanelShell
      title="Transfer + freeze"
      hint="The hook follows the position — earnings split at transfer time. Compliance can freeze/unfreeze any holder."
    >
      <div className="space-y-4">
        {/* Transfer card — only for backer role */}
        {isBacker ? (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-surface-inset p-3.5">
            <span className="mono-label text-xs font-semibold text-secondary">TRANSFER POSITION</span>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mono-label text-xs font-semibold text-secondary">TOKENS</span>
                <NumberInput
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  suffix="TOKENS"
                  error={amount.length > 0 && !Number.isFinite(n) ? "Numbers only." : null}
                  className="mt-1.5"
                />
              </label>
              <label className="block">
                <span className="mono-label text-xs font-semibold text-secondary">TO</span>
                <select
                  value={target ?? ""}
                  onChange={(e) => setToId(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-purple-500/20 bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                >
                  {recipients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.role})
                    </option>
                  ))}
                </select>
              </label>
              {errors.length > 0 && (
                <ul className="space-y-1">
                  {errors.map((e) => (
                    <li key={e} className="text-sm font-medium text-danger">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
              <Button onClick={transfer} disabled={!valid} loading={busy} className="w-full">
                Transfer shares
              </Button>
              <p className="mono-label text-xs text-secondary">
                EARNINGS SNAPSHOT BY TRANSFER HOOK · <span className="opacity-70">transfer_hook</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm font-medium text-amber-900">
              Transfer requires a backer position. Acting as {persona.label} ({persona.role}).
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {scenario.personas
                .filter((p) => p.role === "backer")
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setAs(p.id)}
                    className="mono-label rounded-full border border-amber-500/40 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-500/20"
                  >
                    ACT AS {p.label.toUpperCase()} (2)
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Freeze / unfreeze list */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-surface-inset p-3.5">
          <span className="mono-label text-xs font-semibold text-secondary">COMPLIANCE — FREEZE / UNFREEZE</span>
          {!isAdmin && (
            <p className="mt-2 text-sm font-medium text-amber-900">
              Freeze requires the compliance admin. Acting as {persona.label} ({persona.role}).
            </p>
          )}
          <ul className="mt-3 space-y-1.5">
            {state.holders.map((h) => {
              const frozen = h.claim.frozen;
              return (
                <li key={h.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-surface px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-primary">{h.label}</p>
                    <p className="mono-label text-xs text-secondary">{fmtShares(h.balance)} TOKENS</p>
                  </div>
                  <Button
                    onClick={() => freezeToggle(h.id, frozen)}
                    disabled={!isAdmin || busy}
                    loading={busy}
                    variant="secondary"
                    size="sm"
                    className={frozen ? "border-mint-700/40 text-healthy" : "border-red-500/40 text-danger"}
                  >
                    {frozen ? "UNFREEZE" : "FREEZE"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </PanelShell>
  );
}
