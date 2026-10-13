/** 6-decimal base units → display string, 2 decimals default. */
export function fmtUsdc(baseUnits: bigint, decimals = 2): string {
  const neg = baseUnits < 0n;
  const abs = neg ? -baseUnits : baseUnits;
  const whole = abs / 1_000_000n;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (decimals <= 0) return `${neg ? "−" : ""}${grouped}`;
  const frac = abs % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").slice(0, decimals);
  return `${neg ? "−" : ""}${grouped}.${fracStr}`;
}

export function fmtUsdcFull(baseUnits: bigint): string {
  return fmtUsdc(baseUnits, 6);
}

export function fmtTokens(baseUnits: bigint): string {
  return fmtUsdc(baseUnits, 2).replace(/\.00$/, "");
}

export function fmtCompact(n: bigint): string {
  const num = Number(n);
  if (!Number.isSafeInteger(num)) return `${fmtUsdc(n, 0)} (exact)`;
  return new Intl.NumberFormat("en-US").format(num);
}

export function truncAddress(address: string): string {
  if (address.length <= 9) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(1).replace(/\.0$/, "")}%`;
}

export function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtCountdown(targetTs: number, nowTs: number): string {
  const s = Math.max(0, targetTs - nowTs);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
