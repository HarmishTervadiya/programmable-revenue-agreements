use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::error::PraErrorCode;
use crate::{
    AccessMode, AgreementConfig, AgreementStatus, TierInput, AGREEMENT_SEED, EXTRA_METAS, MAX_BPS,
    MAX_SPLITS, MAX_TIERS, TIER_SEED, TREASURY_SEED, VAULT_SEED,
};

use anchor_lang::solana_program::{program::invoke_signed, rent::Rent, system_instruction};
use anchor_spl::token_2022::{
    InitializeAccount3, InitializeMint2, MintTo, SetAuthority, ThawAccount,
};
use anchor_spl::token_2022_extensions::{
    default_account_state::DefaultAccountStateInitialize, transfer_hook::TransferHookInitialize,
};
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::state::{Party, Split, TierState};

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
    pub agreement_config: Box<Account<'info, AgreementConfig>>,

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
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: PDA ["treasury", config], created as Token-2022 account in handler.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,

    /// CHECK: PDA ["extra-account-metas", mint], TLV list created in handler.
    #[account(mut)]
    pub extra_metas: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + TierState::INIT_SPACE,
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[0]],
        bump
    )]
    pub tier0: Box<Account<'info, TierState>>,
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + TierState::INIT_SPACE,
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[1]],
        bump
    )]
    pub tier1: Box<Account<'info, TierState>>,
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + TierState::INIT_SPACE,
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[2]],
        bump
    )]
    pub tier2: Box<Account<'info, TierState>>,
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + TierState::INIT_SPACE,
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[3]],
        bump
    )]
    pub tier3: Box<Account<'info, TierState>>,
    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + TierState::INIT_SPACE,
        seeds = [TIER_SEED, agreement_config.key().as_ref(), &[4]],
        bump
    )]
    pub tier4: Box<Account<'info, TierState>>,

    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
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
        claim_window: Option<u64>,
        depositor: Pubkey,
        compliance_admin: Pubkey,
        payment_destination: Pubkey,
        config_bump: u8,
        vault_bump: u8,
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
        if let Some(window) = claim_window {
            require!(window > 0, PraErrorCode::InvalidClaimWindow);
        }
        require!(
            compliance_admin != self.creator.key(),
            PraErrorCode::AdminCannotBeCreator
        );
        require_keys_eq!(
            payment_destination,
            self.payment_destination.key(),
            ErrorCode::ConstraintTokenMint
        );
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

        let (treasury_pda, treasury_bump) = Pubkey::find_program_address(
            &[TREASURY_SEED, self.agreement_config.key().as_ref()],
            &crate::ID,
        );
        require_keys_eq!(
            treasury_pda,
            self.treasury.key(),
            ErrorCode::ConstraintSeeds
        );
        let (extra_pda, _extra_bump) = Pubkey::find_program_address(
            &[EXTRA_METAS, self.share_mint.key().as_ref()],
            &crate::ID,
        );
        require_keys_eq!(
            extra_pda,
            self.extra_metas.key(),
            ErrorCode::ConstraintSeeds
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
            claim_window,
            claim_deadline: None,
            total_deposited: 0,
            shares_sold: 0,
            status: AgreementStatus::Active,
            config_bump,
            vault_bump,
            treasury_bump,
        });

        self.init_share_mint()?;
        self.init_extra_metas()?;
        self.init_tier_states(&tiers)?;
        self.mint_and_lock_supply(supply, agreement_id, config_bump, treasury_bump)?;
        Ok(())
    }

    fn init_share_mint(&self) -> Result<()> {
        use anchor_spl::token_2022::spl_token_2022::{
            extension::ExtensionType, state::Mint as MintState,
        };

        let space = ExtensionType::try_calculate_account_len::<MintState>(&[
            ExtensionType::DefaultAccountState,
            ExtensionType::TransferHook,
        ])
        .map_err(|_| error!(ErrorCode::AccountDidNotSerialize))?;
        let lamports = Rent::get()?.minimum_balance(space);

        anchor_lang::system_program::create_account(
            CpiContext::new(
                self.system_program.key(),
                anchor_lang::system_program::CreateAccount {
                    from: self.creator.to_account_info(),
                    to: self.share_mint.to_account_info(),
                },
            ),
            lamports,
            space as u64,
            &self.token_2022_program.key(),
        )?;

        // Extensions before mint.
        self.default_state_config()?;
        self.transfer_hook_config()?;
        let cpi = CpiContext::new(
            self.token_2022_program.key(),
            InitializeMint2 {
                mint: self.share_mint.to_account_info(),
            },
        );
        anchor_spl::token_2022::initialize_mint2(
            cpi,
            6,
            &self.agreement_config.key(),
            Some(&self.agreement_config.key()),
        )?;
        Ok(())
    }

    fn default_state_config(&self) -> Result<()> {
        use anchor_spl::token_2022::spl_token_2022::state::AccountState;
        anchor_spl::token_2022_extensions::default_account_state::default_account_state_initialize(
            CpiContext::new(
                self.token_2022_program.key(),
                DefaultAccountStateInitialize {
                    token_program_id: self.token_2022_program.to_account_info(),
                    mint: self.share_mint.to_account_info(),
                },
            ),
            &AccountState::Frozen,
        )
    }

    fn transfer_hook_config(&self) -> Result<()> {
        anchor_spl::token_2022_extensions::transfer_hook::transfer_hook_initialize(
            CpiContext::new(
                self.token_2022_program.key(),
                TransferHookInitialize {
                    token_program_id: self.token_2022_program.to_account_info(),
                    mint: self.share_mint.to_account_info(),
                },
            ),
            // None = hook locked.
            None,
            Some(crate::ID),
        )
    }

    fn init_extra_metas(&self) -> Result<()> {
        let (_pda, bump) = Pubkey::find_program_address(
            &[EXTRA_METAS, self.share_mint.key().as_ref()],
            &crate::ID,
        );
        let space = ExtraAccountMetaList::size_of(0)
            .map_err(|_| error!(ErrorCode::AccountDidNotSerialize))?;
        let lamports = Rent::get()?.minimum_balance(space);
        let create_ix = system_instruction::create_account(
            &self.creator.key(),
            &self.extra_metas.key(),
            lamports,
            space as u64,
            &crate::ID,
        );
        let share_mint_key = self.share_mint.key();
        let bump_seed = [bump];
        let seeds: &[&[u8]] = &[EXTRA_METAS, share_mint_key.as_ref(), &bump_seed];
        invoke_signed(
            &create_ix,
            &[
                self.creator.to_account_info(),
                self.extra_metas.to_account_info(),
                self.system_program.to_account_info(),
            ],
            &[seeds],
        )?;

        // Empty until ClaimRecord shape locks.
        let mut data = self.extra_metas.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &[])
            .map_err(|_| error!(ErrorCode::AccountDidNotSerialize))?;
        Ok(())
    }

    // First N slots from input, rest empty (ignored via tier_count).
    fn init_tier_states(&mut self, tiers: &[TierInput]) -> Result<()> {
        let config_key = self.agreement_config.key();
        Self::write_tier(&mut self.tier0, 0, tiers.get(0), config_key)?;
        Self::write_tier(&mut self.tier1, 1, tiers.get(1), config_key)?;
        Self::write_tier(&mut self.tier2, 2, tiers.get(2), config_key)?;
        Self::write_tier(&mut self.tier3, 3, tiers.get(3), config_key)?;
        Self::write_tier(&mut self.tier4, 4, tiers.get(4), config_key)?;
        Ok(())
    }

    fn write_tier(
        slot: &mut Account<TierState>,
        idx: u8,
        input: Option<&TierInput>,
        config_key: Pubkey,
    ) -> Result<()> {
        let (_, bump) =
            Pubkey::find_program_address(&[TIER_SEED, config_key.as_ref(), &[idx]], &crate::ID);
        if let Some(input) = input {
            let mut arr = [
                Split {
                    party: Party::Holders,
                    bps: 0,
                    owed: 0,
                },
                Split {
                    party: Party::Holders,
                    bps: 0,
                    owed: 0,
                },
                Split {
                    party: Party::Holders,
                    bps: 0,
                    owed: 0,
                },
                Split {
                    party: Party::Holders,
                    bps: 0,
                    owed: 0,
                },
            ];
            for (j, s) in input.splits.iter().enumerate() {
                arr[j] = Split {
                    party: s.party.clone(),
                    bps: s.bps,
                    owed: 0,
                };
            }
            slot.set_inner(TierState {
                agreement: config_key,
                tier_index: idx,
                threshold: input.threshold,
                filled: 0,
                acc_per_token: 0,
                splits: arr,
                split_count: input.splits.len() as u8,
                bump,
            });
        } else {
            slot.set_inner(TierState {
                agreement: config_key,
                tier_index: idx,
                threshold: 0,
                filled: 0,
                acc_per_token: 0,
                splits: [
                    Split {
                        party: Party::Holders,
                        bps: 0,
                        owed: 0,
                    },
                    Split {
                        party: Party::Holders,
                        bps: 0,
                        owed: 0,
                    },
                    Split {
                        party: Party::Holders,
                        bps: 0,
                        owed: 0,
                    },
                    Split {
                        party: Party::Holders,
                        bps: 0,
                        owed: 0,
                    },
                ],
                split_count: 0,
                bump,
            });
        }
        Ok(())
    }

    fn mint_and_lock_supply(
        &self,
        supply: u64,
        agreement_id: u64,
        config_bump: u8,
        treasury_bump: u8,
    ) -> Result<()> {
        use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
        use anchor_spl::token_2022::spl_token_2022::{
            extension::ExtensionType, state::Account as TokenAccountState,
        };

        let config_key = self.agreement_config.key();
        let creator_key = self.creator.key();

        // Treasury must fit required account extensions (TransferHookAccount).
        let space = ExtensionType::try_calculate_account_len::<TokenAccountState>(&[
            ExtensionType::TransferHookAccount,
        ])
        .map_err(|_| error!(ErrorCode::AccountDidNotSerialize))?;
        let lamports = Rent::get()?.minimum_balance(space);
        let treasury_key = self.treasury.key();
        let create_ix = system_instruction::create_account(
            &creator_key,
            &treasury_key,
            lamports,
            space as u64,
            &self.token_2022_program.key(),
        );
        let treasury_bump_seed = [treasury_bump];
        let seeds: &[&[u8]] = &[TREASURY_SEED, config_key.as_ref(), &treasury_bump_seed];
        invoke_signed(
            &create_ix,
            &[
                self.creator.to_account_info(),
                self.treasury.to_account_info(),
                self.system_program.to_account_info(),
            ],
            &[seeds],
        )?;

        let cpi = CpiContext::new(
            self.token_2022_program.key(),
            InitializeAccount3 {
                account: self.treasury.to_account_info(),
                mint: self.share_mint.to_account_info(),
                authority: self.agreement_config.to_account_info(),
            },
        );
        anchor_spl::token_2022::initialize_account3(cpi)?;

        let agreement_id_bytes = agreement_id.to_le_bytes();
        let config_bump_seed = [config_bump];
        let config_seeds: &[&[u8]] = &[
            AGREEMENT_SEED,
            creator_key.as_ref(),
            &agreement_id_bytes,
            &config_bump_seed,
        ];

        // Born frozen, thaw to receive.
        let signer_seeds = &[config_seeds];
        let cpi = CpiContext::new_with_signer(
            self.token_2022_program.key(),
            ThawAccount {
                account: self.treasury.to_account_info(),
                mint: self.share_mint.to_account_info(),
                authority: self.agreement_config.to_account_info(),
            },
            signer_seeds,
        );
        anchor_spl::token_2022::thaw_account(cpi)?;

        let signer_seeds = &[config_seeds];
        let cpi = CpiContext::new_with_signer(
            self.token_2022_program.key(),
            MintTo {
                mint: self.share_mint.to_account_info(),
                to: self.treasury.to_account_info(),
                authority: self.agreement_config.to_account_info(),
            },
            signer_seeds,
        );
        anchor_spl::token_2022::mint_to(cpi, supply)?;

        // Lock supply.
        let signer_seeds = &[config_seeds];
        let cpi = CpiContext::new_with_signer(
            self.token_2022_program.key(),
            SetAuthority {
                account_or_mint: self.share_mint.to_account_info(),
                current_authority: self.agreement_config.to_account_info(),
            },
            signer_seeds,
        );
        anchor_spl::token_2022::set_authority(cpi, AuthorityType::MintTokens, None)?;
        Ok(())
    }
}
