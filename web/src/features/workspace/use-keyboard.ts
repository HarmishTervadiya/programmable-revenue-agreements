import { useEffect } from "react";
import type { Persona } from "@/protocol";
import { ROLE_ORDER, useUi } from "@/state/ui";

/**
 * Workspace shortcuts:
 *   ← / →      previous / next step
 *   1…4        act as creator / backer / depositor / admin
 *   D          toggle the event log (details)
 *   P          presentation mode (125% type)
 *   R          reset the demo
 *   ?          this help  (Esc closes)
 */
export function useWorkspaceKeys(
  personas: Persona[],
  onReset: () => void,
): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const ui = useUi.getState();
      switch (e.key) {
        case "ArrowRight":
          ui.nextStep();
          break;
        case "ArrowLeft":
          ui.prevStep();
          break;
        case "1":
        case "2":
        case "3":
        case "4": {
          const role = ROLE_ORDER[Number(e.key) - 1];
          const persona = personas.find((p) => p.role === role);
          if (persona) ui.setAs(persona.id);
          break;
        }
        case "d":
        case "D":
          ui.toggleLog();
          break;
        case "p":
        case "P":
          ui.setPresentation(!ui.presentation);
          break;
        case "r":
        case "R":
          onReset();
          break;
        case "?":
          ui.toggleHelp();
          break;
        case "Escape":
          if (ui.help) ui.toggleHelp();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [personas, onReset]);
}
