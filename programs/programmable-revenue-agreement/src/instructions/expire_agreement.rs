use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{Burn, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{error::PraErrorCode, AgreementConfig, AgreementStatus, AGREEMENT_SEED, TREASURY_SEED};

#[derive(Accounts)]
pub struct ExpireAgreement<'info> {
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, agreement_config.creator.as_ref(), &agreement_config.agreement_id.to_le_bytes()],
        bump = agreement_config.config_bump,
        constraint = matches!(agreement_config.status, AgreementStatus::Active) @ PraErrorCode::AgreementNotActive,
    )]
    pub agreement_config: Box<Account<'info, AgreementConfig>>,

    #[account(
        mut,
        address = agreement_config.share_mint,
        mint::token_program = token_2022_program,
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        address = agreement_config.treasury,
        seeds = [TREASURY_SEED, agreement_config.key().as_ref()],
        bump = agreement_config.treasury_bump,
        token::mint = share_mint,
        token::authority = agreement_config,
        token::token_program = token_2022_program,
    )]
    pub treasury: InterfaceAccount<'info, TokenAccount>,

    pub token_2022_program: Program<'info, Token2022>,
}

impl<'info> ExpireAgreement<'info> {
    pub fn expire(&mut self) -> Result<()> {
        let config = &self.agreement_config;
        let now = Clock::get()?.unix_timestamp;
        let time_reached = config.exp_time.is_some_and(|end| now >= end);
        let cap_reached = config
            .end_cap
            .is_some_and(|cap| config.total_deposited >= cap);
        require!(
            time_reached || cap_reached,
            PraErrorCode::EndConditionNotMet
        );

        let claim_deadline = config
            .claim_window
            .map(|window| {
                let seconds = i64::try_from(window).map_err(|_| PraErrorCode::MathOverflow)?;
                now.checked_add(seconds).ok_or(PraErrorCode::MathOverflow)
            })
            .transpose()?;

        let agreement_id_bytes = config.agreement_id.to_le_bytes();
        let bump_seed = [config.config_bump];
        let config_seeds: &[&[u8]] = &[
            AGREEMENT_SEED,
            config.creator.as_ref(),
            &agreement_id_bytes,
            &bump_seed,
        ];
        let signer_seeds = &[config_seeds];

        // Burn the observed unsold balance without invoking the transfer hook.
        // Keep the config PDA as treasury authority for eventual account cleanup.
        let remaining = self.treasury.amount;
        if remaining > 0 {
            anchor_spl::token_2022::burn(
                CpiContext::new_with_signer(
                    self.token_2022_program.key(),
                    Burn {
                        mint: self.share_mint.to_account_info(),
                        from: self.treasury.to_account_info(),
                        authority: config.to_account_info(),
                    },
                    signer_seeds,
                ),
                remaining,
            )?;
        }

        // Future distribution uses this status; existing tier accumulators, holder
        // balances, pending claims and vault funds remain available for claims.
        self.agreement_config.status = AgreementStatus::Expired;
        self.agreement_config.claim_deadline = claim_deadline;
        Ok(())
    }
}
