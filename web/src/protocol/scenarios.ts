import type { CreateInput, Persona } from "./types";
import { mockBase58 } from "./ids";

/** 6dp helpers local to scenario numbers. */
const usdc = (n: number): bigint => BigInt(n) * 1_000_000n;
const tokens = (n: number): bigint => BigInt(n) * 1_000_000n;
const days = (n: number): bigint => BigInt(n) * 86_400n;

export interface BuyPlan {
  persona: Persona;
  shares: bigint;
}

export interface DemoScenario {
  id: "prince" | "custom";
  name: string;
  blurb: string;
  personas: Persona[];
  /** Suggested purchases for the Buy step, in order. */
  buys: BuyPlan[];
  /** Suggested revenue deposits for the Deposit step, in order. */
  deposits: bigint[];
  createInput(now: number): CreateInput;
}

// — Prince's startup -------------------------------------------------------

export const PRINCE: Persona = {
  id: mockBase58("persona/prince"),
  label: "Prince",
  role: "creator",
  address: mockBase58("persona/prince"),
};
export const NATE: Persona = {
  id: mockBase58("persona/nate"),
  label: "Nate",
  role: "backer",
  address: mockBase58("persona/nate"),
};
export const GLACIER: Persona = {
  id: mockBase58("persona/glacier"),
  label: "Glacier",
  role: "backer",
  address: mockBase58("persona/glacier"),
};
export const ANDREIA: Persona = {
  id: mockBase58("persona/andreia"),
  label: "Andreia",
  role: "backer",
  address: mockBase58("persona/andreia"),
};
export const SHRINATH: Persona = {
  id: mockBase58("persona/shrinath"),
  label: "Shrinath",
  role: "backer",
  address: mockBase58("persona/shrinath"),
};
export const STUDIO: Persona = {
  id: mockBase58("persona/studio"),
  label: "Studio books",
  role: "depositor",
  address: mockBase58("persona/studio"),
};
export const AUDITOR: Persona = {
  id: mockBase58("persona/auditor"),
  label: "Auditor",
  role: "admin",
  address: mockBase58("persona/auditor"),
};

export const PRINCE_PERSONAS: Persona[] = [
  PRINCE,
  NATE,
  GLACIER,
  ANDREIA,
  SHRINATH,
  STUDIO,
  AUDITOR,
];

/** The demo agreement: 1,000 tokens at $10, tiers at 10k / 30k / uncapped. */
export function princeCreateInput(now: number): CreateInput {
  return {
    name: "Prince's startup",
    supply: tokens(1_000),
    sharePrice: usdc(10),
    tiers: [
      { threshold: usdc(10_000), splits: [{ kind: "holders", bps: 10_000 }] },
      {
        threshold: usdc(30_000),
        splits: [
          { kind: "holders", bps: 7_000 },
          { kind: "wallet", bps: 3_000, address: PRINCE.address },
        ],
      },
      {
        threshold: null,
        splits: [
          { kind: "holders", bps: 4_000 },
          { kind: "wallet", bps: 6_000, address: PRINCE.address },
        ],
      },
    ],
    expTime: now + 3 * 365 * 86_400, // 3 years
    endCap: null,
    claimWindow: days(30),
    startTime: null,
    depositor: STUDIO.address,
    complianceAdmin: AUDITOR.address,
  };
}

export const PRINCE_SCENARIO: DemoScenario = {
  id: "prince",
  name: "Prince's startup",
  blurb:
    "1,000 tokens at $10. Four backers, three revenue tiers, 3 years to expiry. The worked example, pre-loaded.",
  personas: PRINCE_PERSONAS,
  buys: [
    { persona: NATE, shares: tokens(300) },
    { persona: GLACIER, shares: tokens(250) },
    { persona: ANDREIA, shares: tokens(250) },
    { persona: SHRINATH, shares: tokens(200) },
  ],
  deposits: [usdc(4_000), usdc(20_000), usdc(25_000)],
  createInput: princeCreateInput,
};

// — Build your own ---------------------------------------------------------

export const CUSTOM_CREATOR: Persona = {
  id: mockBase58("persona/you"),
  label: "You",
  role: "creator",
  address: mockBase58("persona/you"),
};
export const CUSTOM_BACKER: Persona = {
  id: mockBase58("persona/alex"),
  label: "Alex",
  role: "backer",
  address: mockBase58("persona/alex"),
};
export const CUSTOM_DEPOSITOR: Persona = {
  id: mockBase58("persona/books"),
  label: "Books",
  role: "depositor",
  address: mockBase58("persona/books"),
};
export const CUSTOM_ADMIN: Persona = {
  id: mockBase58("persona/auditor2"),
  label: "Auditor",
  role: "admin",
  address: mockBase58("persona/auditor2"),
};

export const CUSTOM_PERSONAS: Persona[] = [
  CUSTOM_CREATOR,
  CUSTOM_BACKER,
  CUSTOM_DEPOSITOR,
  CUSTOM_ADMIN,
];

/** Sensible blank: one uncapped tier, 100% to holders, expiry in a year. */
export function customCreateInput(now: number): CreateInput {
  return {
    name: "",
    supply: tokens(1_000),
    sharePrice: usdc(10),
    tiers: [{ threshold: null, splits: [{ kind: "holders", bps: 10_000 }] }],
    expTime: now + 365 * 86_400,
    endCap: null,
    claimWindow: days(30),
    startTime: null,
    depositor: CUSTOM_DEPOSITOR.address,
    complianceAdmin: CUSTOM_ADMIN.address,
  };
}

export const CUSTOM_SCENARIO: DemoScenario = {
  id: "custom",
  name: "Build your own",
  blurb:
    "Name it, price it, split it. Rule names light up green while your terms stay valid.",
  personas: CUSTOM_PERSONAS,
  buys: [{ persona: CUSTOM_BACKER, shares: tokens(100) }],
  deposits: [usdc(2_000)],
  createInput: customCreateInput,
};

export const SCENARIOS: DemoScenario[] = [PRINCE_SCENARIO, CUSTOM_SCENARIO];

export function scenarioById(id: string | null): DemoScenario {
  return id === "custom" ? CUSTOM_SCENARIO : PRINCE_SCENARIO;
}
