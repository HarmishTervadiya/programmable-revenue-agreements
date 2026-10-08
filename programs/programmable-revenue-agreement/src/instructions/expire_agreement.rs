use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{spl_token_2022::instruction::AuthorityType, SetAuthority, Token2022},
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

        let agreement_id_bytes = config.agreement_id.to_le_bytes();
        let bump_seed = [config.config_bump];
        let config_seeds: &[&[u8]] = &[
            AGREEMENT_SEED,
            config.creator.as_ref(),
            &agreement_id_bytes,
            &bump_seed,
        ];
        let signer_seeds = &[config_seeds];

        // Return unsold tokens in place: no transfer hook, burn, sale, or vault sweep.
        // The config PDA can no longer authorize purchases from this treasury.
        anchor_spl::token_2022::set_authority(
            CpiContext::new_with_signer(
                self.token_2022_program.key(),
                SetAuthority {
                    account_or_mint: self.treasury.to_account_info(),
                    current_authority: config.to_account_info(),
                },
                signer_seeds,
            ),
            AuthorityType::AccountOwner,
            Some(config.creator),
        )?;

        // Future distribution uses this status; existing tier accumulators, holder
        // balances, pending claims and vault funds remain available for claims.
        self.agreement_config.status = AgreementStatus::Expired;
        Ok(())
    }
}
