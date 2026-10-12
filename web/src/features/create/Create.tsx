import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopChrome } from "@/features/journey/chrome";
import { BinaryPanel } from "@/components/viz/binary-panel";
import { RowCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextInput, NumberInput } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { TxDrawer, INIT_CHECKLIST, type TxStage } from "@/components/ui/tx-drawer";
import { useExecute } from "@/lib/execute";
import { useJourney } from "@/state/journey";
import { cn } from "@/lib/cn";

interface SplitForm {
  party: "holders" | "wallet";
  bps: number;
  address: string;
}
interface TierForm {
  threshold: string; // whole USDC; "" = unlimited
  splits: SplitForm[];
}
interface Form {
  name: string;
  supply: string; // tokens
  sharePrice: string; // USDC
  tiers: TierForm[];
  expTime: string; // date string, optional
  endCap: string; // USDC, optional
  claimWindowDays: string;
  accessMode: "open" | "allowlist";
  depositor: string;
  complianceAdmin: string;
}

const STEPS = ["Basics", "Tiers", "End & access", "Roles", "Review"] as const;

/** Default = the worked example (§9), so demo mode is one click from data. */
function defaultForm(): Form {
  return {
    name: "Music advance — 100k",
    supply: "1000",
    sharePrice: "50",
    tiers: [
      { threshold: "10000", splits: [{ party: "holders", bps: 10_000, address: "" }] },
      {
        threshold: "30000",
        splits: [
          { party: "holders", bps: 7000, address: "" },
          { party: "wallet", bps: 3000, address: "CREATOR" },
        ],
      },
      {
        threshold: "",
        splits: [
          { party: "holders", bps: 4000, address: "" },
          { party: "wallet", bps: 6000, address: "CREATOR" },
        ],
      },
    ],
    expTime: "",
    endCap: "60000",
    claimWindowDays: "7",
    accessMode: "open",
    depositor: "DEPOSITOR",
    complianceAdmin: "ADMIN",
  };
}

const DISCLOSURES = [
  ["Revenue is not verified.", "The protocol divides deposited money exactly by the rules. It cannot check that the reported off-chain revenue is real. That trust sits with the depositor and any off-chain legal agreement."],
  ["Not a legal contract.", "This is a technical proof of concept for on-chain settlement. It is not itself a binding legal contract."],
  ["Admin freeze.", "A compliance admin can freeze a holder. A freeze blocks transfers and claims. It never moves tokens or USDC."],
  ["Claim window.", "After the agreement expires and the claim window ends, the creator can close it and receives any unclaimed revenue. Claim before the deadline."],
  ["Hook-only venues.", "Secondary trading works only on venues that support Token-2022 transfer-hook tokens."],
] as const;

function usdcToBase(v: string): bigint {
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.round(n * 1_000_000));
}

export function Create() {
  const nav = useNavigate();
  const exec = useExecute();
  const demo = useJourney((s) => s.demoMode);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(defaultForm);
  const [ack, setAck] = useState<boolean[]>(DISCLOSURES.map(() => false));
  const [showChecklist, setShowChecklist] = useState(false);
  const [stage, setStage] = useState<TxStage | null>(null);
  const [checks, setChecks] = useState(INIT_CHECKLIST);
  const [error, setError] = useState<string | null>(null);

  const creator = demo ? "CREATOR" : "CONNECTED_WALLET";

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // ---- tier validation (mirrors the program) --------------------------
  const tierError = useMemo(() => {
    const ts = form.tiers;
    if (ts.length < 1 || ts.length > 5) return "You need between 1 and 5 tiers.";
    let prev = -Infinity;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const unlimited = t.threshold === "";
      if (!unlimited) {
        const v = Number(t.threshold);
        if (!Number.isFinite(v) || v <= prev)
          return `Tier ${i + 1}: each threshold must be higher than the one before it.`;
        prev = v;
      }
      const sum = t.splits.reduce((s, x) => s + x.bps, 0);
      if (sum !== 10_000)
        return `Tier ${i + 1}: splits total ${(sum / 100).toFixed(1)}%. They must equal 100%.`;
    }
    if (ts[ts.length - 1].threshold !== "")
      return "The last tier must have no limit, so every deposit has somewhere to go.";
    return null;
  }, [form.tiers]);

  const rolesError =
    form.complianceAdmin.trim() === creator
      ? "The compliance admin can't be the creator. Choose another wallet."
      : null;
  const endError =
    !form.expTime && !form.endCap
      ? "Set an expiry date, a revenue cap, or both."
      : null;

  const canSubmit =
    !tierError && !rolesError && !endError && ack.every(Boolean);

  // ---- submit ----------------------------------------------------------
  async function submit() {
    setError(null);
    const lastTier = form.tiers[form.tiers.length - 1];
    try {
      const input = {
        name: form.name || "Untitled agreement",
        supply: usdcToBase(form.supply),
        sharePrice: usdcToBase(form.sharePrice),
        tiers: form.tiers.map((t) => ({
          threshold: t.threshold === "" ? null : usdcToBase(t.threshold),
          splits: t.splits.map((s) => ({
            kind: s.party,
            bps: s.bps,
            address: s.party === "wallet" ? s.address || creator : undefined,
          })),
        })),
        expTime: form.expTime ? Math.floor(new Date(form.expTime).getTime() / 1000) : null,
        endCap: form.endCap ? usdcToBase(form.endCap) : null,
        claimWindow: form.claimWindowDays
          ? BigInt(Math.floor(Number(form.claimWindowDays) * 86_400))
          : null,
        startTime: null,
        depositor: form.depositor || "DEPOSITOR",
        complianceAdmin: form.complianceAdmin || "ADMIN",
      };
      exec.createAgreement(input, creator);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    void lastTier;
    // Run the seven-step checklist animation in the drawer.
    setShowChecklist(true);
    setStage("Build");
    const stages: TxStage[] = ["Build", "Simulate", "Sign", "Confirm", "Finalized"];
    stages.forEach((s, i) => {
      setTimeout(() => setStage(s), 350 * (i + 1));
    });
    checks.forEach((_, i) => {
      setTimeout(() => {
        setChecks((cs) => cs.map((c, j) => (j <= i ? { ...c, done: true } : c)));
      }, 1600 + i * 180);
    });
    setTimeout(() => {
      setStage("Finalized");
      nav("/a/demo");
    }, 3400);
  }

  return (
    <div className="theme-light min-h-screen bg-purple-100">
      <TopChrome n="01" eyebrow="CREATE AGREEMENT" />

      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 px-6 pb-16 lg:grid-cols-[1fr_380px] lg:px-12">
        {/* Left: wizard */}
        <div>
          <h1
            className="font-display"
            style={{ fontSize: "clamp(34px, 4vw, 56px)", lineHeight: 1.03, letterSpacing: "-0.03em" }}
          >
            <span className="text-text-on-light">Turn future revenue</span>
            <br />
            <span style={{ color: "var(--color-purple-500)" }}>
              into a programmable asset
            </span>
          </h1>
          <p className="body-lg mt-4 max-w-xl text-text-muted-light">
            Five sections. The program validates every rule — the same errors
            appear here as plain sentences.
          </p>

          {/* Step tabs */}
          <div className="mt-8 flex flex-wrap gap-2">
            {STEPS.map((s, i) => (
              <button
                key={s}
                onClick={() => setStep(i)}
                className={cn(
                  "mono-label rounded-full px-3 py-1.5 transition-colors",
                  i === step
                    ? "glow-purple bg-ink-900 text-white"
                    : "bg-white text-text-muted-light hover:text-text-on-light",
                )}
              >
                {i === 4 ? "05" : `0${i + 1}`} {s.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-4">
            {step === 0 && (
              <>
                <RowCard className="text-text-on-light">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mono-label text-text-muted-light">AGREEMENT NAME</span>
                      <TextInput
                        value={form.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="Music advance — 100k"
                      />
                    </label>
                    <label className="block">
                      <span className="mono-label text-text-muted-light">PAYMENT DESTINATION</span>
                      <TextInput value={creator} readOnly suffix="USDC ATA" hint="Defaults to the connected wallet's USDC account." />
                    </label>
                    <label className="block">
                      <span className="mono-label text-text-muted-light">SUPPLY</span>
                      <NumberInput value={form.supply} onChange={(e) => set("supply", e.target.value)} suffix="TOKENS" />
                    </label>
                    <label className="block">
                      <span className="mono-label text-text-muted-light">SHARE PRICE</span>
                      <NumberInput value={form.sharePrice} onChange={(e) => set("sharePrice", e.target.value)} suffix="USDC" />
                    </label>
                  </div>
                </RowCard>
              </>
            )}

            {step === 1 && (
              <>
                {form.tiers.map((t, i) => {
                  const last = i === form.tiers.length - 1;
                  const sum = t.splits.reduce((s, x) => s + x.bps, 0);
                  return (
                    <RowCard key={i} className="text-text-on-light">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Chip>N° 0{i + 1}</Chip>
                          <span className="font-medium text-text-on-light">Tier {i + 1}</span>
                        </span>
                        {!last && form.tiers.length > 1 && (
                          <button
                            className="mono-label text-red-500 hover:underline"
                            onClick={() =>
                              set("tiers", form.tiers.filter((_, j) => j !== i))
                            }
                          >
                            REMOVE
                          </button>
                        )}
                      </div>

                      <div className="mt-3 flex items-center gap-3">
                        <span className="mono-label text-text-muted-light">UP TO</span>
                        {last ? (
                          <span
                            className="mono-data flex h-11 items-center gap-1.5 rounded-[14px] border border-purple-500/15 bg-purple-50 px-3 text-text-on-light"
                            title="The last tier has no limit so a deposit can never overflow."
                          >
                            UNLIMITED ∞
                          </span>
                        ) : (
                          <NumberInput
                            className="max-w-[240px]"
                            value={t.threshold}
                            onChange={(e) => {
                              const tiers = [...form.tiers];
                              tiers[i] = { ...t, threshold: e.target.value };
                              set("tiers", tiers);
                            }}
                            suffix="USDC"
                            placeholder="10000"
                          />
                        )}
                      </div>

                      {/* splits */}
                      <div className="mt-4 space-y-3">
                        {t.splits.map((sp, j) => (
                          <div key={j} className="flex flex-wrap items-center gap-3">
                            <span
                              className={cn(
                                "mono-label rounded-full px-2.5 py-1",
                                sp.party === "holders"
                                  ? "bg-purple-500 text-white"
                                  : "bg-coral-500 text-white",
                              )}
                            >
                              {sp.party === "holders" ? "HOLDERS" : "WALLET"}
                            </span>
                            {sp.party === "wallet" && (
                              <TextInput
                                className="max-w-[320px]"
                                value={sp.address}
                                placeholder="Wallet address or CREATOR"
                                onChange={(e) => {
                                  const tiers = [...form.tiers];
                                  const splits = [...t.splits];
                                  splits[j] = { ...sp, address: e.target.value };
                                  tiers[i] = { ...t, splits };
                                  set("tiers", tiers);
                                }}
                              />
                            )}
                            <NumberInput
                              className="max-w-[160px]"
                              value={String(sp.bps)}
                              suffix="BPS"
                              onChange={(e) => {
                                const v = Math.max(0, Math.min(10_000, Number(e.target.value) || 0));
                                const tiers = [...form.tiers];
                                const splits = [...t.splits];
                                splits[j] = { ...sp, bps: v };
                                tiers[i] = { ...t, splits };
                                set("tiers", tiers);
                              }}
                            />
                            {t.splits.length < 4 && j === t.splits.length - 1 && (
                              <button
                                className="mono-label text-purple-500 hover:underline"
                                onClick={() => {
                                  const tiers = [...form.tiers];
                                  tiers[i] = {
                                    ...t,
                                    splits: [
                                      ...t.splits,
                                      { party: "wallet", bps: 0, address: creator },
                                    ],
                                  };
                                  set("tiers", tiers);
                                }}
                              >
                                + SPLIT
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* two-colour bps track for 2-split tiers */}
                      {t.splits.length === 2 && (
                        <div className="mt-3">
                          <div className="flex h-3 overflow-hidden rounded-full">
                            <div
                              className="bg-purple-500 transition-all"
                              style={{ width: `${(t.splits[0].bps / 10_000) * 100}%` }}
                            />
                            <div
                              className="bg-coral-500 transition-all"
                              style={{ width: `${(t.splits[1].bps / 10_000) * 100}%` }}
                            />
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={10_000}
                            step={100}
                            value={t.splits[0].bps}
                            aria-label={`Tier ${i + 1} holders bps`}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              const tiers = [...form.tiers];
                              tiers[i] = {
                                ...t,
                                splits: [
                                  { ...t.splits[0], bps: v },
                                  { ...t.splits[1], bps: 10_000 - v },
                                ],
                              };
                              set("tiers", tiers);
                            }}
                            className="mt-2 w-full accent-[#6D45FE]"
                          />
                          <div className="mono-data mt-1 flex justify-between text-text-muted-light">
                            <span className="text-purple-500">
                              {t.splits[0].bps.toLocaleString()} / {(t.splits[1].bps / 100).toFixed(0)}% HOLDERS
                            </span>
                            <span className="text-coral-500">
                              {t.splits[1].bps.toLocaleString()} bps WALLET
                            </span>
                          </div>
                        </div>
                      )}

                      <div
                        className={cn(
                          "mono-label mt-3 inline-block rounded-full px-2.5 py-1",
                          sum === 10_000 ? "bg-mint-700/10 text-mint-700" : "bg-red-500/10 text-red-500",
                        )}
                      >
                        TOTAL {sum.toLocaleString()} / 10,000 BPS
                      </div>
                    </RowCard>
                  );
                })}

                {form.tiers.length < 5 && (
                  <button
                    onClick={() =>
                      set("tiers", [
                        ...form.tiers,
                        { threshold: "", splits: [{ party: "holders", bps: 10_000, address: "" }] },
                      ])
                    }
                    className="mono-label w-full rounded-card border border-dashed border-purple-500/30 py-3 text-purple-500 hover:border-purple-500"
                  >
                    + ADD TIER (MAX 5)
                  </button>
                )}
                {tierError && <p className="text-sm text-red-500">{tierError}</p>}
              </>
            )}

            {step === 2 && (
              <RowCard className="text-text-on-light">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mono-label text-text-muted-light">EXPIRY DATE</span>
                    <TextInput
                      type="date"
                      value={form.expTime}
                      onChange={(e) => set("expTime", e.target.value)}
                      hint="At least one of expiry or cap is required."
                    />
                  </label>
                  <label className="block">
                    <span className="mono-label text-text-muted-light">CUMULATIVE CAP</span>
                    <NumberInput
                      value={form.endCap}
                      onChange={(e) => set("endCap", e.target.value)}
                      suffix="USDC"
                      hint="Reaching the cap makes expiry callable — it never trims a deposit."
                    />
                  </label>
                  <label className="block">
                    <span className="mono-label text-text-muted-light">CLAIM WINDOW (DAYS)</span>
                    <NumberInput
                      value={form.claimWindowDays}
                      onChange={(e) => set("claimWindowDays", e.target.value)}
                      suffix="DAYS"
                    />
                  </label>
                  <div>
                    <span className="mono-label text-text-muted-light">ACCESS</span>
                    <div className="mt-2 flex gap-2">
                      {(["open", "allowlist"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => set("accessMode", m)}
                          className={cn(
                            "mono-label rounded-full px-4 py-2",
                            form.accessMode === m
                              ? "bg-purple-500 text-white"
                              : "bg-white text-text-muted-light border border-purple-500/15",
                          )}
                        >
                          {m.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {endError && <p className="mt-3 text-sm text-red-500">{endError}</p>}
              </RowCard>
            )}

            {step === 3 && (
              <RowCard className="text-text-on-light">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mono-label text-text-muted-light">DEPOSITOR WALLET</span>
                    <TextInput
                      value={form.depositor}
                      onChange={(e) => set("depositor", e.target.value)}
                      hint="The one wallet allowed to deposit revenue."
                    />
                  </label>
                  <label className="block">
                    <span className="mono-label text-text-muted-light">COMPLIANCE ADMIN</span>
                    <TextInput
                      value={form.complianceAdmin}
                      onChange={(e) => set("complianceAdmin", e.target.value)}
                      error={rolesError}
                    />
                  </label>
                </div>
              </RowCard>
            )}

            {step === 4 && (
              <>
                <div className="space-y-3">
                  {[
                    `Supply: ${form.supply} tokens · Price: ${form.sharePrice} USDC`,
                    `Tiers: ${form.tiers
                      .map((t, i) => `T${i} ${t.threshold === "" ? "∞" : t.threshold}`)
                      .join(" → ")}`,
                    `End: ${form.expTime || "no date"}${form.endCap ? ` · cap ${form.endCap} USDC` : ""}`,
                    `Access: ${form.accessMode} · Claim window: ${form.claimWindowDays} days`,
                    `Depositor: ${form.depositor} · Admin: ${form.complianceAdmin}`,
                  ].map((row, i) => (
                    <RowCard key={i} className="flex items-center gap-4 text-text-on-light">
                      <Chip>N° 0{i + 1}</Chip>
                      <span className="text-base">{row}</span>
                    </RowCard>
                  ))}
                </div>

                {/* Disclosures (§11) — must be acknowledged */}
                <div className="mt-6 rounded-card border border-amber-500/40 bg-amber-500/10 p-5">
                  <span className="mono-label text-amber-500">
                    ABOUT THIS AGREEMENT — READ BEFORE CREATING
                  </span>
                  <ul className="mt-3 space-y-3">
                    {DISCLOSURES.map(([title, body], i) => (
                      <li key={i} className="flex gap-3">
                        <input
                          type="checkbox"
                          checked={ack[i]}
                          onChange={(e) =>
                            setAck((a) => a.map((x, j) => (j === i ? e.target.checked : x)))
                          }
                          className="mt-1 h-4 w-4 accent-[#6D45FE]"
                          aria-label={`Acknowledge: ${title}`}
                        />
                        <span className="text-sm text-text-on-light">
                          <strong className="font-medium">{title}</strong> {body}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

                <Button
                  className="mt-6 w-full sm:w-auto"
                  disabled={!canSubmit}
                  onClick={submit}
                >
                  Create agreement
                </Button>
                {!canSubmit && (
                  <p className="mt-2 text-sm text-text-muted-light">
                    {tierError ?? rolesError ?? endError ?? "Acknowledge all five disclosures to continue."}
                  </p>
                )}
              </>
            )}

            {/* Nav */}
            <div className="flex justify-between pt-2">
              <button
                className="mono-label text-text-muted-light hover:text-text-on-light disabled:opacity-30"
                disabled={step === 0}
                onClick={() => setStep((s) => s - 1)}
              >
                ← BACK
              </button>
              {step < 4 && (
                <button
                  className="mono-label text-purple-500 hover:underline disabled:opacity-30"
                  disabled={
                    (step === 1 && !!tierError) ||
                    (step === 2 && !!endError) ||
                    (step === 3 && !!rolesError)
                  }
                  onClick={() => setStep((s) => s + 1)}
                >
                  CONTINUE →
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: binary panel → live terms preview */}
        <div className="relative hidden min-h-[600px] overflow-hidden rounded-panel lg:block">
          <BinaryPanel className="absolute inset-0" />
          <div className="absolute inset-x-5 top-5 rounded-card bg-white p-5 shadow-none">
            <span className="mono-label text-text-muted-light">LIVE TERMS PREVIEW</span>
            <div className="mt-3 space-y-2.5">
              {[
                ["Name", form.name || "—"],
                ["Supply", `${form.supply || "0"} tokens`],
                ["Price", `${form.sharePrice || "0"} USDC`],
                ["Tiers", `${form.tiers.length}`],
                ["Cap", form.endCap ? `${form.endCap} USDC` : "—"],
                ["Expiry", form.expTime || "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-purple-500/10 pb-2">
                  <span className="mono-label text-text-muted-light">{String(k).toUpperCase()}</span>
                  <span className="mono-data text-text-on-light">{v}</span>
                </div>
              ))}
            </div>
            <div className="mono-label mt-4 text-purple-500">
              ONE TRANSACTION · SEVEN STEPS
            </div>
          </div>
        </div>
      </div>

      <TxDrawer
        open={showChecklist}
        onClose={() => setShowChecklist(false)}
        title="initialize_agreement"
        stage={stage}
        checklist={checks}
        computeUnits={412_000}
        logs={["Program log: agreement created", "Program log: mint authority revoked"]}
      />
    </div>
  );
}
