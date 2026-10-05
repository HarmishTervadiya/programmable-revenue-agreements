use anchor_lang::prelude::*;

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
    pub mint: Pubkey,
    pub payment_mint: Pubkey,
    pub depositor: Pubkey,
    pub compliance_admin: Pubkey,
    pub supply: u64,
    pub share_price: u64,
    pub access_mode: AccessMode,
    pub tier_count: u8,
    pub start_time: Option<i64>,
    pub exp_time: Option<i64>,
    pub end_cap: Option<u64>,
    pub total_deposited: u64, // only increases
    pub shares_sold: u64,     // terms lock once > 0
    pub status: AgreementStatus,
    pub bump: u8,
}
