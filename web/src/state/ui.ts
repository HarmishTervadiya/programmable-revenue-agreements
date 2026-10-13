import { create } from "zustand";
import { persist } from "zustand/middleware";
import { bigintSafeStorage } from "@/lib/persist";
import type { Persona, Role } from "@/protocol";

export type ScenarioId = "prince" | "custom";
export type StepId = "create" | "buy" | "deposit" | "claim" | "transfer" | "wind-down";

export interface StepDef {
  id: StepId;
  n: string;
  label: string;
  /** Persona role auto-selected when navigating to this step. */
  role: Role;
  /** One line shown in the action panel header. */
  hint: string;
}

export const STEPS: StepDef[] = [
  {
    id: "create",
    n: "01",
    label: "Create agreement",
    role: "creator",
    hint: "Name it, price it, split it — one instruction mints the instrument.",
  },
  {
    id: "buy",
    n: "02",
    label: "Buy shares",
    role: "backer",
    hint: "Backers buy fixed supply at the share price. USDC in, tokens out.",
  },
  {
    id: "deposit",
    n: "03",
    label: "Deposit revenue",
    role: "depositor",
    hint: "One deposit, routed through the tier waterfall to every claimant.",
  },
  {
    id: "claim",
    n: "04",
    label: "Claim earnings",
    role: "backer",
    hint: "Holders and the revenue party pull their accrued slice from the vault.",
  },
  {
    id: "transfer",
    n: "05",
    label: "Transfer + freeze",
    role: "backer",
    hint: "The hook follows the tokens: balances move, earnings split at the seam.",
  },
  {
    id: "wind-down",
    n: "06",
    label: "Expire + close",
    role: "creator",
    hint: "Expire at the cap or the date, drain the claim window, close the account.",
  },
];

export const STEP_IDS: StepId[] = STEPS.map((s) => s.id);

/** Persona roles in the 1-4 hotkey order. */
export const ROLE_ORDER: Role[] = ["creator", "backer", "depositor", "admin"];

export function isStepId(v: unknown): v is StepId {
  return typeof v === "string" && (STEP_IDS as string[]).includes(v);
}

export function isScenarioId(v: unknown): v is ScenarioId {
  return v === "prince" || v === "custom";
}

export function stepIndex(step: StepId): number {
  return STEP_IDS.indexOf(step);
}

export function stepDef(step: StepId): StepDef {
  return STEPS[stepIndex(step)] ?? STEPS[0];
}

/**
 * Which persona the demo acts as: an explicit pick, else the step's default
 * role, else the first persona. Explicit picks clear on step navigation so
 * each step starts as the persona that runs it.
 */
export function resolvePersonaId(
  as: string | null,
  personas: Persona[],
  step: StepId,
): string | null {
  if (personas.length === 0) return null;
  if (as && personas.some((p) => p.id === as)) return as;
  const role = stepDef(step).role;
  const byRole = personas.find((p) => p.role === role);
  return (byRole ?? personas[0]).id;
}

export function personaById(personas: Persona[], id: string | null): Persona | null {
  if (!id) return null;
  return personas.find((p) => p.id === id) ?? null;
}

interface UiState {
  scenario: ScenarioId;
  /** Explicit persona id, or null = auto (step default role). */
  as: string | null;
  step: StepId;
  presentation: boolean;
  autoplay: boolean;
  help: boolean;
  /** Right-panel event log visibility (D). */
  logOpen: boolean;

  setScenario: (s: ScenarioId) => void;
  setAs: (id: string | null) => void;
  /** Navigating steps clears the manual persona pick (auto-role per step). */
  setStep: (s: StepId) => void;
  nextStep: () => void;
  prevStep: () => void;
  setPresentation: (v: boolean) => void;
  setAutoplay: (v: boolean) => void;
  toggleHelp: () => void;
  toggleLog: () => void;
}

type PersistedUi = Pick<UiState, "presentation">;

const clampStep = (i: number): StepId =>
  STEP_IDS[Math.max(0, Math.min(STEP_IDS.length - 1, i))];

export const useUi = create<UiState>()(
  persist<UiState, [], [], PersistedUi>(
    (set, get) => ({
      scenario: "prince",
      as: null,
      step: "create",
      presentation: false,
      autoplay: false,
      help: false,
      logOpen: true,

      setScenario: (scenario) => set({ scenario, as: null, step: "create" }),
      setAs: (as) => set({ as }),
      setStep: (step) => set({ step, as: null }),
      nextStep: () => set({ step: clampStep(stepIndex(get().step) + 1), as: null }),
      prevStep: () => set({ step: clampStep(stepIndex(get().step) - 1), as: null }),
      setPresentation: (presentation) => set({ presentation }),
      setAutoplay: (autoplay) => set({ autoplay }),
      toggleHelp: () => set((s) => ({ help: !s.help })),
      toggleLog: () => set((s) => ({ logOpen: !s.logOpen })),
    }),
    {
      name: "pra-demo-ui",
      version: 1,
      storage: bigintSafeStorage<PersistedUi>("pra-demo-ui"),
      partialize: (s) => ({ presentation: s.presentation }),
    },
  ),
);
