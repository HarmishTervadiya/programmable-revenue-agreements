import type { PersistStorage } from "zustand/middleware";

const BIG = "__bigint__";

/** JSON.stringify replacer: bigint → { __bigint__: "123" } (USDC amounts are bigint). */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { [BIG]: value.toString() } : value;
}

/** JSON.parse reviver: { __bigint__: "123" } → 123n. */
export function bigintReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && BIG in (value as Record<string, unknown>)) {
    return BigInt((value as Record<string, string>)[BIG] as string);
  }
  return value;
}

/**
 * localStorage-backed PersistStorage that survives bigint fields.
 * Storage failures (private mode, quota) are swallowed — the demo
 * simply keeps running in-memory for the session.
 */
export function bigintSafeStorage<T>(fallbackName: string): PersistStorage<T> {
  return {
    getItem: (key) => {
      try {
        const raw = globalThis.localStorage?.getItem(key ?? fallbackName);
        if (!raw) return null;
        return JSON.parse(raw, bigintReviver) as { state: T; version: number };
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        globalThis.localStorage?.setItem(
          key ?? fallbackName,
          JSON.stringify(value, bigintReplacer),
        );
      } catch {
        /* quota / private mode — keep going in-memory */
      }
    },
    removeItem: (key) => {
      try {
        globalThis.localStorage?.removeItem(key ?? fallbackName);
      } catch {
        /* ignore */
      }
    },
  };
}
