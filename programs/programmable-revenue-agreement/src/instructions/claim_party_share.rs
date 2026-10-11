use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    error::PraErrorCode, AgreementConfig, Party, TierState, AGREEMENT_SEED, TIER_SEED,
};

// Wallet-party counterpart to holder claims. Holders accrue per token and
// leave tiers read-only; named wallets accrue `owed` per split, and only
// this instruction (besides deposits) writes tiers — it zeroes what it pays.
#[derive(Accounts)]
pub struct ClaimPartyShare<'info> {
    pub party: Signer<'info>,

    pub agreement_config: Box<Account<'info, AgreementConfig>>,

    #[account(address = agreement_config.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = party,
    )]
    pub party_usdc_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = agreement_config.vault,
        token::mint = payment_mint,
        token::authority = agreement_config,
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

impl<'info> ClaimPartyShare<'info> {
    pub fn claim(&mut self) -> Result<()> {
        let party_key = self.party.key();
        let count = self.agreement_config.tier_count as usize;
        let tiers = [
            &mut self.tier0,
            &mut self.tier1,
            &mut self.tier2,
            &mut self.tier3,
            &mut self.tier4,
        ];

        // Sum this wallet's `owed` across tiers, zeroing as we go so a
        // second claim finds nothing. Other parties' splits stay intact.
        let mut total: u64 = 0;
        let mut matched = false;
        for tier in tiers.into_iter().take(count) {
            let splits = tier.split_count as usize;
            for split in tier.splits.iter_mut().take(splits) {
                if matches!(&split.party, Party::Wallet(w) if w == &party_key) {
                    matched = true;
                    total = total
                        .checked_add(split.owed)
                        .ok_or(PraErrorCode::MathOverflow)?;
                    split.owed = 0;
                }
            }
        }
        require!(matched, PraErrorCode::UnauthorizedParty);
        require!(total > 0, PraErrorCode::NothingToClaim);
        require!(
            total <= self.vault.amount,
            PraErrorCode::InsufficientVaultFunds
        );

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
                to: self.party_usdc_ata.to_account_info(),
                mint: self.payment_mint.to_account_info(),
                authority: self.agreement_config.to_account_info(),
            },
            signer_seeds,
        );
        anchor_spl::token_interface::transfer_checked(cpi, total, self.payment_mint.decimals)?;
        Ok(())
    }
}
