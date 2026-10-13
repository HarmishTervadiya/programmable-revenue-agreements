import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/input";
import {
  fmtShares,
  fmtTokens,
  fmtUsd,
  useProtocol,
  useProtocolSnapshot,
  type AgreementState,
  type DemoScenario,
  type Persona,
} from "@/protocol";
import { useUi } from "@/state/ui";
import { PanelShell } from "./CreatePanel";
import { guardSubmit, parseNum, tokens, txBusy, usdc } from "./util";

/**
 * Step 02 — buy shares. Fixed supply at a fixed price: tokens in, USDC to
 * the creator. Presets walk the worked example's four backers.
 */
export function BuyPanel({
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
  const [amount, setAmount] = useState("300");
  const [submitting, setSubmitting] = useState(false);

  if (!state || !persona) return null;

  const n = parseNum(amount);
  const amountB = tokens(n);
  const cost = (amountB * state.sharePrice) / 1_000_000n;
  const balance = state.usdc[persona.id] ?? 0n;
  const holder = state.holders.find((h) => h.id === persona.id);

  const errors: string[] = [];
  if (!Number.isFinite(n) || n <= 0) errors.push("Enter a number of tokens above 0.");
  if (amountB > state.treasury) errors.push(`Only ${fmtTokens(state.treasury)} tokens remain unsold.`);
  if (cost > balance) errors.push(`${persona.label} needs ${fmtUsd(cost)} — holds ${fmtUsd(balance)}.`);
  if (holder?.claim.frozen) errors.push("This position is frozen by the compliance admin.");
  if (state.status !== "active") errors.push("The agreement is no longer active.");

  const busy = txBusy(tx) || submitting;
  const valid = errors.length === 0;

  const buy = () => {
    if (!valid || busy) return;
    setSubmitting(true);
    void guardSubmit(() =>
      client.submit({
        ix: "purchase_share",
        buyerId: persona.id,
        buyerLabel: persona.label,
        amount: amountB,
      }),
    ).finally(() => setSubmitting(false));
  };

  const backer = persona.role === "backer";

  return (
    <PanelShell title="Buy shares" hint="Fixed supply, fixed price — USDC goes to the creator.">
      {!backer && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm font-medium text-amber-900">
            Acting as {persona.label} ({persona.role}). Buyers are backers —
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

      <div className="space-y-4">
        <label className="block">
          <span className="mono-label text-xs font-semibold text-secondary">TOKENS TO BUY</span>
          <NumberInput
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            suffix="TOKENS"
            error={amount.length > 0 && !Number.isFinite(n) ? "Numbers only." : null}
            className="mt-1.5"
          />
        </label>

        {scenario.buys.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {scenario.buys.map((b) => (
              <button
                key={b.persona.id}
                onClick={() => {
                  setAs(b.persona.id);
                  setAmount(String(Number(b.shares / 1_000_000n)));
                }}
                className="mono-label rounded-full border border-purple-500/20 bg-surface px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-accent hover:text-primary"
              >
                {b.persona.label.toUpperCase()} · {fmtShares(b.shares)}
              </button>
            ))}
            <button
              onClick={() => {
                const max = (balance * 1_000_000n) / (state.sharePrice || 1n);
                setAmount(String(Number(max > state.treasury ? state.treasury : max) / 1_000_000));
              }}
              className="mono-label rounded-full border border-purple-500/20 bg-surface px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-accent hover:text-primary"
            >
              MAX
            </button>
          </div>
        )}

        <dl className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-surface-inset p-3.5">
          <Row k="COST" v={fmtUsd(cost)} />
          <Row k={`${persona.label.toUpperCase()} HOLDS`} v={fmtUsd(balance)} />
          <Row k="UNSOLD TREASURY" v={`${fmtShares(state.treasury)} TOKENS`} />
          <Row k={`${persona.label.toUpperCase()}'S POSITION`} v={`${fmtShares(holder?.balance ?? 0n)} TOKENS`} />
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

        <Button onClick={buy} disabled={!valid} loading={busy} className="w-full">
          Sign purchase_share
        </Button>
      </div>
    </PanelShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="mono-label text-xs font-medium text-secondary">{k}</dt>
      <dd className="mono-data text-xs font-semibold text-primary tnum">{v}</dd>
    </div>
  );
}

export { usdc };
