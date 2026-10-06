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
    #[msg("Compliance admin cannot be creator")]
    AdminCannotBeCreator,
}
