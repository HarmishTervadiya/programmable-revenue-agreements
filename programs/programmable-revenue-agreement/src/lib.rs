pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2iEFwZ8qPjvEfSAtHqE7G7apQo9tVKFsiLrdAFC5sXop");

#[program]
pub mod programmable_revenue_agreement {
    use super::*;

    pub fn expire_agreement(ctx: Context<ExpireAgreement>) -> Result<()> {
        ctx.accounts.expire()
    }

    pub fn freeze_position(ctx: Context<FreezePosition>) -> Result<()> {
        ctx.accounts.freeze()
    }

    pub fn unfreeze_position(ctx: Context<UnfreezePosition>) -> Result<()> {
        ctx.accounts.unfreeze()
    }

    pub fn claim_tier_share(ctx: Context<ClaimTierShare>) -> Result<()> {
        ctx.accounts.claim()
    }

    pub fn initialize_agreement(
        ctx: Context<InitializeAgreement>,
        agreement_id: u64,
        supply: u64,
        share_price: u64,
        access_mode: AccessMode,
        tiers: Vec<TierInput>,
        start_time: Option<i64>,
        exp_time: Option<i64>,
        end_cap: Option<u64>,
        depositor: Pubkey,
        compliance_admin: Pubkey,
        payment_destination: Pubkey,
    ) -> Result<()> {
        let config_bump = ctx.bumps.agreement_config;
        let vault_bump = ctx.bumps.vault;
        ctx.accounts.initialize(
            agreement_id,
            supply,
            share_price,
            access_mode,
            tiers,
            start_time,
            exp_time,
            end_cap,
            depositor,
            compliance_admin,
            payment_destination,
            config_bump,
            vault_bump,
        )
    }
}
