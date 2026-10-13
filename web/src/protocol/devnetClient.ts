import type { ProtocolClient, ProtocolListener, TxResult } from "./client";
import { NotImplementedError, type AgreementState, type Persona, type ProtocolMode, type SubmitParams } from "./types";

/**
 * Devnet seam. Until wiring lands, every call explains itself and points
 * back to mock mode. PDA seeds (program lib/state):
 *
 *   agreement  = ["agreement", creator, agreement_id_le_bytes]
 *   tier       = ["tier", agreement_pda, tier_index_le_u16]
 *   claim      = ["claim", agreement_pda, holder_pubkey]
 *   vault      = ["vault", agreement_pda]
 *   treasury   = ["treasury", agreement_pda]
 *
 * Real flow: read state via getProgramAccount + anchor.coder, then send
 * signed transactions through the connected wallet adapter — the stage
 * machine maps wallet-signature waits onto the same TxPhase events the
 * mock emits (building → awaiting-signature → confirming → confirmed).
 */
export class DevnetClient implements ProtocolClient {
  readonly mode: ProtocolMode = "devnet";

  now(): Promise<number> {
    return Promise.resolve(Math.floor(Date.now() / 1000));
  }

  async getState(): Promise<AgreementState | null> {
    throw new NotImplementedError("Reading devnet state");
  }

  async submit(_params: SubmitParams): Promise<TxResult> {
    throw new NotImplementedError("Submitting to devnet");
  }

  async advanceDays(): Promise<number> {
    throw new NotImplementedError("Clock control on devnet (chain time is real)");
  }

  async reset(_personas: Persona[]): Promise<void> {
    throw new NotImplementedError("Resetting a devnet agreement");
  }

  subscribe(_listener: ProtocolListener): () => void {
    throw new NotImplementedError("Subscribing to devnet updates");
  }
}
