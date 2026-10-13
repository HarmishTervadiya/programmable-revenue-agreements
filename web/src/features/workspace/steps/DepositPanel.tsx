import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/input";
import {
  fmtUsd,
  fmtUsdWhole,
  previewDeposit,
  useProtocol,
  useProtocolSnapshot,
  type AgreementState,
  type DemoScenario,
  type Persona,
} from "@/protocol";
import { useUi } from "@/state/ui";
import { PanelShell } from "./CreatePanel";
import { guardSubmit, parseNum, txBusy, usdc } from "./util";

/**
 * Step 03 — deposit revenue. Only the agreement's designated depositor can
 * route funds; the panel shows exactly which tier slice each dollar fills.
 */
export function DepositPanel({
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
  const [amount, setAmount] = useState(() =>
    scenario.deposits[0] ? String(Number(scenario.deposits[0] / 1_000_000n)) : "4000",
  );
  const [submitting, setSubmitting] = useState(false);

  if (!state || !persona) return null;

  const n = parseNum(amount);
  const amountB = usdc(n);
  const isDepositor = persona.address === state.depositor;
  const balance = state.usdc[persona.id] ?? 0n;
  const preview = previewDeposit(state, amountB);

  const errors: string[] = [];
  if (!Number.isFinite(n) || n <= 0) errors.push("Enter a USDC amount above 0.");
  if (amountB > balance) errors.push(`${persona.label} needs ${fmtUsd(amountB)} — holds ${fmtUsd(balance)}.`);
  if (state.status !== "active") errors.push("The agreement is no longer active — deposits are locked.");
  if (!isDepositor) errors.push(`Only the designated depositor (${state.depositor.slice(0, 8)}…) may deposit.`);

  const busy = txBusy(tx) || submitting;
  const valid = errors.length === 0;
  const depositorPersona = scenario.personas.find((p) => p.address === state.depositor) ?? null;

  const deposit = () => {
    if (!valid || busy) return;
    setSubmitting(true);
    void guardSubmit(() =>
      client.submit({ ix: "deposit_revenue", depositorId: persona.id, amount: amountB }),
    ).finally(() => setSubmitting(false));
  };

  return (
    <PanelShell
      title="Deposit revenue"
      hint="USDC in, tier waterfall routing it live. Only the depositor's wallet can call this."
    >
      {!isDepositor && depositorPersona && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm font-medium text-amber-900">
            Deposits must come from the agreement's depositor — {depositorPersona.label}.
          </p>
          <button
            onClick={() => setAs(depositorPersona.id)}
            className="mono-label mt-2 rounded-full border border-amber-500/40 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-500/20"
          >
            ACT AS {depositorPersona.label.toUpperCase()}
          </button>
        </div>
      )}

      <div className="space-y-4">
        <label className="block">
          <span className="mono-label text-xs font-semibold text-secondary">AMOUNT</span>
          <NumberInput
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            suffix="USDC"
            error={amount.length > 0 && !Number.isFinite(n) ? "Numbers only." : null}
            className="mt-1.5"
          />
        </label>

        {scenario.deposits.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {scenario.deposits.map((d) => (
              <button
                key={d.toString()}
                onClick={() => setAmount(String(Number(d / 1_000_000n)))}
                className="mono-label rounded-full border border-purple-500/20 bg-surface px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-accent hover:text-primary"
              >
                {fmtUsdWhole(d)}
              </button>
            ))}
          </div>
        )}

        {preview.length > 0 && amountB > 0n && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-surface-inset p-3.5">
            <span className="mono-label text-xs font-semibold text-secondary">WHERE THIS DEPOSIT LANDS</span>
            <ul className="mt-2.5 space-y-1.5">
              {preview.map((p) => (
                <li key={p.tierIndex} className="flex items-center justify-between gap-2 text-sm">
                  <span className="mono-label text-xs font-medium text-secondary">
                    TIER {p.tierIndex + 1} · {p.threshold === null ? "UNCAPPED" : fmtUsdWhole(p.threshold)}
                  </span>
                  <span className="mono-data text-xs font-semibold text-primary tnum">
                    {p.take > 0n ? `${fmtUsd(p.take)}  (H ${fmtUsd(p.holders)} / W ${fmtUsd(p.party)})` : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <dl className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-surface-inset p-3.5">
          <div className="flex items-center justify-between gap-2">
            <dt className="mono-label text-xs font-medium text-secondary">DEPOSITOR BALANCE</dt>
            <dd className="mono-data text-xs font-semibold text-primary tnum">{fmtUsd(balance)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="mono-label text-xs font-medium text-secondary">TOTAL DEPOSITED</dt>
            <dd className="mono-data text-xs font-semibold text-primary tnum">{fmtUsd(state.totalDeposited)}</dd>
          </div>
        </dl>

        {errors.length > 0 && (
          <ul className="space-y-1">
            {errors.map((e) => (
              <li key={e} className="text-sm font-medium text-danger">
                {e}
              </li>
            ))}
          </ul>
        )}

        <Button onClick={deposit} disabled={!valid} loading={busy} className="w-full">
          Sign deposit_revenue
        </Button>
      </div>
    </PanelShell>
  );
}
