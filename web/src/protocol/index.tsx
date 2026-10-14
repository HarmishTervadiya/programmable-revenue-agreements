import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProtocolClient, ProtocolListener, TxProgress } from "./client";
import { DevnetClient } from "./devnetClient";
import { MockClient, type MockClientOptions } from "./mockClient";
import type { AgreementState, LogEntry, ProtocolMode } from "./types";

export * from "./types";
export * from "./client";
export * from "./format";
export * from "./scenarios";
export { mockBase58 } from "./ids";
export { MockClient, type MockClientOptions } from "./mockClient";
export { DevnetClient } from "./devnetClient";

/** VITE_PROTOCOL_MODE=devnet (default) | mock. Mock is for offline dev/tests. */
export function protocolMode(): ProtocolMode {
  const raw = import.meta.env?.VITE_PROTOCOL_MODE as string | undefined;
  return raw === "mock" ? "mock" : "devnet";
}

/** The single swap point: components never construct this themselves. */
export function createProtocolClient(
  mode: ProtocolMode = protocolMode(),
  options?: MockClientOptions,
): ProtocolClient {
  return mode === "devnet" ? new DevnetClient() : new MockClient(options);
}

export interface ProtocolSnapshot {
  state: AgreementState | null;
  log: LogEntry[];
  clock: number;
  version: number;
  /** Live transaction progress while a submit is in flight / just finished. */
  tx: TxProgress | null;
}

interface ProtocolContextValue {
  client: ProtocolClient;
  snapshot: ProtocolSnapshot;
}

const ProtocolCtx = createContext<ProtocolContextValue | null>(null);

const EMPTY: ProtocolSnapshot = { state: null, log: [], clock: 0, version: 0, tx: null };

export function ProtocolProvider({
  client,
  children,
}: {
  client: ProtocolClient;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<ProtocolSnapshot>(EMPTY);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;

    Promise.all([client.getState(), client.now()])
      .then(([state, clock]) => {
        if (!alive) return;
        setSnapshot((s) => ({ ...s, state, clock, log: state?.log ?? [] }));
      })
      .catch(() => {
        /* client not ready — screens show the empty state */
      });

    const listener: ProtocolListener = (event) => {
      if (!alive) return;
      setSnapshot((s) => {
        if (event.type === "tx") return { ...s, tx: event.progress };
        if (event.type === "clock") return { ...s, clock: event.now };
        return { ...s, state: event.state, log: event.log, version: event.version };
      });
    };
    unsubscribe = client.subscribe(listener);

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [client]);

  const value = useMemo(() => ({ client, snapshot }), [client, snapshot]);
  return <ProtocolCtx.Provider value={value}>{children}</ProtocolCtx.Provider>;
}

/** The protocol seam. All instruction I/O goes through this client. */
export function useProtocol(): ProtocolClient {
  const ctx = useContext(ProtocolCtx);
  if (!ctx) throw new Error("useProtocol must be used inside <ProtocolProvider>");
  return ctx.client;
}

/** Reactive read model: agreement state, event log, clock, tx progress. */
export function useProtocolSnapshot(): ProtocolSnapshot {
  const ctx = useContext(ProtocolCtx);
  if (!ctx) throw new Error("useProtocolSnapshot must be used inside <ProtocolProvider>");
  return ctx.snapshot;
}
