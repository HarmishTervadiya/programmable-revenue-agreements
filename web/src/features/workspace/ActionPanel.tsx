import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import { RequireWallet } from "@/components/ui/wallet-button";
import { useProtocol } from "@/protocol";
import { DevnetClient } from "@/protocol/devnetClient";
import type { AgreementState, DemoScenario, Persona } from "@/protocol";
import { stepDef, useUi, type StepId } from "@/state/ui";
import { CreatePanel, PanelShell } from "./steps/CreatePanel";
import { BuyPanel } from "./steps/BuyPanel";
import { DepositPanel } from "./steps/DepositPanel";
import { ClaimPanel } from "./steps/ClaimPanel";
import { TransferPanel } from "./steps/TransferPanel";
import { WindDownPanel } from "./steps/WindDownPanel";

/**
 * Right panel: the one action the current step is for.
 * On devnet the connected wallet is the identity; when disconnected every
 * action panel shows the wallet gate instead of a dead form.
 */
export function ActionPanel({
  step,
  scenario,
  state,
  persona,
  clock,
}: {
  step: StepId;
  scenario: DemoScenario;
  state: AgreementState | null;
  persona: Persona | null;
  clock: number;
}) {
  const setStep = useUi((s) => s.setStep);
  const def = stepDef(step);
  const client = useProtocol();
  const { connected } = useWallet();
  const needsWallet = client instanceof DevnetClient && !connected;

  if (step === "create") {
    if (needsWallet) {
      return (
        <PanelShell title="Create the deal" hint={def.hint}>
          <RequireWallet />
        </PanelShell>
      );
    }
    return <CreatePanel scenario={scenario} creator={persona} clock={clock} />;
  }

  // No agreement yet → every other step points back at step 01.
  if (!state) {
    return (
      <PanelShell title={`${def.n} · ${def.label}`} hint={def.hint}>
        {needsWallet ? (
          <RequireWallet />
        ) : (
          <>
            <p className="text-sm text-secondary">
              {client instanceof DevnetClient
                ? "Select an agreement above, or create one to get started."
                : "Create the agreement first — this step needs it."}
            </p>
            <Button variant="secondary" onClick={() => setStep("create")} className="mt-4 w-full">
              ← Go to step 01
            </Button>
          </>
        )}
      </PanelShell>
    );
  }

  if (needsWallet) {
    return (
      <PanelShell title={`${def.n} · ${def.label}`} hint={def.hint}>
        <RequireWallet />
      </PanelShell>
    );
  }

  switch (step) {
    case "buy":
      return <BuyPanel scenario={scenario} state={state} persona={persona} />;
    case "deposit":
      return <DepositPanel scenario={scenario} state={state} persona={persona} />;
    case "claim":
      return <ClaimPanel state={state} persona={persona} />;
    case "transfer":
      return <TransferPanel scenario={scenario} state={state} persona={persona} />;
    case "wind-down":
      return <WindDownPanel state={state} clock={clock} />;
  }
}
