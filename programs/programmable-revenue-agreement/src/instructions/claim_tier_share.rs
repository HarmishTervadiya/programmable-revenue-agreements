use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    error::PraErrorCode, AgreementConfig, ClaimRecord, TierState, AGREEMENT_SEED, CLAIM_SEED,
    PRECISION, TIER_SEED,
};

#[derive(Accounts)]
pub struct ClaimTierShare<'info> {
    pub holder: Signer<'info>,

    pub agreement_config: Box<Account<'info, AgreementConfig>>,

    #[account(address = agreement_config.share_mint)]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(address = agreement_config.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        token::mint = share_mint,
        token::authority = holder,
    )]
    pub holder_share_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = holder,
    )]
    pub holder_usdc_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = agreement_config.vault,
        token::mint = payment_mint,
        token::authority = agreement_config,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [CLAIM_SEED, agreement_config.key().as_ref(), holder.key().as_ref()],
        bump,
        constraint = !claim_record.frozen @ PraErrorCode::FrozenPosition,
        constraint = claim_record.config == agreement_config.key() @ ErrorCode::ConstraintSeeds,
        constraint = claim_record.holder == holder.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub claim_record: Box<Account<'info, ClaimRecord>>,

    #[account(
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[0]],
        bump,
        constraint = tier0.agreement == agreement_config.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub tier0: Box<Account<'info, TierState>>,
    #[account(
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[1]],
        bump,
        constraint = tier1.agreement == agreement_config.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub tier1: Box<Account<'info, TierState>>,
    #[account(
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[2]],
        bump,
        constraint = tier2.agreement == agreement_config.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub tier2: Box<Account<'info, TierState>>,
    #[account(
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[3]],
        bump,
        constraint = tier3.agreement == agreement_config.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub tier3: Box<Account<'info, TierState>>,
    #[account(
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[4]],
        bump,
        constraint = tier4.agreement == agreement_config.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub tier4: Box<Account<'info, TierState>>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> ClaimTierShare<'info> {
    pub fn claim(&mut self) -> Result<()> {
        let tiers = [
            &self.tier0,
            &self.tier1,
            &self.tier2,
            &self.tier3,
            &self.tier4,
        ];
        let count = self.agreement_config.tier_count as usize;
        let balance = self.holder_share_ata.amount as u128;

        let mut acc_now = [0u128; 5];
        for (i, tier) in tiers.iter().enumerate().take(count) {
            acc_now[i] = tier.acc_per_token;
        }

        let mut payout: u64 = 0;
        for i in 0..count {
            let delta = acc_now[i]
                .checked_sub(self.claim_record.last_acc[i])
                .ok_or(PraErrorCode::MathOverflow)?;
            let earned = balance
                .checked_mul(delta)
                .ok_or(PraErrorCode::MathOverflow)?
                .checked_div(PRECISION)
                .ok_or(PraErrorCode::MathOverflow)? as u64;
            payout = payout
                .checked_add(earned)
                .ok_or(PraErrorCode::MathOverflow)?
                .checked_add(self.claim_record.pending[i])
                .ok_or(PraErrorCode::MathOverflow)?;
        }
        require!(payout > 0, PraErrorCode::NothingToClaim);
        require!(
            payout <= self.vault.amount,
            PraErrorCode::InsufficientVaultFunds
        );

        for i in 0..count {
            self.claim_record.last_acc[i] = acc_now[i];
            self.claim_record.pending[i] = 0;
        }

        let bump_seed = [self.agreement_config.config_bump];
        let agreement_id_bytes = self.agreement_config.agreement_id.to_le_bytes();
        let config_seeds: &[&[u8]] = &[
            AGREEMENT_SEED,
            self.agreement_config.creator.as_ref(),
            &agreement_id_bytes,
            &bump_seed,
        ];
        let signer_seeds = &[config_seeds];
        let cpi = CpiContext::new_with_signer(
            self.token_program.key(),
            anchor_spl::token_interface::TransferChecked {
                from: self.vault.to_account_info(),
                to: self.holder_usdc_ata.to_account_info(),
                mint: self.payment_mint.to_account_info(),
                authority: self.agreement_config.to_account_info(),
            },
            signer_seeds,
        );
        anchor_spl::token_interface::transfer_checked(cpi, payout, self.payment_mint.decimals)?;
        Ok(())
    }
}
