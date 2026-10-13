// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { Providers } from "@/app/providers";
import { Splash } from "@/features/journey/Splash";
import { Create } from "@/features/create/Create";
import { OpenAgreement } from "@/features/agreement/OpenAgreement";
import { AgreementHub } from "@/features/agreement/AgreementHub";
import { Buy } from "@/features/buy/Buy";
import { Deposit } from "@/features/deposit/Deposit";
import { Claim } from "@/features/claim/Claim";
import { TransferLab } from "@/features/transfer-lab/TransferLab";
import { Admin } from "@/features/admin/Admin";
import { WindDown } from "@/features/wind-down/WindDown";
import { Closer } from "@/features/journey/Closer";
import { useSim, workedExampleInput } from "@/state/sim";

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

function mount(node: React.ReactNode, path = "/a/demo"): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <Providers>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </Providers>,
    );
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("screen smoke (client render)", () => {
  beforeAll(() => {
    useSim.getState().create(workedExampleInput(), "CREATOR");
    useSim.getState().buy("BUYER", "You", 100n);
    useSim.getState().depositRevenue("DEPOSITOR", 49_000_000_000n);
  });

  const screens: [string, React.ReactNode, string, string][] = [
    ["Splash", <Splash />, "/", "Revenue deals that"],
    ["Create", <Create />, "/create", "Turn future revenue"],
    ["OpenAgreement", <OpenAgreement />, "/open", "Open an existing"],
    ["AgreementHub", <AgreementHub />, "/a/demo", "Music advance"],
    ["Buy", <Buy />, "/a/demo/buy", "Own a slice"],
    ["Deposit", <Deposit />, "/a/demo/deposit", "One deposit"],
    ["Claim", <Claim />, "/a/demo/claim", "Revenue lands"],
    ["TransferLab", <TransferLab />, "/a/demo/transfer", "The hook follows"],
    ["Admin", <Admin />, "/a/demo/admin", "Freeze when needed"],
    ["WindDown", <WindDown />, "/a/demo/wind-down", "End it cleanly"],
    ["Closer", <Closer />, "/closer", "Revenue that follows"],
  ];

  for (const [name, node, path, headline] of screens) {
    it(`renders ${name} with headline`, () => {
      const el = mount(node, path);
      expect(el.textContent).toContain(headline);
    });
  }

  it("hub shows deposit total and cell grid", () => {
    const el = mount(<AgreementHub />, "/a/demo");
    expect(el.textContent).toContain("49,000");
    expect(el.textContent).toContain("TOKEN SUPPLY");
  });

  it("claim shows claimable payout from the worked example", () => {
    const el = mount(<Claim />, "/a/demo/claim");
    expect(el.textContent).toContain("AVAILABLE TO CLAIM");
  });

  it("deposit shows per-tier take table", () => {
    const el = mount(<Deposit />, "/a/demo/deposit");
    expect(el.textContent).toContain("WHERE THIS DEPOSIT LANDS");
  });
});
