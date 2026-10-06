use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::error::PraErrorCode;
use crate::{
    AccessMode, AgreementConfig, AgreementStatus, TierInput, AGREEMENT_SEED, MAX_BPS, MAX_SPLITS,
    MAX_TIERS, TREASURY_SEED, VAULT_SEED,
};

#[derive(Accounts)]
#[instruction(agreement_id: u64)]
pub struct InitializeAgreement<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + AgreementConfig::INIT_SPACE,
        seeds = [AGREEMENT_SEED, creator.key().as_ref(), &agreement_id.to_le_bytes()],
        bump
    )]
    pub agreement_config: Account<'info, AgreementConfig>,

    /// New share mint keypair (Token-2022, created in logic with extensions)
    #[account(mut)]
    pub share_mint: Signer<'info>,

    pub payment_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = creator,
    )]
    pub payment_destination: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, agreement_config.key().as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = agreement_config,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        seeds = [TREASURY_SEED, agreement_config.key().as_ref()],
        bump,
        token::mint = share_mint,
        token::authority = agreement_config,
    )]
    pub treasury: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> InitializeAgreement<'info> {
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
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
        config_bump: u8,
        vault_bump: u8,
        treasury_bump: u8,
    ) -> Result<()> {
        require!(supply > 0, PraErrorCode::InvalidSupply);
        require!(share_price > 0, PraErrorCode::InvalidPrice);
        require!(
            !tiers.is_empty() && tiers.len() <= MAX_TIERS,
            PraErrorCode::InvalidTierCount
        );
        require!(
            exp_time.is_some() || end_cap.is_some(),
            PraErrorCode::ExpOrCapRequired
        );
        require!(
            compliance_admin != self.creator.key(),
            PraErrorCode::AdminCannotBeCreator
        );
        require_keys_eq!(
            payment_destination,
            self.payment_destination.key(),
            ErrorCode::ConstraintTokenMint
        );

        // Thresholds strictly increasing, last must be uncapped so money never goes stale.
        let mut prev: Option<u64> = None;
        for t in tiers.iter() {
            if let Some(p) = prev {
                require!(t.threshold > p, PraErrorCode::ThresholdsNotIncreasing);
            }
            prev = Some(t.threshold);

            require!(
                !t.splits.is_empty() && t.splits.len() <= MAX_SPLITS,
                PraErrorCode::InvalidSplitCount
            );
            let mut sum: u64 = 0;
            for s in t.splits.iter() {
                sum += s.bps as u64;
            }
            require!(sum == MAX_BPS, PraErrorCode::SplitsMustSumTo10000);
        }
        require!(
            tiers.last().unwrap().threshold == u64::MAX,
            PraErrorCode::LastTierMustBeUncapped
        );

        self.agreement_config.set_inner(AgreementConfig {
            agreement_id,
            creator: self.creator.key(),
            share_mint: self.share_mint.key(),
            payment_mint: self.payment_mint.key(),
            depositor,
            compliance_admin,
            vault: self.vault.key(),
            treasury: self.treasury.key(),
            payment_destination,
            supply,
            share_price,
            access_mode,
            tier_count: tiers.len() as u8,
            start_time,
            exp_time,
            end_cap,
            total_deposited: 0,
            shares_sold: 0,
            status: AgreementStatus::Active,
            config_bump,
            vault_bump,
            treasury_bump,
        });

        // TODO(next slice): in the same tx —
        // 1. create share_mint with extensions (DefaultAccountState=Frozen, TransferHook=ours, authority=none)
        //    BEFORE mint init, then mint supply -> treasury, then set mint authority to none.
        // 2. create ExtraAccountMetaList ["extra-account-metas", share_mint].
        // 3. create each TierState ["tier", config, index] from `tiers` via remaining_accounts
        //    with filled=0, acc_per_token=0, owed=0.
        // Vault + treasury token accounts are already init'd above via Anchor.
        Ok(())
    }
}
