import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWorld } from "@/app/providers";
import { Eyebrow } from "@/components/ui/chip";
import { Lockup } from "@/components/ui/logo";
import { ToastHost, toastError, toastTx } from "@/components/ui/toast";
import { TxDrawer, type TxStage } from "@/components/ui/tx-drawer";
import { cn } from "@/lib/cn";
import {
  canClose,
  canExpire,
  claimableFor,
  partyClaimable,
  scenarioById,
  useProtocol,
  useProtocolSnapshot,
  type DemoScenario,
} from "@/protocol";
import { stepDef, stepIndex, useUi, type StepId } from "@/state/ui";
import { ActionPanel } from "./ActionPanel";
import { DealBoard } from "./DealBoard";
import { EventLog } from "./EventLog";
import { Rail } from "./Rail";
import { HelpOverlay } from "./HelpOverlay";
import { useWorkspaceKeys } from "./use-keyboard";
import { useUrlSync } from "./use-url-sync";

const STEP_FLOW: StepId[] = ["create", "buy", "deposit", "claim", "transfer", "wind-down"];

const tokens = (n: number): bigint => BigInt(n) * 1_000_000n;

function stageFor(phase: string): TxStage {
  switch (phase) {
    case "building":
      return "Build";
    case "awaiting-signature":
      return "Sign";
    case "confirmed":
      return "Finalized";
    default:
      return "Confirm";
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Autoplay: run the scripted actions for the current step, dwell, advance.
 * Stops on error (with a toast) or at the end of the wind-down step.
 */
async function runStep(
  client: ReturnType<typeof useProtocol>,
  scenario: DemoScenario,
  step: StepId,
): Promise<void> {
  const personas = scenario.personas;
  switch (step) {
    case "create": {
      const s = await client.getState();
      if (s) return;
      const creator = personas.find((p) => p.role === "creator") ?? personas[0];
      await client.submit({
        ix: "initialize_agreement",
        creator: creator.address,
        input: scenario.createInput(await client.now()),
      });
      return;
    }
    case "buy": {
      for (const b of scenario.buys) {
        const s = await client.getState();
        if (!s || s.status !== "active") return;
        if (s.treasury < b.shares) continue;
        const holder = s.holders.find((h) => h.id === b.persona.id);
        if (holder && holder.balance >= b.shares) continue;
        await client.submit({
          ix: "purchase_share",
          buyerId: b.persona.id,
          buyerLabel: b.persona.label,
          amount: b.shares,
        });
      }
      return;
    }
    case "deposit": {
      for (const amount of scenario.deposits) {
        const s = await client.getState();
        if (!s || s.status !== "active") return;
        const depositor = s.depositor;
        const bal = s.usdc[depositor] ?? 0n;
        if (bal < amount) continue;
        await client.submit({ ix: "deposit_revenue", depositorId: depositor, amount });
      }
      return;
    }
    case "claim": {
      const s0 = await client.getState();
      if (!s0) return;
      for (const h of s0.holders) {
        const s = await client.getState();
        if (!s) return;
        if (claimableFor(s, h.id) > 0n) {
          await client.submit({ ix: "claim_tier_share", holderId: h.id });
        }
      }
      const s = await client.getState();
      if (s && partyClaimable(s, s.creator) > 0n) {
        await client.submit({ ix: "claim_party_share", partyId: s.creator });
      }
      return;
    }
    case "transfer": {
      const s = await client.getState();
      if (!s) return;
      const holders = s.holders.filter((h) => h.balance >= tokens(25));
      const receivers = personas.filter((p) => !s.holders.some((h) => h.id === p.id));
      if (holders.length > 0 && receivers.length > 0) {
        const from = holders[0];
        const to = receivers[0];
        await client.submit({
          ix: "transfer_hook",
          fromId: from.id,
          fromLabel: from.label,
          toId: to.id,
          toLabel: to.label,
          amount: tokens(25),
        });
      }
      // Freeze then unfreeze a holder so the rail shows the action.
      if (holders.length > 0) {
        const h = holders[0];
        const s1 = await client.getState();
        const held = s1?.holders.find((x) => x.id === h.id);
        if (held && !held.claim.frozen) await client.submit({ ix: "freeze_position", holderId: h.id });
        const s2 = await client.getState();
        const held2 = s2?.holders.find((x) => x.id === h.id);
        if (held2?.claim.frozen) await client.submit({ ix: "unfreeze_position", holderId: h.id });
      }
      return;
    }
    case "wind-down": {
      let s = await client.getState();
      if (!s) return;
      const now0 = await client.now();
      if (s.expTime !== null && now0 < s.expTime) {
        await client.advanceDays(Math.ceil((s.expTime - now0) / 86_400) + 1);
      }
      s = await client.getState();
      if (s && s.status === "active" && canExpire(s, await client.now())) {
        await client.submit({ ix: "expire_agreement" });
      }
      s = await client.getState();
      if (s && s.status === "expired" && s.claimDeadline !== null) {
        const now1 = await client.now();
        if (now1 < s.claimDeadline) {
          await client.advanceDays(Math.ceil((s.claimDeadline - now1) / 86_400) + 1);
        }
      }
      s = await client.getState();
      if (s && s.status === "expired") {
        const gate = canClose(s, await client.now());
        if (gate.ok) await client.submit({ ix: "close_agreement" });
      }
      return;
    }
  }
}

/**
 * The workspace (`/a/demo/run?scenario=&as=&step=`): left rail (steps +
 * personas), center deal board, right action panel + event log. One client,
 * one snapshot, keyboard-first.
 */
export function Workspace() {
  useWorld("light");
  useUrlSync();

  const client = useProtocol();
  const { state, log, clock, tx } = useProtocolSnapshot();

  const scenarioId = useUi((s) => s.scenario);
  const step = useUi((s) => s.step);
  const explicitAs = useUi((s) => s.as);
  const help = useUi((s) => s.help);
  const logOpen = useUi((s) => s.logOpen);
  const presentation = useUi((s) => s.presentation);
  const autoplay = useUi((s) => s.autoplay);
  const setStep = useUi((s) => s.setStep);

  const scenario = scenarioById(scenarioId);
  const personas = scenario.personas;
  const resolvedAs =
    explicitAs && personas.some((p) => p.id === explicitAs)
      ? explicitAs
      : (personas.find((p) => p.role === stepDef(step).role) ?? personas[0])?.id ?? null;
  const persona = personas.find((p) => p.id === resolvedAs) ?? null;

  // Fresh demo on entering the workspace (and whenever the scenario flips).
  useEffect(() => {
    void client.reset(personas);
  }, [client, personas]);

  const onReset = useCallback(() => {
    void client.reset(personas);
    setStep("create");
  }, [client, personas, setStep]);

  useWorkspaceKeys(personas, onReset);

  // — Clock controls ————————————————————————————————
  const onAdvanceDays = useCallback((days: number) => {
    if (days > 0) void client.advanceDays(days);
  }, [client]);

  const daysToExpiry =
    state?.expTime !== null && state?.expTime !== undefined && state.status === "active"
      ? Math.max(0, Math.ceil((state.expTime - clock) / 86_400))
      : null;

  // — Autoplay ————————————————————————————————————————
  useEffect(() => {
    if (!autoplay) return;
    let cancelled = false;
    const run = async () => {
      try {
        while (!cancelled) {
          const s = useUi.getState().step;
          await runStep(client, scenario, s);
          await sleep(2000); // dwell: stop after each phase
          if (cancelled) return;
          if (s === "wind-down") {
            useUi.getState().setAutoplay(false);
            return;
          }
          useUi.getState().nextStep();
          await sleep(400);
        }
      } catch (err) {
        toastError(err instanceof Error ? err.message : String(err));
        useUi.getState().setAutoplay(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [autoplay, client, scenario]);

  // — Transaction drawer ————————————————————————————————
  const [drawerOpen, setDrawerOpen] = useState(false);
  const seenRef = useRef("");
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!tx) return;
    const key = `${tx.signature}:${tx.phase}`;
    if (seenRef.current === key) return;
    seenRef.current = key;

    if (tx.phase === "confirmed") {
      // Mock signatures are fake base58 — only link to the explorer on devnet.
      toastTx(`${tx.title} confirmed`, tx.signature, client.mode === "devnet");
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => setDrawerOpen(false), 1600);
    } else if (tx.phase === "failed") {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => setDrawerOpen(false), 2400);
      setDrawerOpen(true);
    } else if (tx.phase !== "idle") {
      window.clearTimeout(closeTimer.current);
      setDrawerOpen(true);
    }
  }, [tx, client.mode]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const def = stepDef(step);
  const current = stepIndex(step);

  return (
    <div className="theme-light min-h-screen bg-[var(--bg-page)] text-primary">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-page)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link to="/a/demo" aria-label="Back to scenarios">
              <Lockup />
            </Link>
            <span className="hidden h-5 w-px bg-purple-500/20 md:block" aria-hidden />
            <Eyebrow n={def.n} label={`STEP — ${def.label.toUpperCase()}`} className="hidden md:flex" />
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => useUi.getState().setPresentation(!presentation)}
              aria-pressed={presentation}
              title="Presentation mode (P)"
              className="mono-label flex h-8 items-center gap-1.5 rounded-full border border-purple-500/25 px-3 text-xs font-semibold text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              Aa
            </button>
            <button
              onClick={() => useUi.getState().toggleHelp()}
              title="Keyboard shortcuts (?)"
              className="mono-label flex h-8 w-8 items-center justify-center rounded-full border border-purple-500/25 text-xs font-semibold text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              ?
            </button>
            <span className="mono-label rounded-full border border-purple-500/15 bg-surface px-3 py-1.5 text-xs font-semibold text-secondary">
              {client.mode === "mock" ? "MOCK" : "DEVNET"}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1600px] items-start gap-5 px-4 pb-16 pt-5 md:px-6 lg:grid-cols-[236px_minmax(0,1fr)_340px]">
        {/* Left rail (desktop) */}
        <aside className="sticky top-20 hidden lg:block">
          <Rail
            personas={personas}
            resolvedAs={resolvedAs}
            clock={clock}
            mode={client.mode}
            onReset={onReset}
            onAdvanceDays={onAdvanceDays}
            daysToExpiry={daysToExpiry}
          />
        </aside>

        {/* Mobile strips */}
        <div className="-mx-4 overflow-x-auto border-b border-[var(--border-subtle)] bg-surface px-4 py-3 lg:hidden">
          <div className="flex w-max gap-2">
            {STEP_FLOW.map((id, i) => (
              <button
                key={id}
                onClick={() => setStep(id)}
                className={cn(
                  "mono-label inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold transition-colors",
                  i === current
                    ? "bg-accent text-white"
                    : i < current
                      ? "bg-purple-100 text-primary"
                      : "bg-purple-50/70 text-secondary",
                )}
              >
                {stepDef(id).n} {stepDef(id).label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex w-max gap-2">
            {personas.map((p) => (
              <button
                key={p.id}
                onClick={() => useUi.getState().setAs(p.id)}
                className={cn(
                  "mono-label inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold transition-colors",
                  p.id === resolvedAs
                    ? "bg-accent text-white"
                    : "border border-[var(--border-subtle)] bg-surface text-secondary",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Center board */}
        <main className="min-w-0">
          <DealBoard a={state} resolvedAs={resolvedAs} />
        </main>

        {/* Right panel: action + event log */}
        <aside className="min-w-0 space-y-4">
          <ActionPanel step={step} scenario={scenario} state={state} persona={persona} clock={clock} />
          <div className="flex items-center justify-between">
            <button
              onClick={() => useUi.getState().toggleLog()}
              aria-expanded={logOpen}
              className="mono-label text-xs font-semibold text-secondary transition-colors hover:text-primary"
            >
              {logOpen ? "▾" : "▸"} EVENT LOG <span className="text-secondary/80">({log.length}) · D</span>
            </button>
            <span className="mono-label text-xs text-secondary/80">← → STEPS</span>
          </div>
          {logOpen && <EventLog log={log} />}
        </aside>
      </div>

      <TxDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={tx?.title ?? "Transaction"}
        stage={tx ? stageFor(tx.phase) : null}
        checklist={tx?.checklist}
        signature={tx?.signature}
        computeUnits={tx?.computeUnits}
        logs={tx?.logs}
      />

      {help && <HelpOverlay />}
      <ToastHost />
    </div>
  );
}
