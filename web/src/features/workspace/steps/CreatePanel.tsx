import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput, TextInput } from "@/components/ui/input";
import {
  fmtShares,
  fmtUsdWhole,
  useProtocol,
  useProtocolSnapshot,
  type CreateInput,
  type DemoScenario,
  type Persona,
} from "@/protocol";
import { stepDef } from "@/state/ui";
import { guardSubmit } from "./util";

const tokens = (n: number): bigint => BigInt(n) * 1_000_000n;
const usdc = (n: number): bigint => BigInt(n) * 1_000_000n;
const days = (n: number): bigint => BigInt(n) * 86_400n;

interface TierRow {
  threshold: string; // "" = uncapped
  holdersPct: number;
  walletPct: number;
}

/**
 * Step 01 — create. The prince scenario arrives prefilled with the worked
 * example; "Build your own" starts blank and shows live rule chips.
 */
export function CreatePanel({
  scenario,
  creator,
  clock,
}: {
  scenario: DemoScenario;
  creator: Persona | null;
  clock: number;
}) {
  const { state } = useProtocolSnapshot();
  const def = stepDef("create");

  if (state) {
    return (
      <PanelShell title="Agreement created" hint={def.hint}>
        <p className="text-sm text-primary">
          <span className="text-healthy font-semibold">✓</span> {state.name} is live —{" "}
          {fmtShares(state.supply)} tokens at {fmtUsdWhole(state.sharePrice)},{" "}
          {state.tiers.length} tiers, expires{" "}
          {state.expTime ? new Date(state.expTime * 1000).getFullYear() : "never"}.
        </p>
        <p className="mono-label mt-3 text-secondary">NEXT → STEP 02 · BUY SHARES</p>
      </PanelShell>
    );
  }

  if (scenario.id === "custom") {
    return <BuilderPanel scenario={scenario} creator={creator} />;
  }

  return <SimplePanel scenario={scenario} creator={creator} clock={clock} />;
}

// — Prince's startup: prefilled -------------------------------------------

function SimplePanel({
  scenario,
  creator,
  clock,
}: {
  scenario: DemoScenario;
  creator: Persona | null;
  clock: number;
}) {
  const client = useProtocol();
  const { tx } = useProtocolSnapshot();
  const def = stepDef("create");

  const prefilled = scenario.createInput(clock);
  const [name, setName] = useState(prefilled.name);
  const [supply, setSupply] = useState(String(prefilled.supply / 1_000_000n));
  const [price, setPrice] = useState(String(prefilled.sharePrice / 1_000_000n));
  const [submitting, setSubmitting] = useState(false);

  const busy =
    submitting ||
    (tx !== null && tx.phase !== "confirmed" && tx.phase !== "failed" && tx.phase !== "idle");
  const supplyNum = Number(supply);
  const priceNum = Number(price);
  const nameError = name.trim().length === 0 ? "Give the agreement a name." : null;
  const supplyError =
    !Number.isFinite(supplyNum) || supplyNum <= 0 ? "Supply must be above zero." : null;
  const priceError =
    !Number.isFinite(priceNum) || priceNum <= 0 ? "Share price must be above zero." : null;
  const valid = !nameError && !supplyError && !priceError;

  const submit = async () => {
    if (!valid || busy) return;
    setSubmitting(true);
    const input = { ...scenario.createInput(await client.now()) };
    await guardSubmit(() =>
      client.submit({
        ix: "initialize_agreement",
        creator: creator?.address ?? scenario.personas[0].address,
        input: {
          ...input,
          name: name.trim(),
          supply: tokens(supplyNum),
          sharePrice: usdc(priceNum),
        },
      }),
    );
    setSubmitting(false);
  };

  return (
    <PanelShell title="Create the deal" hint={def.hint}>
      <div className="space-y-4">
        <label className="block">
          <span className="mono-label text-xs font-semibold text-secondary">NAME</span>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Prince's startup"
            error={nameError}
            className="mt-1.5"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mono-label text-xs font-semibold text-secondary">SUPPLY</span>
            <NumberInput
              value={supply}
              onChange={(e) => setSupply(e.target.value)}
              suffix="TOKENS"
              error={supplyError}
              className="mt-1.5"
            />
          </label>
          <label className="block">
            <span className="mono-label text-xs font-semibold text-secondary">SHARE PRICE</span>
            <NumberInput
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              suffix="USDC"
              error={priceError}
              className="mt-1.5"
            />
          </label>
        </div>

        <dl className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-surface-inset p-3.5 text-secondary">
          {prefilled.tiers.map((t, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="mono-label text-xs font-medium text-secondary">TIER {i + 1}</span>
              <span className="mono-data text-xs font-medium text-primary tnum">
                {t.threshold === null ? "UNCAPPED" : fmtUsdWhole(t.threshold)} ·{" "}
                {t.splits.map((s) => `${s.bps / 100}% ${s.kind === "holders" ? "HOLDERS" : "PARTY"}`).join(" / ")}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
            <span className="mono-label text-xs font-medium text-secondary">EXPIRY · CLAIM WINDOW</span>
            <span className="mono-data text-xs font-medium text-primary tnum">
              {prefilled.expTime
                ? `${Math.round((prefilled.expTime - clock) / 86_400)} DAYS`
                : "NONE"}{" "}
              · {prefilled.claimWindow ? `${Number(prefilled.claimWindow) / 86_400} DAYS` : "—"}
            </span>
          </div>
        </dl>

        <Button onClick={submit} disabled={!valid} loading={busy} className="w-full">
          Create agreement
        </Button>
        <p className="mono-label text-xs text-secondary">
          ONE TRANSACTION · {prefilled.tiers.length} TIERS · SUPPLY MINTED, AUTHORITY REVOKED ·{" "}
          <span className="opacity-70">initialize_agreement</span>
        </p>
      </div>
    </PanelShell>
  );
}

// — Build your own ---------------------------------------------------------

function BuilderPanel({
  scenario,
  creator,
}: {
  scenario: DemoScenario;
  creator: Persona | null;
}) {
  const client = useProtocol();
  const { tx } = useProtocolSnapshot();
  const def = stepDef("create");

  const depositorP = scenario.personas.find((p) => p.role === "depositor") ?? scenario.personas[1] ?? scenario.personas[0];
  const adminP = scenario.personas.find((p) => p.role === "admin") ?? scenario.personas[2] ?? scenario.personas[0];

  const [name, setName] = useState("");
  const [supply, setSupply] = useState("1000");
  const [price, setPrice] = useState("10");
  const [tiers, setTiers] = useState<TierRow[]>([{ threshold: "", holdersPct: 100, walletPct: 0 }]);
  const [expiryDays, setExpiryDays] = useState("365");
  const [claimWindowDays, setClaimWindowDays] = useState("30");
  const [submitting, setSubmitting] = useState(false);

  const busy =
    submitting ||
    (tx !== null && tx.phase !== "confirmed" && tx.phase !== "failed" && tx.phase !== "idle");

  // Live rule-name validation
  const rules: { code: string; ok: boolean; msg: string }[] = [];
  rules.push({ code: "InvalidTierCount", ok: tiers.length >= 1 && tiers.length <= 5, msg: "1-5 tiers." });
  rules.push({
    code: "LastTierMustBeUncapped",
    ok: tiers.length > 0 && tiers[tiers.length - 1].threshold === "",
    msg: "Last tier must be uncapped (no threshold).",
  });
  const thresholds = tiers.slice(0, -1).map((t) => (t.threshold === "" ? -1 : Number(t.threshold)));
  rules.push({
    code: "ThresholdsNotIncreasing",
    ok: thresholds.every((t, i) => t >= 0 && (i === 0 || t > thresholds[i - 1])),
    msg: "Capped thresholds must strictly increase.",
  });
  rules.push({
    code: "SplitsMustSumTo10000",
    ok: tiers.every((t) => t.holdersPct + t.walletPct === 100),
    msg: "Holders % + wallet % must equal 100%.",
  });
  rules.push({
    code: "ExpOrCapRequired",
    ok: Number(expiryDays) > 0,
    msg: "Set an expiry in days above 0.",
  });
  rules.push({
    code: "InvalidSupply",
    ok: Number.isFinite(Number(supply)) && Number(supply) > 0,
    msg: "Supply must be above 0.",
  });
  rules.push({
    code: "InvalidPrice",
    ok: Number.isFinite(Number(price)) && Number(price) > 0,
    msg: "Share price must be above 0.",
  });
  rules.push({
    code: "NameRequired",
    ok: name.trim().length > 0,
    msg: "Give the deal a name.",
  });

  const allOk = rules.every((r) => r.ok);

  const setTier = (i: number, patch: Partial<TierRow>) => {
    setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  };

  const addTier = () => {
    setTiers((prev) => {
      if (prev.length >= 5) return prev;
      const lastCapped = prev[prev.length - 1]?.threshold ?? "10000";
      const nextThreshold = prev[prev.length - 1]?.threshold === "" ? "" : String(Number(lastCapped) + 10000);
      return [...prev, { threshold: nextThreshold, holdersPct: 70, walletPct: 30 }];
    });
  };

  const removeTier = (i: number) => {
    setTiers((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  };

  const buildInput = (now: number): CreateInput => ({
    name: name.trim(),
    supply: tokens(Number(supply)),
    sharePrice: usdc(Number(price)),
    tiers: tiers.map((t) => ({
      threshold: t.threshold === "" ? null : usdc(Number(t.threshold)),
      splits: [
        { kind: "holders", bps: t.holdersPct * 100 },
        ...(t.walletPct > 0
          ? [{ kind: "wallet" as const, bps: t.walletPct * 100, address: creator?.address ?? scenario.personas[0].address }]
          : []),
      ],
    })),
    expTime: now + Number(expiryDays) * 86_400,
    endCap: null,
    claimWindow: days(Number(claimWindowDays)),
    startTime: null,
    depositor: depositorP.address,
    complianceAdmin: adminP.address,
  });

  const submit = () => {
    if (!allOk || busy) return;
    setSubmitting(true);
    void (async () => {
      const now = await client.now();
      await guardSubmit(() =>
        client.submit({ ix: "initialize_agreement", creator: creator?.address ?? scenario.personas[0].address, input: buildInput(now) }),
      );
      setSubmitting(false);
    })();
  };

  return (
    <PanelShell title="Build your own deal" hint={def.hint}>
      <div className="space-y-4">
        <label className="block">
          <span className="mono-label text-xs font-semibold text-secondary">NAME</span>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My deal"
            error={name.trim().length === 0 ? "Give the deal a name." : null}
            className="mt-1.5"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mono-label text-xs font-semibold text-secondary">SUPPLY</span>
            <NumberInput value={supply} onChange={(e) => setSupply(e.target.value)} suffix="TOKENS" className="mt-1.5" />
          </label>
          <label className="block">
            <span className="mono-label text-xs font-semibold text-secondary">SHARE PRICE</span>
            <NumberInput value={price} onChange={(e) => setPrice(e.target.value)} suffix="USDC" className="mt-1.5" />
          </label>
        </div>

        {/* Tiers editor */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-surface-inset p-3.5">
          <div className="flex items-center justify-between">
            <span className="mono-label text-xs font-semibold text-secondary">TIERS ({tiers.length})</span>
            <button
              onClick={addTier}
              disabled={tiers.length >= 5}
              className="mono-label rounded-full border border-purple-500/20 bg-surface px-3 py-1 text-xs font-medium text-secondary transition-colors hover:border-accent hover:text-primary disabled:opacity-55"
            >
              + ADD TIER
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {tiers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className="flex-1 min-w-[100px]">
                  <span className="mono-label text-xs font-semibold text-secondary">THRESHOLD (USDC)</span>
                  <NumberInput
                    value={t.threshold}
                    onChange={(e) => setTier(i, { threshold: e.target.value })}
                    placeholder={i === tiers.length - 1 ? "uncapped" : "10000"}
                    className="mt-1"
                  />
                </label>
                <label className="w-16">
                  <span className="mono-label text-xs font-semibold text-secondary">HOLDERS</span>
                  <NumberInput value={String(t.holdersPct)} onChange={(e) => setTier(i, { holdersPct: Number(e.target.value) || 0 })} className="mt-1" />
                </label>
                <span className="mb-2 text-sm font-medium text-secondary">%</span>
                <label className="w-16">
                  <span className="mono-label text-xs font-semibold text-secondary">WALLET</span>
                  <NumberInput value={String(t.walletPct)} onChange={(e) => setTier(i, { walletPct: Number(e.target.value) || 0 })} className="mt-1" />
                </label>
                <span className="mb-2 text-sm font-medium text-secondary">%</span>
                {tiers.length > 1 && (
                  <button
                    onClick={() => removeTier(i)}
                    className="mb-2 text-danger hover:text-red-700"
                    aria-label={`Remove tier ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mono-label text-xs font-semibold text-secondary">EXPIRY (DAYS)</span>
            <NumberInput value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} suffix="DAYS" className="mt-1.5" />
          </label>
          <label className="block">
            <span className="mono-label text-xs font-semibold text-secondary">CLAIM WINDOW (DAYS)</span>
            <NumberInput value={claimWindowDays} onChange={(e) => setClaimWindowDays(e.target.value)} suffix="DAYS" className="mt-1.5" />
          </label>
        </div>

        {/* Live rule-name chips */}
        <div className="flex flex-wrap gap-2">
          {rules.map((r) => (
            <span
              key={r.code}
              title={r.msg}
              className={`mono-label rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                r.ok ? "border-mint-700/50 bg-mint-700/10 text-healthy" : "border-red-500/40 bg-red-500/10 text-danger"
              }`}
            >
              {r.ok ? "✓" : "✗"} {r.code}
            </span>
          ))}
        </div>

        <Button onClick={submit} disabled={!allOk || busy} loading={busy} className="w-full">
          Create agreement
        </Button>
        <p className="mono-label text-xs text-secondary">
          {tiers.length} TIER{tiers.length === 1 ? "" : "S"} · DEPOSITOR {depositorP.label.toUpperCase()} · ADMIN{" "}
          {adminP.label.toUpperCase()}
        </p>
      </div>
    </PanelShell>
  );
}

// — Shared shell -----------------------------------------------------------

export function PanelShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-panel border border-[var(--border-subtle)] bg-surface p-5 text-primary md:p-6">
      <h2 className="mono-label text-xs font-bold tracking-wider text-accent">
        {title.toUpperCase()}
      </h2>
      {hint && <p className="mt-2 text-sm leading-relaxed text-secondary">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
