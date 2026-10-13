import { Button } from "@/components/ui/button";
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

  if (step === "create") {
    return <CreatePanel scenario={scenario} creator={persona} clock={clock} />;
  }

  // No agreement yet → every other step points back at step 01.
  if (!state) {
    return (
      <PanelShell title={`${def.n} · ${def.label}`} hint={def.hint}>
        <p className="text-sm text-secondary">Create the agreement first — this step needs it.</p>
        <Button variant="secondary" onClick={() => setStep("create")} className="mt-4 w-full">
          ← Go to step 01
        </Button>
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
