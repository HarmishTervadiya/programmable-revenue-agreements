import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const PROGRAM_ID = "2iEFwZ8qPjvEfSAtHqE7G7apQo9tVKFsiLrdAFC5sXop";
export const U64_MAX = (1n << 64n) - 1n;
export const DECIMALS = 6;
export const INIT_ARGS = [
  "agreement_id",
  "supply",
  "share_price",
  "access_mode",
  "tiers",
  "start_time",
  "exp_time",
  "end_cap",
  "claim_window",
  "depositor",
  "compliance_admin",
  "payment_destination",
];
export const INIT_ACCOUNTS = [
  "creator",
  "agreement_config",
  "share_mint",
  "payment_mint",
  "payment_destination",
  "vault",
  "treasury",
  "extra_metas",
  "tier0",
  "tier1",
  "tier2",
  "tier3",
  "tier4",
  "token_2022_program",
  "system_program",
  "token_program",
];
export const agreements = JSON.parse(
  readFileSync(new URL("./agreements.json", import.meta.url), "utf8"),
);
export function requireDemo(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
export function u64(value: string): bigint {
  requireDemo(
    typeof value === "string" && /^(0|[1-9]\d*)$/.test(value),
    "Expected canonical unsigned decimal integer string",
  );
  const n = BigInt(value);
  requireDemo(n <= U64_MAX, "Value exceeds u64");
  return n;
}
export function toBaseUnits(value: string): bigint {
  requireDemo(
    /^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value),
    "Amount must be nonnegative decimal text with at most six fractional digits",
  );
  const [whole, fraction = ""] = value.split(".");
  return u64(
    (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString(),
  );
}
export function formatUnits(value: bigint): string {
  return `${value / 1_000_000n}.${(value % 1_000_000n)
    .toString()
    .padStart(6, "0")}`;
}
export function assertLocalRpc(endpoint: string): void {
  const url = new URL(endpoint);
  requireDemo(
    url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    "Demo RPC must be a plain HTTP loopback URL; remote/public clusters are refused",
  );
}
export function assertLocalGenesis(genesis: string): void {
  requireDemo(
    ![
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    ].includes(genesis),
    "Public-cluster genesis refused even through a loopback proxy",
  );
}
export function deterministicSeed(label: string, offset: string): Uint8Array {
  u64(offset);
  return createHash("sha256")
    .update(`pra-local-demo:v1:${offset}:${label}`)
    .digest();
}
export function instruction(idl: any, name: string): any {
  return idl.instructions?.find((ix: any) => ix.name === name);
}
export function validateIdl(idl: any): void {
  requireDemo(
    idl.address === PROGRAM_ID,
    "IDL program address differs from this checkout",
  );
  const init = instruction(idl, "initialize_agreement");
  requireDemo(
    init,
    "initialize_agreement unavailable in IDL; build the current program/IDL",
  );
  requireDemo(
    JSON.stringify(init.args.map((a: any) => a.name)) ===
      JSON.stringify(INIT_ARGS),
    "Initialization argument mismatch; current claim_window ordering is required",
  );
  requireDemo(
    JSON.stringify(init.accounts.map((a: any) => a.name)) ===
      JSON.stringify(INIT_ACCOUNTS),
    "Initialization account mismatch; inspect/rebuild the current IDL",
  );
}
export function validatedSeeds(offset: string): any[] {
  const delta = u64(offset);
  return agreements.map((original: any) => {
    const s = structuredClone(original);
    s.agreementId = u64((u64(s.agreementId) + delta).toString()).toString();
    requireDemo(
      u64(s.supply) > 0n && u64(s.sharePrice) > 0n,
      "Supply and price must be positive",
    );
    requireDemo(
      s.expTime !== null || s.endCap !== null,
      "Expiry time or cap required",
    );
    for (const field of ["startTime", "expTime"])
      if (s[field] !== null)
        requireDemo(u64(s[field]) <= (1n << 63n) - 1n, "Timestamp exceeds i64");
    if (s.endCap !== null) u64(s.endCap);
    if (s.claimWindow !== null)
      requireDemo(u64(s.claimWindow) > 0n, "Claim window must be positive");
    requireDemo(
      s.accessMode === "open",
      "This seed kit supports Open examples only",
    );
    requireDemo(s.tiers.length >= 1 && s.tiers.length <= 5, "Need 1–5 tiers");
    let previous = -1n;
    for (const tier of s.tiers) {
      const threshold = u64(tier.threshold);
      requireDemo(threshold > previous, "Thresholds must increase");
      previous = threshold;
      requireDemo(
        tier.splits.length >= 1 &&
          tier.splits.length <= 4 &&
          tier.splits.every(
            (split: any) =>
              ["holders", "creator"].includes(split.party) &&
              Number.isInteger(split.bps) &&
              split.bps >= 0 &&
              split.bps <= 10000,
          ) &&
          tier.splits.reduce(
            (sum: number, split: any) => sum + split.bps,
            0,
          ) === 10000,
        "Invalid tier splits",
      );
    }
    requireDemo(previous === U64_MAX, "Final tier must be u64::MAX");
    return s;
  });
}
export function options(
  args: string[],
  allowed: string[],
  env: NodeJS.ProcessEnv = process.env,
): {
  execute: boolean;
  deposit: boolean;
  offset: string;
  amount: string;
  rpc: string;
} {
  requireDemo(
    args.every((arg) => allowed.includes(arg)),
    `Supported flags: ${allowed.join(" ")}`,
  );
  requireDemo(
    !(args.includes("--plan") && args.includes("--execute")),
    "Choose --plan or --execute",
  );
  const rpc = env.DEMO_RPC_URL ?? "http://127.0.0.1:8899";
  assertLocalRpc(rpc);
  const offset = env.DEMO_ID_OFFSET ?? "0";
  u64(offset);
  const amount = env.DEMO_MOCK_USDC ?? "1000.000000";
  toBaseUnits(amount);
  return {
    execute: args.includes("--execute"),
    deposit: args.includes("--deposit"),
    offset,
    amount,
    rpc,
  };
}
export function loadIdl(): any {
  let idl: any;
  try {
    idl = JSON.parse(
      readFileSync(
        new URL(
          "../../target/idl/programmable_revenue_agreement.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  } catch {
    throw new Error(
      "Current target/idl/programmable_revenue_agreement.json unavailable; run anchor build before execution/preview",
    );
  }
  validateIdl(idl);
  return idl;
}
export function initializationArgs(
  s: any,
  bn: (value: string) => any,
  creator: any,
  depositor: any,
  admin: any,
  destination: any,
): any[] {
  const optional = (value: string | null) =>
    value === null ? null : bn(value);
  return [
    bn(s.agreementId),
    bn(s.supply),
    bn(s.sharePrice),
    { open: {} },
    s.tiers.map((tier: any) => ({
      threshold: bn(tier.threshold),
      splits: tier.splits.map((split: any) => ({
        party:
          split.party === "holders" ? { holders: {} } : { wallet: [creator] },
        bps: split.bps,
      })),
    })),
    optional(s.startTime),
    optional(s.expTime),
    optional(s.endCap),
    optional(s.claimWindow),
    depositor,
    admin,
    destination,
  ];
}
