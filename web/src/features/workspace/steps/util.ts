import { toastError } from "@/components/ui/toast";
import type { TxProgress } from "@/protocol";

/** True while a submitted instruction is still moving through its stages. */
export function txBusy(tx: TxProgress | null): boolean {
  if (!tx) return false;
  return tx.phase === "building" || tx.phase === "awaiting-signature" || tx.phase === "confirming";
}

/** Run a submit, surfacing the program's plain-sentence failure as a toast. */
export async function guardSubmit(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    toastError(err instanceof Error ? err.message : String(err));
  }
}

export const tokens = (n: number): bigint => BigInt(Math.round(n * 1_000_000));
export const usdc = (n: number): bigint => BigInt(Math.round(n * 1_000_000));

/** Parse a numeric input string to a finite number ("" → NaN). */
export function parseNum(s: string): number {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : Number.NaN;
}
