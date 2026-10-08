use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{ThawAccount, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{error::PraErrorCode, AgreementConfig, ClaimRecord, AGREEMENT_SEED, CLAIM_SEED};

#[derive(Accounts)]
pub struct UnfreezePosition<'info> {
    #[account(address = agreement_config.compliance_admin @ PraErrorCode::UnauthorizedComplianceAdmin)]
    pub compliance_admin: Signer<'info>,

    #[account(
        seeds = [AGREEMENT_SEED, agreement_config.creator.as_ref(), &agreement_config.agreement_id.to_le_bytes()],
        bump = agreement_config.config_bump,
    )]
    pub agreement_config: Box<Account<'info, AgreementConfig>>,

    #[account(
        address = agreement_config.share_mint,
        mint::freeze_authority = agreement_config,
        mint::token_program = token_2022_program,
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = share_mint,
        token::authority = claim_record.holder,
        token::token_program = token_2022_program,
    )]
    pub holder_share_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [CLAIM_SEED, agreement_config.key().as_ref(), claim_record.holder.as_ref()],
        bump = claim_record.bump,
        constraint = claim_record.config == agreement_config.key() @ ErrorCode::ConstraintSeeds,
        constraint = claim_record.frozen @ PraErrorCode::PositionAlreadyUnfrozen,
    )]
    pub claim_record: Box<Account<'info, ClaimRecord>>,

    pub token_2022_program: Program<'info, Token2022>,
}

impl<'info> UnfreezePosition<'info> {
    pub fn unfreeze(&mut self) -> Result<()> {
        let agreement_id_bytes = self.agreement_config.agreement_id.to_le_bytes();
        let bump_seed = [self.agreement_config.config_bump];
        let config_seeds: &[&[u8]] = &[
            AGREEMENT_SEED,
            self.agreement_config.creator.as_ref(),
            &agreement_id_bytes,
            &bump_seed,
        ];
        let signer_seeds = &[config_seeds];
        let cpi = CpiContext::new_with_signer(
            self.token_2022_program.key(),
            ThawAccount {
                account: self.holder_share_ata.to_account_info(),
                mint: self.share_mint.to_account_info(),
                authority: self.agreement_config.to_account_info(),
            },
            signer_seeds,
        );
        anchor_spl::token_2022::thaw_account(cpi)?;
        // Record the change only after Token-2022 accepts the PDA-signed CPI.
        self.claim_record.frozen = false;
        Ok(())
    }
}
