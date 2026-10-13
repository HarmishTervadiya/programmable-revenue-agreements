/**
 * Every program error → a plain sentence + a fix (style guide §10).
 * Never show hex/number codes by default; keep them under technical details.
 */
export interface HumanError {
  message: string;
  fix?: string;
}

const MESSAGES: Record<string, HumanError> = {
  InvalidSupply: { message: "Supply must be above 0.", fix: "Enter a positive supply." },
  InvalidPrice: { message: "Share price must be above 0.", fix: "Enter a positive price." },
  InvalidTierCount: { message: "You need between 1 and 5 tiers.", fix: "Add or remove tiers." },
  ThresholdsNotIncreasing: {
    message: "Each tier's threshold must be higher than the one before it.",
    fix: "Raise this threshold above the previous tier's.",
  },
  LastTierMustBeUncapped: {
    message: "The last tier must have no limit, so every deposit has somewhere to go.",
    fix: "Set the final tier's threshold to Unlimited.",
  },
  InvalidSplitCount: { message: "Each tier needs 1 to 4 splits.", fix: "Remove a split or add another tier." },
  SplitsMustSumTo10000: {
    message: "Splits in a tier must total 100%.",
    fix: "Adjust the split so the bps total 10,000.",
  },
  ExpOrCapRequired: { message: "Set an expiry date, a revenue cap, or both." },
  InvalidClaimWindow: { message: "The claim window must be above 0." },
  AdminCannotBeCreator: {
    message: "The compliance admin can't be the creator.",
    fix: "Choose another wallet.",
  },
  FrozenPosition: {
    message: "This account is frozen by the compliance admin. You can't transfer or claim until it is unfrozen. Your accrued revenue is kept.",
  },
  NothingToClaim: {
    message: "Nothing to claim yet.",
    fix: "You will see earnings after the next deposit.",
  },
  InsufficientVaultFunds: { message: "The vault holds less than this claim." },
  MathOverflow: { message: "That number is too large." },
  MissingClaimRecord: { message: "This wallet has no claim record yet. Buy shares first." },
  InvalidHookState: { message: "The transfer hook was invoked outside a token transfer." },
  UnauthorizedComplianceAdmin: { message: "Only the compliance admin can change freeze state." },
  PositionAlreadyFrozen: { message: "This position is already frozen." },
  PositionAlreadyUnfrozen: { message: "This position is already unfrozen." },
  AgreementNotActive: { message: "This agreement is no longer active." },
  EndConditionNotMet: {
    message: "Neither the expiry time nor the cumulative revenue cap has been reached yet.",
    fix: "Wait for expiry or more deposits.",
  },
  UnauthorizedCreator: { message: "Only the creator can close the agreement." },
  AgreementNotExpired: { message: "Expire the agreement first." },
  ClaimWindowStillOpen: {
    message: "The claim window is still open and the vault still holds funds.",
    fix: "Wait until the claim deadline passes, or until everything is claimed.",
  },
  TreasuryNotEmpty: { message: "The treasury still holds shares. Expire first to burn them." },
  VaultNotEmpty: { message: "The vault still holds USDC. It will return to the creator at close." },
  SaleNotStarted: { message: "The sale has not started yet." },
  AccessDenied: { message: "Access denied: this agreement is allowlist-gated." },
  InsufficientTreasuryShares: { message: "Not enough shares left in the treasury." },
  InvalidAmount: { message: "Enter an amount above 0." },
  UnauthorizedDepositor: {
    message: "Only the designated depositor can add revenue.",
    fix: "Switch to the depositor wallet.",
  },
  UnauthorizedParty: { message: "Signer is not a wallet party in any tier." },
};

export function humanizeError(err: unknown): HumanError {
  // AnchorError from @coral-xyz/anchor
  const anchorErr = err as {
    error?: { errorCode?: { code?: string }; errorMessage?: string };
  };
  const code = anchorErr?.error?.errorCode?.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  const msg = anchorErr?.error?.errorMessage;
  if (msg && MESSAGES[msg]) return MESSAGES[msg];
  return { message: "The transaction failed.", fix: "Check technical details." };
}

export function errorName(err: unknown): string | null {
  const anchorErr = err as { error?: { errorCode?: { code?: string } } };
  return anchorErr?.error?.errorCode?.code ?? null;
}
