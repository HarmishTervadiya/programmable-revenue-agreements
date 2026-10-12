/**
 * Vitest setup — minimal browser shims so React screens render under node.
 * Skipped when a real DOM exists (jsdom environment).
 * Runs before each test file's imports (setupFiles).
 */
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.document === "undefined") {
  const classList = {
    add() {},
    remove() {},
    toggle() {},
    contains: () => false,
  };

  (globalThis as Record<string, unknown>).document = {
    documentElement: { classList, style: {}, setAttribute() {} },
    head: { appendChild() {}, removeChild() {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({
      style: {},
      setAttribute() {},
      appendChild() {},
      remove() {},
      addEventListener() {},
    }),
    addEventListener() {},
    removeEventListener() {},
  };

  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).addEventListener = () => {};
  (globalThis as Record<string, unknown>).removeEventListener = () => {};
  (globalThis as Record<string, unknown>).dispatchEvent = () => true;
  (globalThis as Record<string, unknown>).matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });

  (globalThis as Record<string, unknown>).localStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
}
