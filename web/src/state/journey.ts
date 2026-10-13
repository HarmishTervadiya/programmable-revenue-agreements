import { create } from "zustand";

export type Role =
  | "creator"
  | "buyer"
  | "depositor"
  | "holder"
  | "admin";

export const ROLES: { id: Role; label: string }[] = [
  { id: "creator", label: "Creator" },
  { id: "buyer", label: "Buyer" },
  { id: "depositor", label: "Depositor" },
  { id: "holder", label: "Holder" },
  { id: "admin", label: "Compliance Admin" },
];

interface JourneyState {
  /** Demo Mode runs the journey against the in-memory simulator, no RPC. */
  demoMode: boolean;
  setDemoMode: (v: boolean) => void;
  /** Active role for the presenter (Demo Mode) / highlighted role (live). */
  role: Role;
  setRole: (r: Role) => void;
  /** Projector-friendly 125% type + reduced chrome. */
  presentation: boolean;
  setPresentation: (v: boolean) => void;
}

export const useJourney = create<JourneyState>((set) => ({
  demoMode: true,
  setDemoMode: (demoMode) => set({ demoMode }),
  role: "creator",
  setRole: (role) => set({ role }),
  presentation: false,
  setPresentation: (presentation) => set({ presentation }),
}));
