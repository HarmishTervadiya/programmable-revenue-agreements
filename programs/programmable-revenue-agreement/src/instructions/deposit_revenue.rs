use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    error::PraErrorCode, AgreementConfig, AgreementStatus, Party, TierState, MAX_BPS, PRECISION,
    TIER_SEED,
};

#[derive(Accounts)]
pub struct DepositRevenue<'info> {
    pub depositor: Signer<'info>,

    #[account(mut)]
    pub agreement_config: Box<Account<'info, AgreementConfig>>,

    #[account(address = agreement_config.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = depositor,
        token::token_program = token_program,
    )]
    pub depositor_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = agreement_config.vault,
        token::mint = payment_mint,
        token::authority = agreement_config,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[0]],
        bump,
        constraint = tier0.agreement == agreement_config.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub tier0: Box<Account<'info, TierState>>,
    #[account(
        mut,
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[1]],
        bump,
        constraint = tier1.agreement == agreement_config.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub tier1: Box<Account<'info, TierState>>,
    #[account(
        mut,
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[2]],
        bump,
        constraint = tier2.agreement == agreement_config.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub tier2: Box<Account<'info, TierState>>,
    #[account(
        mut,
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[3]],
        bump,
        constraint = tier3.agreement == agreement_config.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub tier3: Box<Account<'info, TierState>>,
    #[account(
        mut,
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[4]],
        bump,
        constraint = tier4.agreement == agreement_config.key() @ ErrorCode::ConstraintSeeds,
    )]
    pub tier4: Box<Account<'info, TierState>>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> DepositRevenue<'info> {
    pub fn deposit(&mut self, amount: u64) -> Result<()> {
        require_keys_eq!(
            self.depositor.key(),
            self.agreement_config.depositor,
            PraErrorCode::UnauthorizedDepositor
        );
        require!(
            matches!(self.agreement_config.status, AgreementStatus::Active),
            PraErrorCode::AgreementNotActive
        );
        require!(amount > 0, PraErrorCode::InvalidAmount);

        // Depositor -> vault first; accounting below only splits what arrived.
        let cpi = CpiContext::new(
            self.token_program.key(),
            anchor_spl::token_interface::TransferChecked {
                from: self.depositor_usdc_account.to_account_info(),
                to: self.vault.to_account_info(),
                mint: self.payment_mint.to_account_info(),
                authority: self.depositor.to_account_info(),
            },
        );
        anchor_spl::token_interface::transfer_checked(
            cpi,
            amount,
            self.payment_mint.decimals,
        )?;

        self.run_waterfall(amount)?;

        self.agreement_config.total_deposited = self
            .agreement_config
            .total_deposited
            .checked_add(amount)
            .ok_or(PraErrorCode::MathOverflow)?;
        Ok(())
    }

    /// Fill tiers in order by cumulative deposits. Work scales with the tier
    /// count, never the holder count. The last tier is uncapped (u64::MAX,
    /// enforced at init), so `remaining` always fits and deposits never fail
    /// for size. `end_cap` never trims a deposit — it only arms expiry.
    fn run_waterfall(&mut self, amount: u64) -> Result<()> {
        let supply = self.agreement_config.supply as u128;
        require!(supply > 0, PraErrorCode::InvalidSupply);

        let mut remaining = amount;
        let mut prev_threshold: u64 = 0;
        let count = self.agreement_config.tier_count as usize;

        // Borrowck-friendly: touch one tier at a time via helper.
        for i in 0..count {
            if remaining == 0 {
                // Still advance prev_threshold for correctness of later widths.
                let threshold = Self::threshold_of(
                    &self.tier0,
                    &self.tier1,
                    &self.tier2,
                    &self.tier3,
                    &self.tier4,
                    i,
                );
                prev_threshold = threshold;
                continue;
            }
            let take: u64;
            {
                let tier = Self::tier_mut(
                    &mut self.tier0,
                    &mut self.tier1,
                    &mut self.tier2,
                    &mut self.tier3,
                    &mut self.tier4,
                    i,
                );
                let width = tier
                    .threshold
                    .checked_sub(prev_threshold)
                    .ok_or(PraErrorCode::MathOverflow)?;
                let room = width
                    .checked_sub(tier.filled)
                    .ok_or(PraErrorCode::MathOverflow)?;
                take = remaining.min(room);
                if take > 0 {
                    Self::apply_take(tier, take, supply)?;
                    remaining = remaining
                        .checked_sub(take)
                        .ok_or(PraErrorCode::MathOverflow)?;
                }
                prev_threshold = tier.threshold;
            }
        }
        debug_assert!(remaining == 0);
        Ok(())
    }

    fn threshold_of(
        t0: &TierState,
        t1: &TierState,
        t2: &TierState,
        t3: &TierState,
        t4: &TierState,
        i: usize,
    ) -> u64 {
        match i {
            0 => t0.threshold,
            1 => t1.threshold,
            2 => t2.threshold,
            3 => t3.threshold,
            _ => t4.threshold,
        }
    }

    fn tier_mut<'a>(
        t0: &'a mut Box<Account<'info, TierState>>,
        t1: &'a mut Box<Account<'info, TierState>>,
        t2: &'a mut Box<Account<'info, TierState>>,
        t3: &'a mut Box<Account<'info, TierState>>,
        t4: &'a mut Box<Account<'info, TierState>>,
        i: usize,
    ) -> &'a mut TierState {
        match i {
            0 => t0,
            1 => t1,
            2 => t2,
            3 => t3,
            _ => t4,
        }
    }

    /// acc += take * holders_bps * PRECISION / (10_000 * supply);
    /// Wallet splits accrue `owed += take * bps / 10_000`. Floors on purpose:
    /// dust stays in the vault and it can never owe more than it received.
    fn apply_take(tier: &mut TierState, take: u64, supply: u128) -> Result<()> {
        let mut holders_bps: u64 = 0;
        for s in tier.splits.iter().take(tier.split_count as usize) {
            if matches!(s.party, Party::Holders) {
                holders_bps = holders_bps
                    .checked_add(s.bps as u64)
                    .ok_or(PraErrorCode::MathOverflow)?;
            }
        }
        if holders_bps > 0 {
            let delta = (take as u128)
                .checked_mul(holders_bps as u128)
                .ok_or(PraErrorCode::MathOverflow)?
                .checked_mul(PRECISION)
                .ok_or(PraErrorCode::MathOverflow)?
                .checked_div(MAX_BPS as u128)
                .ok_or(PraErrorCode::MathOverflow)?
                .checked_div(supply)
                .ok_or(PraErrorCode::MathOverflow)?;
            tier.acc_per_token = tier
                .acc_per_token
                .checked_add(delta)
                .ok_or(PraErrorCode::MathOverflow)?;
        }
        for s in tier.splits.iter_mut().take(tier.split_count as usize) {
            if let Party::Wallet(_) = s.party {
                let share = (take as u128)
                    .checked_mul(s.bps as u128)
                    .ok_or(PraErrorCode::MathOverflow)?
                    .checked_div(MAX_BPS as u128)
                    .ok_or(PraErrorCode::MathOverflow)? as u64;
                s.owed = s.owed.checked_add(share).ok_or(PraErrorCode::MathOverflow)?;
            }
        }
        tier.filled = tier
            .filled
            .checked_add(take)
            .ok_or(PraErrorCode::MathOverflow)?;
        Ok(())
    }
}
