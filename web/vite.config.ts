import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Solana SDKs (@solana/web3.js, @solana/spl-token) import Node builtins
    // like "buffer" — polyfill them so Vite never externalizes them.
    nodePolyfills({ include: ["buffer"], globals: { Buffer: true } }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  define: {
    // Some SDK code references the Node `global` — map it to globalThis.
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["buffer"],
  },
  server: {
    port: 5173,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});
