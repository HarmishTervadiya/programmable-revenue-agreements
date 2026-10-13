import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  claimableFor,
  fmtUsd,
  partyClaimable,
  useProtocol,
  useProtocolSnapshot,
  type AgreementState,
  type Persona,
} from "@/protocol";
import { PanelShell } from "./CreatePanel";
import { guardSubmit, txBusy } from "./util";

/**
 * Step 04 — claim earnings. A backer claims their tier share; the creator
 * (or any wallet party) claims their cumulative split. Both drains sit on
 * the same vault, both respect the claim window.
 */
export function ClaimPanel({ state, persona }: { state: AgreementState | null; persona: Persona | null }) {
  const client = useProtocol();
  const { tx } = useProtocolSnapshot();
  const [submitting, setSubmitting] = useState(false);

  if (!state || !persona) return null;

  const holderClaim = claimableFor(state, persona.id);
  const isParty = state.tiers.some(
    (t) => t.splits.some((s) => s.party.kind === "wallet" && s.party.address === persona.address),
  );
  const partyOwed = isParty ? partyClaimable(state, persona.address) : 0n;
  const frozen = state.holders.find((h) => h.id === persona.id)?.claim.frozen ?? false;

  const busy = txBusy(tx) || submitting;
  const nothingToClaim =
    state.status === "expired" && holderClaim === 0n && partyOwed === 0n
      ? "Nothing left to claim — the vault has been drained."
      : null;
  const canClaim = holderClaim > 0n || partyOwed > 0n;
  const noActive = state.status !== "active" && state.status !== "expired"
    ? "The agreement is closed — claims are no longer available."
    : null;

  const claimTier = () => {
    if (busy) return;
    setSubmitting(true);
    void guardSubmit(() => client.submit({ ix: "claim_tier_share", holderId: persona.id })).finally(() =>
      setSubmitting(false),
    );
  };

  const claimParty = () => {
    if (busy) return;
    setSubmitting(true);
    void guardSubmit(() => client.submit({ ix: "claim_party_share", partyId: persona.id })).finally(() =>
      setSubmitting(false),
    );
  };

  return (
    <PanelShell title="Claim earnings" hint="Drain the vault into your wallet. Tier shares and party splits are separate instructions.">
      <div className="space-y-4">
        {noActive && <p className="text-sm font-medium text-danger">{noActive}</p>}
        {nothingToClaim && <p className="text-sm font-medium text-amber-900">{nothingToClaim}</p>}
        {frozen && (
          <p className="text-sm font-medium text-danger">
            This position is frozen by the compliance admin — freeze accrues but payout is paused.
          </p>
        )}

        {/* Holder tier share */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-surface-inset p-3.5">
          <span className="mono-label text-xs font-semibold text-secondary">TIER SHARE</span>
          <p className="mt-2 text-sm text-secondary">
            Claimable <span className="mono-data text-sm font-bold text-healthy tnum">{fmtUsd(holderClaim)}</span>
          </p>
          <Button
            onClick={claimTier}
            disabled={holderClaim === 0n || busy || frozen}
            loading={busy}
            className="mt-3 w-full"
          >
            Sign claim_tier_share
          </Button>
          {holderClaim === 0n && !frozen && (
            <p className="mono-label mt-2 text-xs text-secondary">NOTHING TO CLAIM YET — WAIT FOR A DEPOSIT.</p>
          )}
        </div>

        {/* Party wallet split */}
        {isParty && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-surface-inset p-3.5">
            <span className="mono-label text-xs font-semibold text-secondary">PARTY SPLIT (WALLET)</span>
            <p className="mt-2 text-sm text-secondary">
              Cumulative owed <span className="mono-data text-sm font-bold text-healthy tnum">{fmtUsd(partyOwed)}</span>
            </p>
            <Button
              onClick={claimParty}
              disabled={partyOwed === 0n || busy}
              loading={busy}
              className="mt-3 w-full"
            >
              Sign claim_party_share
            </Button>
            {partyOwed === 0n && (
              <p className="mono-label mt-2 text-xs text-secondary">NO SPLIT OWED — WAIT FOR A TIER TO FILL.</p>
            )}
          </div>
        )}

        {!canClaim && !noActive && !nothingToClaim && (
          <p className="mono-label text-xs text-secondary">DEPOSIT REVENUE FIRST (STEP 03) — CLAIMS FOLLOW THE WATERFALL.</p>
        )}
      </div>
    </PanelShell>
  );
}
