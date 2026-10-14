// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { Providers } from "@/app/providers";
import {
  PRINCE_PERSONAS,
  ProtocolProvider,
  createProtocolClient,
  princeCreateInput,
  claimableFor,
} from "@/protocol";
import { useToasts } from "@/components/ui/toast";
import { StartScreen } from "@/features/workspace/StartScreen";
import { Landing } from "@/features/landing/Landing";
import { Workspace } from "@/features/workspace/Workspace";
import type { ProtocolClient } from "@/protocol";

// jsdom lacks matchMedia
if (typeof window.matchMedia !== "function") {
  window.matchMedia = () =>
    ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function newClient(): ProtocolClient {
  return createProtocolClient("mock", { speed: 0, startTime: 1_700_000_000 });
}

async function mount(
  node: React.ReactNode,
  path: string,
  proto: ProtocolClient = newClient(),
): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  const target = container;
  // async act also flushes the provider's initial (promise) snapshot load.
  await act(async () => {
    root = createRoot(target);
    root.render(
      <Providers>
        <ProtocolProvider client={proto}>
          <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
        </ProtocolProvider>
      </Providers>,
    );
  });
  return target;
}

function activeStep(el: HTMLElement): string {
  const active = el.querySelector('[aria-current="step"]');
  return active?.textContent ?? "";
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  useToasts.setState({ toasts: [] });
});

describe("workspace shell", () => {
  it("landing explains the product with wallet-only sign-in", async () => {
    const el = await mount(<Landing />, "/");
    expect(el.textContent).toContain("Revenue deals that");
    expect(el.textContent).toContain("Connect wallet");
    expect(el.textContent).toContain("How it works");
    expect(el.textContent).toContain("What the program guarantees");
  });

  it("start screen offers both scenarios", async () => {
    const el = await mount(<StartScreen />, "/a/demo");
    expect(el.textContent).toContain("Revenue deals that");
    expect(el.textContent).toContain("Prince's startup");
    expect(el.textContent).toContain("Build your own");
    // jsdom's selector engine trips on & and ? in attribute values — match the
    // scenario half of the query only; both cards assert their target.
    expect(el.querySelector('a[href*="scenario=prince"]')).toBeTruthy();
    expect(el.querySelector('a[href*="scenario=custom"]')).toBeTruthy();
  });

  it("workspace renders the six-step rail and acting-as", async () => {
    const el = await mount(<Workspace />, "/a/demo/run");
    expect(el.textContent).toContain("Create agreement");
    expect(el.textContent).toContain("Expire + close");
    expect(el.textContent).toContain("ACTING AS");
    expect(el.textContent).toContain("THE BOARD IS EMPTY");
  });

  it("step starts at 01 and advances with ArrowRight", async () => {
    const el = await mount(<Workspace />, "/a/demo/run");
    expect(activeStep(el)).toContain("01");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(activeStep(el)).toContain("02");
    expect(activeStep(el)).toContain("Buy shares");
  });

  it("URL ?step=claim opens on step 04", async () => {
    const el = await mount(<Workspace />, "/a/demo/run?scenario=prince&step=claim");
    expect(activeStep(el)).toContain("04");
    expect(activeStep(el)).toContain("Claim earnings");
  });

  it("create agreement lights the board, waterfall and positions", async () => {
    const proto = newClient();
    const el = await mount(<Workspace />, "/a/demo/run", proto);
    await act(async () => {
      await proto.reset(PRINCE_PERSONAS);
      await proto.submit({
        ix: "initialize_agreement",
        creator: PRINCE_PERSONAS[0].address,
        input: princeCreateInput(1_700_000_000),
      });
    });
    expect(el.textContent).toContain("Prince's startup");
    expect(el.textContent).toContain("TIER WATERFALL");
    expect(el.textContent).toContain("POSITIONS");
    expect(el.textContent).toContain("REVENUE DEPOSITED");
  });

  it("event log records the initialize instruction", async () => {
    const proto = newClient();
    const el = await mount(<Workspace />, "/a/demo/run", proto);
    await act(async () => {
      await proto.reset(PRINCE_PERSONAS);
      await proto.submit({
        ix: "initialize_agreement",
        creator: PRINCE_PERSONAS[0].address,
        input: princeCreateInput(1_700_000_000),
      });
    });
    expect(el.textContent).toContain("EVENT LOG");
    expect(el.textContent).toContain("initialize_agreement");
  });
});

describe("action panels", () => {
  async function mountedWithState(stepParam: string) {
    const proto = newClient();
    const el = await mount(<Workspace />, `/a/demo/run?scenario=prince&step=${stepParam}`, proto);
    await act(async () => {
      await proto.reset(PRINCE_PERSONAS);
      await proto.submit({
        ix: "initialize_agreement",
        creator: PRINCE_PERSONAS[0].address,
        input: princeCreateInput(1_700_000_000),
      });
    });
    return { proto, el };
  }

  it("buy panel shows preset chips and cost math", async () => {
    const { el } = await mountedWithState("buy");
    expect(el.textContent).toContain("Buy shares");
    expect(el.textContent).toContain("NATE");
    expect(el.textContent).toContain("purchase_share");
  });

  it("deposit panel previews tier routing", async () => {
    const { el } = await mountedWithState("deposit");
    expect(el.textContent).toContain("Deposit revenue");
    expect(el.textContent).toContain("WHERE THIS DEPOSIT LANDS");
    expect(el.textContent).toContain("deposit_revenue");
  });

  it("claim panel shows claimable after a deposit", async () => {
    const { proto, el } = await mountedWithState("claim");
    // Buy then deposit so a holder has claimable.
    await act(async () => {
      const nate = PRINCE_PERSONAS.find((p) => p.label === "Nate")!;
      const studio = PRINCE_PERSONAS.find((p) => p.label === "Studio books")!;
      await proto.submit({ ix: "purchase_share", buyerId: nate.id, buyerLabel: nate.label, amount: 300_000_000n });
      await proto.submit({ ix: "deposit_revenue", depositorId: studio.id, amount: 4_000_000_000n });
    });
    const a = await proto.getState();
    const nate = PRINCE_PERSONAS.find((p) => p.label === "Nate")!;
    expect(claimableFor(a, nate.id)).toBeGreaterThan(0n);
    expect(el.textContent).toContain("Claim earnings");
    expect(el.textContent).toContain("TIER SHARE");
  });

  it("transfer panel lists holders and freeze controls", async () => {
    const { proto, el } = await mountedWithState("transfer");
    await act(async () => {
      const nate = PRINCE_PERSONAS.find((p) => p.label === "Nate")!;
      await proto.submit({ ix: "purchase_share", buyerId: nate.id, buyerLabel: nate.label, amount: 100_000_000n });
    });
    expect(el.textContent).toContain("Transfer + freeze");
    expect(el.textContent).toContain("TRANSFER POSITION");
    expect(el.textContent).toContain("COMPLIANCE");
    expect(el.textContent).toContain("FREEZE");
  });

  it("wind-down panel shows expire gate and break-it buttons", async () => {
    const { el } = await mountedWithState("wind-down");
    expect(el.textContent).toContain("Expire + close");
    expect(el.textContent).toContain("BREAK-IT");
    expect(el.textContent).toContain("CLOSE BEFORE EXPIRY");
    expect(el.textContent).toContain("EXPIRE BEFORE END CONDITION");
    expect(el.textContent).toContain("EXPIRES IN");
  });

  it("clock buttons advance the protocol clock", async () => {
    const { proto, el } = await mountedWithState("");
    const before = await proto.now();
    const btn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "+30D");
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    const after = await proto.now();
    expect(after - before).toBeGreaterThanOrEqual(30 * 86_400 - 5);
  });

  it("build-your-own builder shows live rule-name chips", async () => {
    const el = await mount(<Workspace />, "/a/demo/run?scenario=custom&step=create");
    // PanelShell upper-cases the title.
    expect(el.textContent).toContain("BUILD YOUR OWN DEAL");
    expect(el.textContent).toContain("LastTierMustBeUncapped");
    expect(el.textContent).toContain("SplitsMustSumTo10000");
    expect(el.textContent).toContain("ExpOrCapRequired");
    // Fresh builder: last tier uncapped ✓, one tier 100% holders ✓, name empty ✗
    expect(el.textContent).toContain("NameRequired");
  });
});
