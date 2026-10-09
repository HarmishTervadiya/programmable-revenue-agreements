use anchor_lang::prelude::*;

use crate::{MAX_SPLITS, MAX_TIERS};

#[derive(InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub enum AccessMode {
    Open,
    Allowlist,
}

#[derive(InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub enum AgreementStatus {
    Active,
    Expired,
    Closed,
}

#[account]
#[derive(InitSpace)]
pub struct AgreementConfig {
    pub agreement_id: u64,
    pub creator: Pubkey,
    pub share_mint: Pubkey,
    pub payment_mint: Pubkey,
    pub depositor: Pubkey,
    pub compliance_admin: Pubkey,
    pub vault:Pubkey,
    pub treasury: Pubkey,
    pub payment_destination: Pubkey,
    pub supply: u64,
    pub share_price: u64,
    pub access_mode: AccessMode,
    pub tier_count: u8,
    pub start_time: Option<i64>,
    pub exp_time: Option<i64>,
    pub end_cap: Option<u64>,
    pub claim_window: Option<u64>,
    pub claim_deadline: Option<i64>,
    pub total_deposited: u64, // only increases
    pub shares_sold: u64,     // terms lock once > 0
    pub status: AgreementStatus,
    pub config_bump: u8,
    pub vault_bump: u8,
    pub treasury_bump: u8
}

#[account]
#[derive(InitSpace)]
pub struct TierState {
    pub agreement: Pubkey,
    pub tier_index: u8,
    pub threshold: u64,
    pub filled: u64,
    pub acc_per_token: u128,
    pub splits: [Split; MAX_SPLITS],
    pub split_count: u8,
    pub bump: u8
}

#[account]
#[derive(InitSpace)]
pub struct ClaimRecord {
    pub config: Pubkey,
    pub holder: Pubkey,
    pub last_acc: [u128; MAX_TIERS],
    pub pending: [u64; MAX_TIERS],
    pub frozen: bool,
    pub bump: u8,
}

#[derive(InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub enum Party {
    Holders,
    Wallet(Pubkey),
}

#[derive(InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct Split {
    pub party: Party,
    pub bps: u16,
    pub owed: u64,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SplitInput {
    pub party: Party,
    pub bps: u16,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct TierInput {
    pub threshold: u64,
    pub splits: Vec<SplitInput>,
}
