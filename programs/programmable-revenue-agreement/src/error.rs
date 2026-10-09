use anchor_lang::prelude::*;

#[error_code]
pub enum PraErrorCode {
    #[msg("Supply must be above zero")]
    InvalidSupply,
    #[msg("Share price must be above zero")]
    InvalidPrice,
    #[msg("Need 1 to 5 tiers")]
    InvalidTierCount,
    #[msg("Thresholds must strictly increase")]
    ThresholdsNotIncreasing,
    #[msg("Last tier must be uncapped (u64::MAX) so revenue never goes stale")]
    LastTierMustBeUncapped,
    #[msg("Each tier needs 1 to 4 splits")]
    InvalidSplitCount,
    #[msg("Each tier splits must sum to 10000 bps")]
    SplitsMustSumTo10000,
    #[msg("Need exp_time or end_cap (or both)")]
    ExpOrCapRequired,
    #[msg("Claim window must be above zero")]
    InvalidClaimWindow,
    #[msg("Compliance admin cannot be creator")]
    AdminCannotBeCreator,
    #[msg("Position is frozen by compliance")]
    FrozenPosition,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Vault holds less than the claim")]
    InsufficientVaultFunds,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Agreement is not active")]
    AgreementNotActive,
    #[msg("Sale has not started yet")]
    SaleNotStarted,
    #[msg("Access denied: agreement is allowlist-gated")]
    AccessDenied,
    #[msg("Treasury holds fewer shares than requested")]
    InsufficientTreasuryShares,
    #[msg("Amount must be above zero")]
    InvalidAmount,
    #[msg("Only the designated depositor can deposit")]
    UnauthorizedDepositor,
}
