import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TopChrome } from "@/features/journey/chrome";
import { RoleSwitcher } from "@/features/journey/stepper";
import { useEnsureAgreement } from "@/features/journey/seed";
import { useTxSequence } from "@/features/journey/use-tx-sequence";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/input";
import { RowCard, StatRow } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { TxDrawer } from "@/components/ui/tx-drawer";
import { useExecute } from "@/lib/execute";
import { useSim } from "@/state/sim";
import { settleTransfer, PRECISION, type ClaimState, type Tier } from "@/lib/math/accumulator";
import { fmtUsdc, fmtTokens } from "@/lib/format";
import { cn } from "@/lib/cn";

const HOOK_CHECKS = [
  "Balances moved (hook fires AFTER the transfer)",
  "Sender pre-transfer balance snapshotted into pending",
  "Receiver pre-transfer balance snapshotted into pending",
  "last_acc synced — no revenue lost crossing the boundary",
];

const cloneClaim = (c: ClaimState): ClaimState => ({
  lastAcc: [...c.lastAcc],
  pending: [...c.pending],
  frozen: c.frozen,
});

/**
 * S6 Transfer proof — mini-lab: Alice → Bob with the hook's before/after
 * snapshot visualised per tier. Deepest technical moment of the demo.
 */
export function TransferLab() {
  useEnsureAgreement();
  const a = useSim((s) => s.agreement);
  const exec = useExecute();
  const { config = "demo" } = useParams();
  const tx = useTxSequence();
  const [seeded, setSeeded] = useState(false);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amountStr, setAmountStr] = useState("40");
  const [error, setError] = useState<string | null>(null);

  // Seed Alice & Bob from the treasury so the lab always has two actors.
  useEffect(() => {
    if (seeded || !a) return;
    const sim = useSim.getState();
    const has = (id: string) => a.holders.some((h) => h.id === id);
    const tryBuy = (id: string, label: string, amt: bigint) => {
      if (has(id)) return;
      try {
        sim.buy(id, label, amt);
      } catch {
        /* treasury or funds too low — lab falls back to existing holders */
      }
    };
    tryBuy("ALICE", "Alice", 150n);
    tryBuy("BOB", "Bob", 250n);
    setSeeded(true);
  }, [a, seeded]);

  useEffect(() => {
    if (!a) return;
    if (!fromId && a.holders.length > 0) setFromId(a.holders[0].id);
    if (!toId && a.holders.length > 1) setToId(a.holders[1].id);
  }, [a, fromId, toId]);

  const holders = a?.holders ?? [];
  const from = holders.find((h) => h.id === fromId);
  const to = holders.find((h) => h.id === toId);
  const amount = BigInt(Math.max(0, Math.floor(Number(amountStr) || 0)));

  /** Pure before/after probe — never mutates the agreement. */
  const diff = useMemo(() => {
    if (!a || !from || !to || from.id === to.id || amount <= 0n) return null;
    if (from.balance < amount) return null;
    const probeFrom = cloneClaim(from.claim);
    const probeTo = cloneClaim(to.claim);
    settleTransfer(probeFrom, from.balance + amount, probeTo, to.balance - amount, a.tiers);
    return { probeFrom, probeTo };
  }, [a, from, to, amount]);

  function send() {
    setError(null);
    if (!from || !to) return setError("Pick two holders.");
    if (from.id === to.id) return setError("Choose two different holders.");
    if (amount <= 0n) return setError("Enter an amount above 0.");
    if (amount > from.balance) return setError(`${from.label} holds only ${from.balance} shares.`);
    try {
      exec.transfer(from.id, from.label, to.id, to.label, amount);
      tx.run(HOOK_CHECKS);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="theme-dark min-h-screen bg-[var(--bg-page)] pb-16 text-white">
      <TopChrome eyebrow="TRANSFER PROOF" invert />
      <div className="flex justify-center px-6">
        <div className="rounded-full bg-ink-950 p-1">
          <RoleSwitcher />
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-[1200px] px-6 md:px-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="font-display"
              style={{ fontSize: "clamp(34px, 4vw, 56px)", lineHeight: 1.03, letterSpacing: "-0.03em" }}
            >
              <span className="text-white">The hook follows</span>{" "}
              <span style={{ color: "var(--color-purple-300)" }}>the token</span>
            </h1>
            <p className="mt-3 max-w-2xl text-text-muted-dark">
              Transfer shares and the program snapshots both accounts into{" "}
              <code className="mono-data text-purple-300">pending</code> using the
              pre-transfer balances — before{" "}
              <code className="mono-data">last_acc</code> can move. Revenue
              crosses the boundary intact.
            </p>
          </div>
          <Chip>transfer_hook</Chip>
        </div>

        {/* Lab controls */}
        <RowCard className="mt-6 border border-white/10 bg-ink-900">
          <div className="flex flex-wrap items-end gap-4">
            <label className="min-w-[160px] flex-1">
              <span className="mono-label text-text-muted-dark">FROM</span>
              <select
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                className="mt-2 h-12 w-full rounded-[14px] border border-white/15 bg-ink-950 px-3 text-sm text-white outline-none focus:border-purple-400"
              >
                {holders.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label} ({fmtTokens(h.balance)})
                  </option>
                ))}
              </select>
            </label>
            <span className="mono-label pb-4 text-purple-300">→</span>
            <label className="min-w-[160px] flex-1">
              <span className="mono-label text-text-muted-dark">TO</span>
              <select
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                className="mt-2 h-12 w-full rounded-[14px] border border-white/15 bg-ink-950 px-3 text-sm text-white outline-none focus:border-purple-400"
              >
                {holders.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label} ({fmtTokens(h.balance)})
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[180px]">
              <span className="mono-label text-text-muted-dark">AMOUNT</span>
              <NumberInput
                className="mt-2"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                suffix="SHARES"
                error={error}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {[10, 40, 100].map((n) => (
              <button
                key={n}
                onClick={() => setAmountStr(String(n))}
                className="mono-label rounded-full border border-white/15 px-3 py-1.5 text-white/70 hover:border-purple-400 hover:text-white"
              >
                {n}
              </button>
            ))}
            <div className="flex-1" />
            <Button onClick={send} disabled={!diff}>
              Transfer shares
            </Button>
          </div>
        </RowCard>

        {/* Per-account before / after diff */}
        {a && from && to && diff && (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <AccountDiff
              title={`${from.label.toUpperCase()} — SENDER`}
              tiers={a.tiers}
              before={{ claim: from.claim, balance: from.balance + amount }}
              after={{ claim: diff.probeFrom, balance: from.balance - amount }}
            />
            <AccountDiff
              title={`${to.label.toUpperCase()} — RECEIVER`}
              tiers={a.tiers}
              before={{ claim: to.claim, balance: to.balance }}
              after={{ claim: diff.probeTo, balance: to.balance + amount }}
            />
          </div>
        )}

        <RowCard className="mt-4 border border-purple-500/30 bg-ink-900">
          <span className="mono-label text-purple-300">
            WORKED EXAMPLE (§9) — WHAT THE HOOK PROVES
          </span>
          <div className="mt-3 sm:grid-cols-3">
            <StatRow label="Alice claims after the boundary" value="1,340.00 USDC" />
            <StatRow label="Bob claims after the boundary" value="160.00 USDC" />
            <StatRow label="Rule" value="pending = pre-balance × Δacc" />
          </div>
        </RowCard>

        <p className="mono-label mt-6 text-text-muted-dark">
          <Link to={`/a/${config}`} className="text-purple-300 underline">
            BACK TO HUB
          </Link>
          {" · HOOK RUNS AFTER BALANCES MOVE · NOTHING IS LOST"}
        </p>
      </div>

      <TxDrawer
        open={tx.open}
        onClose={() => tx.setOpen(false)}
        title="transfer_hook"
        stage={tx.stage}
        checklist={tx.checks}
        computeUnits={58_000}
        logs={[
          "Program log: hook invoked",
          "Program log: pending snapshotted",
          "Program log: last_acc synced",
        ]}
      />
    </div>
  );
}

function AccountDiff({
  title,
  tiers,
  before,
  after,
}: {
  title: string;
  tiers: Tier[];
  before: { claim: ClaimState; balance: bigint };
  after: { claim: ClaimState; balance: bigint };
}) {
  return (
    <RowCard className="border border-white/10 bg-ink-900">
      <div className="flex items-center justify-between">
        <span className="mono-label text-text-muted-dark">{title}</span>
        <span className="mono-label text-purple-300">HOOK SETTLED</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {(
          [
            ["BEFORE", before, false],
            ["AFTER", after, true],
          ] as const
        ).map(([label, state, live]) => (
          <div
            key={label}
            className={cn(
              "rounded-lg p-3",
              live ? "bg-purple-500/10 ring-1 ring-purple-500/40" : "bg-white/5",
            )}
          >
            <span className={cn("mono-label", live ? "text-purple-300" : "text-text-muted-dark")}>
              {label}
            </span>
            <div className="mono-data mt-2 flex items-center justify-between text-sm text-white">
              <span className="text-text-muted-dark">BAL</span>
              <span className="tnum">{fmtTokens(state.balance)}</span>
            </div>
            {tiers.map((_t, i) => {
              const pending = state.claim.pending[i] ?? 0n;
              const prevPending = before.claim.pending[i] ?? 0n;
              const changed = live && pending !== prevPending;
              return (
                <div
                  key={i}
                  className="mono-data mt-1.5 flex items-center justify-between text-sm"
                >
                  <span className="text-text-muted-dark">T{i} pend</span>
                  <span
                    className={cn(
                      "tnum rounded px-1.5 py-0.5 transition-colors",
                      changed ? "bg-purple-500/30 text-purple-200" : "text-white/85",
                    )}
                    title={changed ? `was ${fmtUsdc(prevPending)}` : undefined}
                  >
                    {fmtUsdc(pending)}
                  </span>
                </div>
              );
            })}
            <div className="mono-data mt-1.5 flex items-center justify-between text-sm">
              <span className="text-text-muted-dark">acc × bal</span>
              <span className="tnum text-white">
                {fmtUsdc(claimableOf(state.claim, state.balance, tiers))}
              </span>
            </div>
          </div>
        ))}
      </div>

      <StatRow
        className="mt-3"
        label="last_acc (all tiers)"
        value={after.claim.lastAcc
          .map((x) => (Number(x) / Number(PRECISION)).toFixed(2))
          .join(" · ")}
      />
    </RowCard>
  );
}

function claimableOf(claim: ClaimState, balance: bigint, tiers: Tier[]): bigint {
  return tiers.reduce((sum, t, i) => {
    const delta = t.accPerToken - (claim.lastAcc[i] ?? 0n);
    if (delta < 0n) return sum;
    return sum + (balance * delta) / PRECISION + (claim.pending[i] ?? 0n);
  }, 0n);
}
