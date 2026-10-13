/**
 * Protocol-facing formatting. The low-level 6dp helpers live in lib/format
 * (shared with the on-chain maths tests); this adds display sugar the
 * workspace screens use everywhere.
 */
export {
  fmtUsdc,
  fmtUsdcFull,
  fmtTokens,
  fmtCompact,
  fmtBps,
  fmtTime,
  fmtCountdown,
  truncAddress,
} from "@/lib/format";

import { fmtUsdc, fmtTokens, truncAddress } from "@/lib/format";

/** $1,234.00 — the default way money appears in the deal board. */
export function fmtUsd(baseUnits: bigint, decimals = 2): string {
  return `$${fmtUsdc(baseUnits, decimals)}`;
}

/** No decimals, comma-grouped — thresholds on the waterfall. */
export function fmtUsdWhole(baseUnits: bigint): string {
  return `$${fmtUsdc(baseUnits, 0)}`;
}

/** Token count with unit: "300 SHR" style is left to callers; this is bare. */
export function fmtShares(baseUnits: bigint): string {
  return fmtTokens(baseUnits);
}

/** 10000 → "100%", 7000 → "70%" (bps, no decimal noise). */
export function fmtPct(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/** Split party for tables: wallet addresses shortened. */
export function fmtParty(party: { kind: "holders" } | { kind: "wallet"; address: string }): string {
  return party.kind === "holders" ? "Holders" : truncAddress(party.address);
}

/** Days → "3 years" / "30 days" / "12 hours". */
export function fmtDuration(seconds: number): string {
  const d = Math.round(seconds / 86_400);
  if (d >= 730) return `${Math.round(d / 365)} years`;
  if (d >= 365) return "1 year";
  if (d >= 2) return `${d} days`;
  if (d === 1) return "1 day";
  const h = Math.round(seconds / 3_600);
  if (h >= 1) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.max(1, Math.round(seconds / 60))} minutes`;
}
