import { useEffect } from "react";
import { useJourney } from "@/state/journey";
import { useSim, workedExampleInput } from "@/state/sim";

/**
 * Demo-Mode actors. One presenter walks all five by switching roles,
 * so ids must be stable strings the simulator recognises.
 */
export const ACTORS = {
  creator: { id: "CREATOR", label: "Creator" },
  buyer: { id: "BUYER", label: "You" },
  depositor: { id: "DEPOSITOR", label: "Depositor" },
  admin: { id: "ADMIN", label: "Compliance Admin" },
} as const;

/** Seed the worked example if Demo Mode opens an empty agreement. */
export function useEnsureAgreement(): void {
  const demo = useJourney((s) => s.demoMode);
  const has = useSim((s) => s.agreement !== null);
  useEffect(() => {
    if (demo && !has) useSim.getState().create(workedExampleInput(), ACTORS.creator.id);
  }, [demo, has]);
}

/** The active holder for the "holder" role: prefer your own BUYER position. */
export function activeHolderId(holderIds: string[]): string | null {
  if (holderIds.length === 0) return null;
  return holderIds.includes(ACTORS.buyer.id) ? ACTORS.buyer.id : holderIds[0];
}
