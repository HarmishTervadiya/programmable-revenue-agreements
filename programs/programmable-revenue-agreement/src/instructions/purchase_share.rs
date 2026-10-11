use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{spl_token_2022::state::AccountState, Approve, ThawAccount, Token2022},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    error::PraErrorCode, AccessMode, AgreementConfig, AgreementStatus, ClaimRecord, TierState,
    AGREEMENT_SEED, CLAIM_SEED, MAX_TIERS, TIER_SEED,
};

#[derive(Accounts)]
pub struct PurchaseShare<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut)]
    pub agreement_config: Box<Account<'info, AgreementConfig>>,

    #[account(address = agreement_config.share_mint)]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(address = agreement_config.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = share_mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_2022_program,
    )]
    pub buyer_share_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = buyer,
        token::token_program = token_program,
    )]
    pub buyer_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = agreement_config.payment_destination,
        token::mint = payment_mint,
        token::token_program = token_program,
    )]
    pub payment_destination: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = agreement_config.treasury,
        token::mint = share_mint,
        token::authority = agreement_config,
        token::token_program = token_2022_program,
    )]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + ClaimRecord::INIT_SPACE,
        seeds = [CLAIM_SEED, agreement_config.key().as_ref(), buyer.key().as_ref()],
        bump,
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
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> PurchaseShare<'info> {
    pub fn purchase(&mut self, amount: u64, claim_bump: u8) -> Result<()> {
        require!(
            matches!(self.agreement_config.status, AgreementStatus::Active),
            PraErrorCode::AgreementNotActive
        );
        if let Some(start) = self.agreement_config.start_time {
            require!(
                Clock::get()?.unix_timestamp >= start,
                PraErrorCode::SaleNotStarted
            );
        }
        // MVP is Open-only, no allowlist entries exist yet.
        require!(
            matches!(self.agreement_config.access_mode, AccessMode::Open),
            PraErrorCode::AccessDenied
        );
        require!(amount > 0, PraErrorCode::InvalidAmount);
        require!(
            self.treasury.amount >= amount,
            PraErrorCode::InsufficientTreasuryShares
        );

        // New buyer starts at current accumulators. The token leg runs as a
        // second top-level instruction in the same tx (hook settles there).
        if self.claim_record.holder == Pubkey::default() {
            let tiers = [
                &self.tier0,
                &self.tier1,
                &self.tier2,
                &self.tier3,
                &self.tier4,
            ];
            let mut last_acc = [0u128; MAX_TIERS];
            let count = self.agreement_config.tier_count as usize;
            for (i, tier) in tiers.iter().enumerate().take(count) {
                last_acc[i] = tier.acc_per_token;
            }
            self.claim_record.set_inner(ClaimRecord {
                config: self.agreement_config.key(),
                holder: self.buyer.key(),
                last_acc,
                pending: [0u64; MAX_TIERS],
                frozen: false,
                bump: claim_bump,
            });
        } else {
            require_keys_eq!(
                self.claim_record.config,
                self.agreement_config.key(),
                ErrorCode::ConstraintSeeds
            );
            require_keys_eq!(
                self.claim_record.holder,
                self.buyer.key(),
                ErrorCode::ConstraintSeeds
            );
            require!(!self.claim_record.frozen, PraErrorCode::FrozenPosition);
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

        // Buyer ATAs are born frozen, thaw once.
        if self.buyer_share_account.state == AccountState::Frozen {
            let cpi = CpiContext::new_with_signer(
                self.token_2022_program.key(),
                ThawAccount {
                    account: self.buyer_share_account.to_account_info(),
                    mint: self.share_mint.to_account_info(),
                    authority: self.agreement_config.to_account_info(),
                },
                signer_seeds,
            );
            anchor_spl::token_2022::thaw_account(cpi)?;
        }

        // USDC goes straight to the creator, never the vault.
        let cost: u64 = u64::try_from(
            (amount as u128)
                .checked_mul(self.agreement_config.share_price as u128)
                .ok_or(PraErrorCode::MathOverflow)?,
        )
        .map_err(|_| PraErrorCode::MathOverflow)?;
        let cpi = CpiContext::new(
            self.token_program.key(),
            anchor_spl::token_interface::TransferChecked {
                from: self.buyer_usdc_account.to_account_info(),
                to: self.payment_destination.to_account_info(),
                mint: self.payment_mint.to_account_info(),
                authority: self.buyer.to_account_info(),
            },
        );
        anchor_spl::token_interface::transfer_checked(cpi, cost, self.payment_mint.decimals)?;

        // Approve, don't transfer: a CPI transfer would reenter the hook
        // (A -> Token-2022 -> A is banned). Client sends the transfer next.
        let approve_cpi = CpiContext::new_with_signer(
            self.token_2022_program.key(),
            Approve {
                to: self.treasury.to_account_info(),
                delegate: self.buyer.to_account_info(),
                authority: self.agreement_config.to_account_info(),
            },
            signer_seeds,
        );
        anchor_spl::token_2022::approve(approve_cpi, amount)?;

        self.agreement_config.shares_sold = self
            .agreement_config
            .shares_sold
            .checked_add(amount)
            .ok_or(PraErrorCode::MathOverflow)?;
        Ok(())
    }
}
