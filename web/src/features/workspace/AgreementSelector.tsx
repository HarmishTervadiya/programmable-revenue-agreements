import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useProtocol } from "@/protocol";
import { DevnetClient, type AgreementSummary } from "@/protocol/devnetClient";
import { truncAddress } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/chip";
import { useUi } from "@/state/ui";

function shortId(id: bigint): string {
  const s = id.toString();
  return `#${s.slice(-6)}`;
}

function roleOf(s: AgreementSummary, wallet: string | null): string | null {
  if (!wallet) return null;
  if (s.creator === wallet) return "CREATOR";
  if (s.depositor === wallet) return "DEPOSITOR";
  if (s.complianceAdmin === wallet) return "ADMIN";
  return "VIEWER";
}

/**
 * Devnet agreement discovery: named cards with on-chain status, your role
 * relative to the connected wallet, live search, newest-first. Mock mode
 * hides it (the mock holds a single in-memory agreement).
 */
export function AgreementSelector() {
  const client = useProtocol();
  const { publicKey } = useWallet();
  const setStep = useUi((s) => s.setStep);
  const [items, setItems] = useState<AgreementSummary[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const isDevnet = client instanceof DevnetClient;

  const reload = async () => {
    if (!isDevnet) return;
    const dev = client as DevnetClient;
    setLoading(true);
    setError(null);
    try {
      const list = await dev.listAgreements();
      setItems(list);
      setActive(dev.activeConfig?.toBase58() ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const addr = it.address.toBase58().toLowerCase();
      return (
        addr.includes(q) ||
        it.agreementId.toString().includes(q) ||
        (it.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, query]);

  if (!isDevnet) return null;
  const dev = client as DevnetClient;
  const wallet = publicKey?.toBase58() ?? null;

  const select = (addr: string | null) => {
    try {
      dev.setActiveConfig(addr ? new PublicKey(addr) : null);
      setActive(addr);
      void reload();
    } catch {
      setError("That address is not a valid Solana address.");
    }
  };

  return (
    <div className="rounded-panel border border-[var(--border-subtle)] bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="mono-label text-xs font-bold tracking-wider text-secondary">AGREEMENTS</span>
        <button
          onClick={() => void reload()}
          disabled={loading}
          className="mono-label text-xs font-semibold text-secondary hover:text-primary disabled:opacity-60"
        >
          {loading ? "LOADING…" : "↻ REFRESH"}
        </button>
      </div>

      <Button
        variant="secondary"
        onClick={() => {
          // Start truly fresh: drop the selected agreement so the create
          // form appears instead of the "Agreement created" state.
          select(null);
          setStep("create");
        }}
        className="mt-3 h-11 w-full text-xs"
      >
        + New agreement
      </Button>

      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const v = query.trim();
          if (!v) return;
          try {
            select(new PublicKey(v).toBase58());
            setQuery("");
          } catch {
            // Not an address — leave the live filter applied.
          }
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, id, or paste address…"
          spellCheck={false}
          aria-label="Search agreements or paste an agreement address"
          className="mono-data min-w-0 w-full rounded-md border border-purple-500/20 bg-surface px-3 py-2 text-xs text-primary outline-none placeholder:text-secondary focus:border-accent"
        />
      </form>

      {error && (
        <p className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs font-medium text-danger" role="alert">
          {error.slice(0, 220)}
        </p>
      )}

      {items.length === 0 && !loading && !error && (
        <p className="mt-3 text-sm text-secondary">No agreements found on devnet yet. Create the first one.</p>
      )}

      {filtered.length === 0 && items.length > 0 && !loading && (
        <p className="mt-3 text-sm text-secondary">No agreements match “{query.trim()}”.</p>
      )}

      {loading && items.length === 0 && !error && (
        <ul className="mt-3 space-y-2" aria-label="Loading agreements">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              aria-hidden
              className="rounded-xl border border-[var(--border-subtle)] p-3 motion-safe:animate-pulse"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="h-4 w-2/3 rounded-md bg-surface-inset" />
                <span className="h-5 w-16 rounded-full bg-surface-inset" />
              </span>
              <span className="mono-label mt-2 block h-3 w-1/2 rounded bg-surface-inset" />
            </li>
          ))}
        </ul>
      )}

      {filtered.length > 0 && (
        <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          {filtered.map((it) => {
            const addr = it.address.toBase58();
            const on = addr === active;
            const role = roleOf(it, wallet);
            return (
              <li key={addr}>
                <button
                  onClick={() => select(addr)}
                  aria-pressed={on}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition-colors",
                    on
                      ? "border-accent bg-purple-50 ring-1 ring-purple-500/40"
                      : "border-[var(--border-subtle)] bg-surface hover:border-accent",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-primary">
                      {it.name ?? `Agreement ${shortId(it.agreementId)}`}
                    </span>
                    <StatusPill status={it.status} />
                  </span>
                  <span className="mono-label mt-1.5 flex items-center justify-between gap-2 text-xs text-secondary">
                    <span className="tnum">{shortId(it.agreementId)} · {truncAddress(addr)}</span>
                    {role && (
                      <span className={cn("shrink-0 font-semibold", role === "CREATOR" ? "text-accent" : "text-secondary")}>
                        {role}{on ? " · OPEN" : ""}
                      </span>
                    )}
                    {!role && on && <span className="shrink-0 font-semibold text-accent">OPEN</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {active && (
        <button
          onClick={() => select(null)}
          className="mono-label mt-3 text-xs font-medium text-secondary underline-offset-4 hover:text-primary hover:underline"
        >
          Clear selection (start fresh)
        </button>
      )}
    </div>
  );
}
