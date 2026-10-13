import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  isScenarioId,
  isStepId,
  useUi,
} from "@/state/ui";

function parseSearch(search: string): { scenario?: string; as?: string; step?: string } {
  const p = new URLSearchParams(search);
  return {
    scenario: p.get("scenario") ?? undefined,
    as: p.get("as") ?? undefined,
    step: p.get("step") ?? undefined,
  };
}

/**
 * URL ⇄ store sync for `?scenario=&as=&step=`.
 *
 * - router location.search → store: fires on mount, link navigation, and
 *   back/forward (react-router tracks popstate itself).
 * - store → window: replaceState only, so stepping through the demo never
 *   spams history entries; the router never sees its own replace, so the two
 *   directions cannot loop.
 */
export function useUrlSync(): void {
  const location = useLocation();
  const scenario = useUi((s) => s.scenario);
  const as = useUi((s) => s.as);
  const step = useUi((s) => s.step);

  // URL → store
  useEffect(() => {
    const q = parseSearch(location.search);
    const ui = useUi.getState();
    const nextScenario = isScenarioId(q.scenario) ? q.scenario : "prince";
    const nextStep = isStepId(q.step) ? q.step : "create";
    const nextAs = q.as && q.as.length > 0 ? q.as : null;
    if (ui.scenario !== nextScenario || ui.step !== nextStep || ui.as !== nextAs) {
      ui.setScenario(nextScenario);
      useUi.setState({ step: nextStep, as: nextAs });
    }
    // Intentionally keyed on location.search only: later store edits are
    // written straight to the URL without round-tripping through the router.
  }, [location.search]);

  // store → URL
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("scenario", scenario);
    if (as) p.set("as", as);
    p.set("step", step);
    const next = `${window.location.pathname}?${p.toString()}`;
    if (window.location.search !== `?${p.toString()}`) {
      window.history.replaceState(null, "", next);
    }
  }, [scenario, as, step]);
}
