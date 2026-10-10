use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    error::PraErrorCode, AgreementConfig, AgreementStatus, TierState, AGREEMENT_SEED,
    DUST_ALLOWANCE, EXTRA_METAS, TIER_SEED, TREASURY_SEED, VAULT_SEED,
};

#[derive(Accounts)]
pub struct CloseAgreement<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        close = creator,
        seeds = [AGREEMENT_SEED, agreement_config.creator.as_ref(), &agreement_config.agreement_id.to_le_bytes()],
        bump = agreement_config.config_bump,
        has_one = creator @ PraErrorCode::UnauthorizedCreator,
        constraint = matches!(agreement_config.status, AgreementStatus::Expired) @ PraErrorCode::AgreementNotExpired,
    )]
    pub agreement_config: Box<Account<'info, AgreementConfig>>,

    #[account(
        address = agreement_config.payment_mint,
        mint::token_program = payment_token_program,
    )]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        address = agreement_config.payment_destination,
        token::mint = payment_mint,
        token::authority = creator,
        token::token_program = payment_token_program,
    )]
    pub payment_destination: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = agreement_config.vault,
        seeds = [VAULT_SEED, agreement_config.key().as_ref()],
        bump = agreement_config.vault_bump,
        token::mint = payment_mint,
        token::authority = agreement_config,
        token::token_program = payment_token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        address = agreement_config.share_mint,
        mint::token_program = token_2022_program,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        address = agreement_config.treasury,
        seeds = [TREASURY_SEED, agreement_config.key().as_ref()],
        bump = agreement_config.treasury_bump,
        token::mint = share_mint,
        token::authority = agreement_config,
        token::token_program = token_2022_program,
        constraint = treasury.amount == 0 @ PraErrorCode::TreasuryNotEmpty,
    )]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, close = creator)]
    pub tier0: Box<Account<'info, TierState>>,

    #[account(mut, close = creator)]
    pub tier1: Box<Account<'info, TierState>>,

    #[account(mut, close = creator)]
    pub tier2: Box<Account<'info, TierState>>,

    #[account(mut, close = creator)]
    pub tier3: Box<Account<'info, TierState>>,

    #[account(mut, close = creator)]
    pub tier4: Box<Account<'info, TierState>>,

    /// CHECK: Program-owned raw TLV account, authenticated by its mint-derived PDA.
    #[account(
        mut,
        seeds = [EXTRA_METAS, share_mint.key().as_ref()],
        bump,
        owner = crate::ID,
    )]
    pub extra_metas: UncheckedAccount<'info>,

    pub payment_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
}

impl<'info> CloseAgreement<'info> {
    pub fn close(&mut self) -> Result<()> {
        // Keep repeated tier PDA validation out of Anchor's generated account
        // parser so its SBF stack frame stays below the 4 KiB limit.
        for (i, tier) in [
            &self.tier0,
            &self.tier1,
            &self.tier2,
            &self.tier3,
            &self.tier4,
        ]
        .into_iter()
        .enumerate()
        {
            validate_tier(tier, self.agreement_config.key(), i as u8)?;
        }

        let now = Clock::get()?.unix_timestamp;
        let deadline_elapsed = self
            .agreement_config
            .claim_deadline
            .is_some_and(|deadline| now >= deadline);
        require!(
            self.vault.amount <= DUST_ALLOWANCE || deadline_elapsed,
            PraErrorCode::ClaimWindowStillOpen
        );

        let creator_key = self.agreement_config.creator;
        let agreement_id = self.agreement_config.agreement_id.to_le_bytes();
        let bump = [self.agreement_config.config_bump];
        let seeds: &[&[u8]] = &[AGREEMENT_SEED, creator_key.as_ref(), &agreement_id, &bump];
        let signer_seeds = &[seeds];

        let remaining = self.vault.amount;
        if remaining > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    self.payment_token_program.key(),
                    TransferChecked {
                        from: self.vault.to_account_info(),
                        to: self.payment_destination.to_account_info(),
                        mint: self.payment_mint.to_account_info(),
                        authority: self.agreement_config.to_account_info(),
                    },
                    signer_seeds,
                ),
                remaining,
                self.payment_mint.decimals,
            )?;
            self.vault.reload()?;
        }
        require!(self.vault.amount == 0, PraErrorCode::VaultNotEmpty);

        // Token accounts must be closed by their owning token program, while the
        // config is still live and can supply the PDA authority for both CPIs.
        for (account, program) in [
            (
                self.vault.to_account_info(),
                self.payment_token_program.key(),
            ),
            (
                self.treasury.to_account_info(),
                self.token_2022_program.key(),
            ),
        ] {
            token_interface::close_account(CpiContext::new_with_signer(
                program,
                CloseAccount {
                    account,
                    destination: self.creator.to_account_info(),
                    authority: self.agreement_config.to_account_info(),
                },
                signer_seeds,
            ))?;
        }

        // ExtraAccountMetaList has no Anchor discriminator and cannot use a
        // typed Account close constraint. Mirror Anchor's raw-account close:
        // checked rent transfer, zero lamports, System ownership, empty data.
        let extra = self.extra_metas.to_account_info();
        self.creator.add_lamports(extra.lamports())?;
        **extra.try_borrow_mut_lamports()? = 0;
        extra.assign(&anchor_lang::system_program::ID);
        extra.resize(0)?;

        // Anchor closes all five TierStates and AgreementConfig on successful
        // exit. The entitlement mint and holder ClaimRecords are never closed.
        Ok(())
    }
}

#[inline(never)]
fn validate_tier(tier: &Account<TierState>, config: Pubkey, index: u8) -> Result<()> {
    let (expected, bump) =
        Pubkey::find_program_address(&[TIER_SEED, config.as_ref(), &[index]], &crate::ID);
    require_keys_eq!(tier.key(), expected, ErrorCode::ConstraintSeeds);
    require_keys_eq!(tier.agreement, config, ErrorCode::ConstraintSeeds);
    require_eq!(tier.tier_index, index, ErrorCode::ConstraintSeeds);
    require_eq!(tier.bump, bump, ErrorCode::ConstraintSeeds);
    Ok(())
}
