use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions},
    state::Account as TokenBaseAccount,
};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::{
    error::PraErrorCode, AgreementConfig, ClaimRecord, TierState, CLAIM_SEED, EXTRA_METAS,
    PRECISION, TIER_SEED,
};

// sha256("spl-transfer-hook-interface:execute")[..8]. Token-2022 invokes the
// hook with this discriminator; wired via #[instruction(discriminator)].
pub const HOOK_DISCRIMINATOR: &[u8] = &[0x69, 0x25, 0x65, 0xc5, 0x4b, 0xfb, 0x66, 0x1a];

#[derive(Accounts)]
pub struct TransferHook<'info> {
    pub source: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub destination: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: transfer authority (holder, delegate, or PDA). Key is never
    /// used beyond Token-2022's own validation; holds no funds for us.
    pub authority: UncheckedAccount<'info>,
}

fn find<'a>(remaining: &'a [AccountInfo<'a>], key: &Pubkey) -> Result<&'a AccountInfo<'a>> {
    remaining
        .iter()
        .find(|info| info.key == key)
        .ok_or(PraErrorCode::MissingClaimRecord.into())
}

impl<'info> TransferHook<'info> {
    pub fn execute<'a>(&mut self, amount: u64, remaining: &'a [AccountInfo<'a>]) -> Result<()> {
        require_keys_eq!(
            self.source.mint,
            self.mint.key(),
            ErrorCode::ConstraintTokenMint
        );
        require_keys_eq!(
            self.destination.mint,
            self.mint.key(),
            ErrorCode::ConstraintTokenMint
        );

        // Anti-spoof: Token-2022 sets this flag on both accounts for the
        // duration of a real transfer only. Direct calls see it unset.
        let transferring = {
            let source_info = self.source.to_account_info();
            let source_data = source_info.try_borrow_data()?;
            let source_state = StateWithExtensions::<TokenBaseAccount>::unpack(&source_data)
                .map_err(|_| PraErrorCode::InvalidHookState)?;
            bool::from(
                source_state
                    .get_extension::<TransferHookAccount>()
                    .map_err(|_| PraErrorCode::InvalidHookState)?
                    .transferring,
            )
        };
        require!(transferring, PraErrorCode::InvalidHookState);

        // Token-2022 calls the hook after moving balances, so reconstruct
        // the before state: sender had current + amount, receiver current -
        // amount.
        let sender_before = self
            .source
            .amount
            .checked_add(amount)
            .ok_or(PraErrorCode::MathOverflow)?;
        let receiver_before = self
            .destination
            .amount
            .checked_sub(amount)
            .ok_or(PraErrorCode::InvalidHookState)?;

        // Discover the agreement from the list PDA: [extra-account-metas,
        // mint] holds the config key as its first static entry at bytes
        // 17..49 (discriminator 8 + len 4 + count 4 + 1 discriminator byte).
        let (list_key, _) =
            Pubkey::find_program_address(&[EXTRA_METAS, self.mint.key().as_ref()], &crate::ID);
        let list_info = find(remaining, &list_key)?;
        let list_data = list_info.try_borrow_data()?;
        require!(
            list_data.len() >= 49 && list_data[0..8] == HOOK_DISCRIMINATOR[..],
            PraErrorCode::InvalidHookState
        );
        let config_key = Pubkey::new_from_array(
            list_data[17..49]
                .try_into()
                .map_err(|_| PraErrorCode::InvalidHookState)?,
        );
        drop(list_data);

        let config_info = find(remaining, &config_key)?;
        let config = Account::<AgreementConfig>::try_from(config_info)
            .map_err(|_| PraErrorCode::InvalidHookState)?;
        require_keys_eq!(
            config.share_mint,
            self.mint.key(),
            ErrorCode::ConstraintTokenMint
        );
        let count = config.tier_count as usize;

        let mut acc_now = [0u128; 5];
        for i in 0..count {
            let (tier_key, _) = Pubkey::find_program_address(
                &[TIER_SEED, config_key.as_ref(), &[i as u8]],
                &crate::ID,
            );
            let tier_info = find(remaining, &tier_key)?;
            let tier = Account::<TierState>::try_from(tier_info)
                .map_err(|_| PraErrorCode::InvalidHookState)?;
            require_keys_eq!(tier.agreement, config_key, ErrorCode::ConstraintSeeds);
            acc_now[i] = tier.acc_per_token;
        }

        // Settles one side into pending and fast-forwards its baseline.
        // Treasury holds no record; skip by source key without reading.
        if self.source.key() != config.treasury {
            let (sender_key, _) = Pubkey::find_program_address(
                &[CLAIM_SEED, config_key.as_ref(), self.source.owner.as_ref()],
                &crate::ID,
            );
            let sender_info = find(remaining, &sender_key)?;
            require!(sender_info.is_writable, PraErrorCode::MissingClaimRecord);
            let mut sender_data = sender_info.try_borrow_mut_data()?;
            let mut sender = ClaimRecord::try_deserialize(&mut &sender_data[..])
                .map_err(|_| PraErrorCode::MissingClaimRecord)?;
            Self::accrue(&mut sender, sender_before as u128, &acc_now, count)?;
            sender.try_serialize(&mut &mut sender_data[..])?;
        }

        let (receiver_key, _) = Pubkey::find_program_address(
            &[
                CLAIM_SEED,
                config_key.as_ref(),
                self.destination.owner.as_ref(),
            ],
            &crate::ID,
        );
        let receiver_info = find(remaining, &receiver_key)?;
        require!(receiver_info.is_writable, PraErrorCode::MissingClaimRecord);
        let mut receiver_data = receiver_info.try_borrow_mut_data()?;
        let mut receiver = ClaimRecord::try_deserialize(&mut &receiver_data[..])
            .map_err(|_| PraErrorCode::MissingClaimRecord)?;
        require!(!receiver.frozen, PraErrorCode::FrozenPosition);
        Self::accrue(&mut receiver, receiver_before as u128, &acc_now, count)?;
        receiver.try_serialize(&mut &mut receiver_data[..])?;
        Ok(())
    }

    fn accrue(
        record: &mut ClaimRecord,
        balance: u128,
        acc_now: &[u128; 5],
        count: usize,
    ) -> Result<()> {
        for i in 0..count {
            let delta = acc_now[i]
                .checked_sub(record.last_acc[i])
                .ok_or(PraErrorCode::MathOverflow)?;
            let earned = balance
                .checked_mul(delta)
                .ok_or(PraErrorCode::MathOverflow)?
                .checked_div(PRECISION)
                .ok_or(PraErrorCode::MathOverflow)?;
            let earned = u64::try_from(earned).map_err(|_| PraErrorCode::MathOverflow)?;
            record.pending[i] = record.pending[i]
                .checked_add(earned)
                .ok_or(PraErrorCode::MathOverflow)?;
            record.last_acc[i] = acc_now[i];
        }
        Ok(())
    }
}
