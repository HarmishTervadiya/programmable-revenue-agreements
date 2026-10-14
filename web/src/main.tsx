import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import "@solana/wallet-adapter-react-ui/styles.css";
import "@/styles/base.css";
import { App } from "@/App";

// Solana SDKs (@solana/web3.js, @solana/spl-token) expect a global Buffer.
if (!(globalThis as Record<string, unknown>).Buffer) {
  (globalThis as Record<string, unknown>).Buffer = Buffer;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
