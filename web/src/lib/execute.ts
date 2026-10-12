import { useJourney } from "@/state/journey";
import { useSim } from "@/state/sim";
import type { CreateSimInput, SimError } from "@/lib/sim/simulator";
import { humanizeError, errorName } from "@/lib/program/errors";
import { toastError, toastTx } from "@/components/ui/toast";

/**
 * One call surface for every instruction. Demo Mode executes against the
 * in-memory simulator; live mode targets devnet via the Anchor client
 * (Phase 6). Screens only ever call this.
 */
export interface ExecuteResult {
  signature: string;
  replay?: () => void;
}

export function useExecute() {
  const demoMode = useJourney((s) => s.demoMode);
  const sim = useSim();

  /** Wrap a sim call: toast success/error, surface program error copy. */
  function wrap<T>(label: string, fn: () => T): T {
    try {
      const out = fn();
      const sig = useSim.getState().lastSignature;
      if (sig) toastTx(`${label} — confirmed`, sig);
      return out;
    } catch (err) {
      const human = humanizeError(err);
      toastError(human.message + (human.fix ? ` ${human.fix}` : ""));
      throw err;
    }
  }

  return {
    mode: demoMode ? ("demo" as const) : ("live" as const),

    createAgreement(input: CreateSimInput, creator: string) {
      if (!demoMode) return liveNotReady("initialize_agreement");
      return wrap("Created agreement", () => sim.create(input, creator));
    },

    purchase(buyerId: string, label: string, amount: bigint) {
      if (!demoMode) return liveNotReady("purchase_share");
      return wrap("Purchase confirmed", () => sim.buy(buyerId, label, amount));
    },

    deposit(depositorId: string, amount: bigint) {
      if (!demoMode) return liveNotReady("deposit_revenue");
      return wrap("Revenue deposited", () => sim.depositRevenue(depositorId, amount));
    },

    claim(holderId: string): bigint {
      if (!demoMode) return liveNotReady("claim_tier_share");
      return wrap("Claimed", () => sim.claim(holderId));
    },

    transfer(fromId: string, fromLabel: string, toId: string, toLabel: string, amount: bigint) {
      if (!demoMode) return liveNotReady("transfer");
      return wrap("Transfer settled", () => sim.transfer(fromId, fromLabel, toId, toLabel, amount));
    },

    freeze(holderId: string) {
      if (!demoMode) return liveNotReady("freeze_position");
      return wrap("Position frozen", () => sim.freeze(holderId));
    },

    unfreeze(holderId: string) {
      if (!demoMode) return liveNotReady("unfreeze_position");
      return wrap("Position unfrozen", () => sim.unfreeze(holderId));
    },

    expire(): bigint {
      if (!demoMode) return liveNotReady("expire_agreement");
      return wrap("Agreement expired", () => sim.doExpire());
    },

    close() {
      if (!demoMode) return liveNotReady("close_agreement");
      return wrap("Agreement closed", () => sim.doClose());
    },

    isSimError: (err: unknown): err is SimError =>
      (err as { name?: string })?.name === "SimError",
    errorCode: (err: unknown) => errorName(err),
  };
}

function liveNotReady(ix: string): never {
  const err = new Error(`Live mode not wired yet for ${ix}`);
  toastError(`Live mode runs against devnet in Phase 6 — ${ix} not sent yet.`);
  throw err;
}
