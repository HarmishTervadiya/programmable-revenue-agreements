//! Local runtime tests. Build first with `anchor build --ignore-keys`.
//! Accounts are injected as fixtures following the freeze/unfreeze test convention.
use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program_option::COption, program_pack::Pack},
    AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use pra::extension::{
    default_account_state::DefaultAccountState,
    transfer_hook::{TransferHook, TransferHookAccount},
    BaseStateWithExtensionsMut, ExtensionType, StateWithExtensions, StateWithExtensionsMut,
};
use pra::state::{Account as TokenAccount, AccountState, Mint};
use programmable_revenue_agreement::{
    accounts, error::PraErrorCode, instruction, AccessMode, AgreementConfig, AgreementStatus,
    ClaimRecord, Party, Split, TierState, AGREEMENT_SEED, CLAIM_SEED, ID, MAX_SPLITS, MAX_TIERS,
    PRECISION, TIER_SEED, TREASURY_SEED,
};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

struct Fixture {
    svm: LiteSVM,
    outsider: Keypair,
    config: Pubkey,
    mint: Pubkey,
    token: Pubkey,
    claim: Pubkey,
    treasury: Pubkey,
}

fn account(owner: Pubkey, data: Vec<u8>) -> Account {
    Account {
        lamports: 10_000_000,
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}

fn serialized(value: &impl AccountSerialize) -> Vec<u8> {
    let mut data = Vec::new();
    value.try_serialize(&mut data).unwrap();
    data
}

// Match initialization's maximum allocation: None -> Some must fit in place.
fn serialized_config(config: &AgreementConfig) -> Vec<u8> {
    let mut data = serialized(config);
    data.resize(8 + AgreementConfig::INIT_SPACE, 0);
    data
}

impl Fixture {
    fn new(
        exp_time: Option<i64>,
        end_cap: Option<u64>,
        total_deposited: u64,
        status: AgreementStatus,
    ) -> Self {
        let mut svm = LiteSVM::new().with_transaction_history(0);
        let program_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/deploy/programmable_revenue_agreement.so");
        svm.add_program_from_file(ID, program_path)
            .expect("build the SBF program before testing");
        let admin = Keypair::new();
        let outsider = Keypair::new();
        svm.airdrop(&admin.pubkey(), 1_000_000_000).unwrap();
        svm.airdrop(&outsider.pubkey(), 1_000_000_000).unwrap();
        let creator = Pubkey::new_unique();
        let holder = Pubkey::new_unique();
        let agreement_id = 42u64;
        let (config, config_bump) = Pubkey::find_program_address(
            &[
                AGREEMENT_SEED,
                creator.as_ref(),
                &agreement_id.to_le_bytes(),
            ],
            &ID,
        );
        let (claim, bump) =
            Pubkey::find_program_address(&[CLAIM_SEED, config.as_ref(), holder.as_ref()], &ID);
        let mint = Pubkey::new_unique();
        let token = Pubkey::new_unique();
        let (treasury, treasury_bump) =
            Pubkey::find_program_address(&[TREASURY_SEED, config.as_ref()], &ID);
        let cfg = AgreementConfig {
            agreement_id,
            creator,
            share_mint: mint,
            payment_mint: Pubkey::new_unique(),
            depositor: Pubkey::new_unique(),
            compliance_admin: admin.pubkey(),
            vault: Pubkey::new_unique(),
            treasury,
            payment_destination: Pubkey::new_unique(),
            supply: 100,
            share_price: 1,
            access_mode: AccessMode::Open,
            tier_count: 1,
            start_time: None,
            exp_time,
            end_cap,
            claim_window: None,
            claim_deadline: None,
            total_deposited,
            shares_sold: 10,
            status,
            config_bump,
            vault_bump: 0,
            treasury_bump,
        };
        svm.set_account(config, account(ID, serialized_config(&cfg)))
            .unwrap();
        let record = ClaimRecord {
            config,
            holder,
            last_acc: [7; MAX_TIERS],
            pending: [11; MAX_TIERS],
            frozen: false,
            bump,
        };
        svm.set_account(claim, account(ID, serialized(&record)))
            .unwrap();
        let mut mint_data = vec![0; Mint::LEN];
        Mint::pack(
            Mint {
                mint_authority: COption::None,
                supply: 100,
                decimals: 6,
                is_initialized: true,
                freeze_authority: COption::Some(config),
            },
            &mut mint_data,
        )
        .unwrap();
        svm.set_account(mint, account(pra::ID, mint_data)).unwrap();
        let mut token_data = vec![0; TokenAccount::LEN];
        TokenAccount::pack(
            TokenAccount {
                mint,
                owner: holder,
                amount: 10,
                state: AccountState::Initialized,
                ..TokenAccount::default()
            },
            &mut token_data,
        )
        .unwrap();
        svm.set_account(token, account(pra::ID, token_data))
            .unwrap();
        let mut treasury_data = vec![0; TokenAccount::LEN];
        TokenAccount::pack(
            TokenAccount {
                mint,
                owner: config,
                amount: 90,
                state: AccountState::Initialized,
                ..TokenAccount::default()
            },
            &mut treasury_data,
        )
        .unwrap();
        svm.set_account(treasury, account(pra::ID, treasury_data))
            .unwrap();
        Self {
            svm,
            outsider,
            config,
            mint,
            token,
            claim,
            treasury,
        }
    }

    fn expire(&mut self) -> litesvm::types::TransactionResult {
        // The unrelated outsider pays; no creator/admin signature is supplied.
        let ix = Instruction {
            program_id: ID,
            accounts: accounts::ExpireAgreement {
                agreement_config: self.config,
                share_mint: self.mint,
                treasury: self.treasury,
                token_2022_program: pra::ID,
            }
            .to_account_metas(None),
            data: instruction::ExpireAgreement {}.data(),
        };
        self.send(ix)
    }

    fn send(&mut self, ix: Instruction) -> litesvm::types::TransactionResult {
        self.svm.send_transaction(Transaction::new(
            &[&self.outsider],
            Message::new(&[ix], Some(&self.outsider.pubkey())),
            self.svm.latest_blockhash(),
        ))
    }

    fn set_time(&mut self, timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = timestamp;
        self.svm.set_sysvar(&clock);
    }

    fn assert_expired(&self) {
        let data = self.svm.get_account(&self.config).unwrap().data;
        let config = AgreementConfig::try_deserialize(&mut data.as_slice()).unwrap();
        assert!(matches!(config.status, AgreementStatus::Expired));
        assert_eq!(config.supply, 100);
        assert_eq!(config.shares_sold, 10);
        let treasury = self.svm.get_account(&self.treasury).unwrap();
        let treasury = TokenAccount::unpack(&treasury.data).unwrap();
        assert_eq!(treasury.owner, self.config);
        assert_eq!(treasury.amount, 0);
        assert_eq!(treasury.mint, self.mint);
        let mint = self.svm.get_account(&self.mint).unwrap();
        assert_eq!(Mint::unpack(&mint.data).unwrap().supply, 10);
        let claim = self.svm.get_account(&self.claim).unwrap();
        let claim = ClaimRecord::try_deserialize(&mut claim.data.as_slice()).unwrap();
        assert_eq!(claim.last_acc, [7; MAX_TIERS]);
        assert_eq!(claim.pending, [11; MAX_TIERS]);
        let holder = self.svm.get_account(&self.token).unwrap();
        assert_eq!(TokenAccount::unpack(&holder.data).unwrap().amount, 10);
    }

    fn set_claim_window(&mut self, window: Option<u64>) {
        let data = self.svm.get_account(&self.config).unwrap().data;
        let mut config = AgreementConfig::try_deserialize(&mut data.as_slice()).unwrap();
        config.claim_window = window;
        self.svm
            .set_account(self.config, account(ID, serialized_config(&config)))
            .unwrap();
    }

    fn assert_rejected(&mut self, error: PraErrorCode) {
        let config_before = self.svm.get_account(&self.config).unwrap().data;
        let treasury_before = self.svm.get_account(&self.treasury).unwrap().data;
        let mint_before = self.svm.get_account(&self.mint).unwrap().data;
        let failure = self.expire().unwrap_err();
        assert_eq!(
            format!("{:?}", failure.err),
            format!("InstructionError(0, Custom({}))", u32::from(error))
        );
        assert_eq!(
            self.svm.get_account(&self.config).unwrap().data,
            config_before
        );
        assert_eq!(
            self.svm.get_account(&self.treasury).unwrap().data,
            treasury_before
        );
        assert_eq!(self.svm.get_account(&self.mint).unwrap().data, mint_before);
    }
}

#[test]
fn expiry_at_time_boundary_by_unrelated_caller_burns_unsold_entitlement() {
    let mut f = Fixture::new(Some(100), Some(500), 499, AgreementStatus::Active);
    f.set_time(100);
    f.expire().unwrap();
    f.assert_expired();
}

#[test]
fn expiry_at_cap_boundary_with_future_expiry_time() {
    let mut f = Fixture::new(Some(200), Some(500), 500, AgreementStatus::Active);
    f.set_time(100);
    f.expire().unwrap();
    f.assert_expired();
}

#[test]
fn either_optional_condition_alone_can_expire() {
    for (time, cap, deposited) in [(Some(99), None, 0), (None, Some(500), 501)] {
        let mut f = Fixture::new(time, cap, deposited, AgreementStatus::Active);
        f.set_time(100);
        f.expire().unwrap();
        f.assert_expired();
    }
}

#[test]
fn premature_or_missing_end_conditions_are_rejected() {
    for (time, cap) in [
        (Some(101), Some(500)),
        (Some(101), None),
        (None, Some(500)),
        (None, None),
    ] {
        let mut f = Fixture::new(time, cap, 499, AgreementStatus::Active);
        f.set_time(100);
        f.assert_rejected(PraErrorCode::EndConditionNotMet);
    }
}

#[test]
fn expired_and_closed_agreements_are_rejected() {
    for status in [AgreementStatus::Expired, AgreementStatus::Closed] {
        let mut f = Fixture::new(Some(100), None, 0, status);
        f.set_time(100);
        f.assert_rejected(PraErrorCode::AgreementNotActive);
    }
    let mut f = Fixture::new(Some(100), None, 0, AgreementStatus::Active);
    f.set_time(100);
    f.expire().unwrap();
    f.assert_rejected(PraErrorCode::AgreementNotActive);
}

#[test]
fn expiry_burns_with_configured_token_extensions_without_transfer_hook() {
    let mut f = Fixture::new(Some(100), None, 0, AgreementStatus::Active);
    f.set_time(100);
    let mint_base = Mint::unpack(&f.svm.get_account(&f.mint).unwrap().data).unwrap();
    let mut mint_data = vec![
        0;
        ExtensionType::try_calculate_account_len::<Mint>(&[
            ExtensionType::DefaultAccountState,
            ExtensionType::TransferHook,
        ])
        .unwrap()
    ];
    let mut mint = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut mint_data).unwrap();
    mint.init_extension::<DefaultAccountState>(true)
        .unwrap()
        .state = AccountState::Frozen as u8;
    mint.init_extension::<TransferHook>(true)
        .unwrap()
        .program_id = Some(ID).try_into().unwrap();
    mint.base = mint_base;
    mint.pack_base();
    mint.init_account_type().unwrap();
    f.svm
        .set_account(f.mint, account(pra::ID, mint_data))
        .unwrap();

    let treasury_base =
        TokenAccount::unpack(&f.svm.get_account(&f.treasury).unwrap().data).unwrap();
    let mut treasury_data = vec![
        0;
        ExtensionType::try_calculate_account_len::<TokenAccount>(&[
            ExtensionType::TransferHookAccount,
        ])
        .unwrap()
    ];
    let mut treasury =
        StateWithExtensionsMut::<TokenAccount>::unpack_uninitialized(&mut treasury_data).unwrap();
    treasury
        .init_extension::<TransferHookAccount>(true)
        .unwrap();
    treasury.base = treasury_base;
    treasury.pack_base();
    treasury.init_account_type().unwrap();
    f.svm
        .set_account(f.treasury, account(pra::ID, treasury_data))
        .unwrap();
    let mint_before = f.svm.get_account(&f.mint).unwrap().data;
    f.expire().unwrap();
    let mint_after = f.svm.get_account(&f.mint).unwrap().data;
    assert_eq!(
        StateWithExtensions::<Mint>::unpack(&mint_after)
            .unwrap()
            .base
            .supply,
        10
    );
    assert_eq!(&mint_after[Mint::LEN..], &mint_before[Mint::LEN..]);
    let treasury_data = f.svm.get_account(&f.treasury).unwrap().data;
    let treasury = StateWithExtensions::<TokenAccount>::unpack(&treasury_data).unwrap();
    assert_eq!(treasury.base.owner, f.config);
    assert_eq!(treasury.base.amount, 0);
}

#[test]
fn failed_burn_cpi_does_not_expire_or_change_entitlement() {
    let mut f = Fixture::new(Some(100), None, 0, AgreementStatus::Active);
    f.set_time(100);
    let mut data = f.svm.get_account(&f.treasury).unwrap().data;
    let mut treasury = TokenAccount::unpack(&data).unwrap();
    treasury.state = AccountState::Frozen;
    TokenAccount::pack(treasury, &mut data).unwrap();
    f.svm
        .set_account(f.treasury, account(pra::ID, data.clone()))
        .unwrap();
    f.set_claim_window(Some(30));
    let config_before = f.svm.get_account(&f.config).unwrap().data;
    let mint_before = f.svm.get_account(&f.mint).unwrap().data;
    let error = f.expire().unwrap_err();
    assert!(
        error
            .meta
            .logs
            .iter()
            .any(|log| log.contains("Account is frozen")),
        "{error:?}"
    );
    assert_eq!(f.svm.get_account(&f.config).unwrap().data, config_before);
    assert_eq!(f.svm.get_account(&f.treasury).unwrap().data, data);
    assert_eq!(f.svm.get_account(&f.mint).unwrap().data, mint_before);
}

#[test]
fn treasury_from_another_agreement_is_rejected() {
    let mut f = Fixture::new(Some(100), None, 0, AgreementStatus::Active);
    f.set_time(100);
    let other = Fixture::new(Some(100), None, 0, AgreementStatus::Active);
    f.svm
        .set_account(
            other.treasury,
            other.svm.get_account(&other.treasury).unwrap(),
        )
        .unwrap();
    f.treasury = other.treasury;
    let before = f.svm.get_account(&f.config).unwrap().data;
    let failure = f.expire().unwrap_err();
    assert!(
        failure
            .meta
            .logs
            .iter()
            .any(|log| log.contains("ConstraintSeeds")),
        "{failure:?}"
    );
    assert_eq!(f.svm.get_account(&f.config).unwrap().data, before);
}

#[test]
fn expiry_preserves_accrued_holder_revenue() {
    accrued_revenue_case(false);
}

#[test]
fn accrued_revenue_is_claimable_after_expiry() {
    accrued_revenue_case(true);
}

fn accrued_revenue_case(claim_after_expiry: bool) {
    let mut f = Fixture::new(Some(100), None, 0, AgreementStatus::Active);
    f.set_time(100);
    let config_data = f.svm.get_account(&f.config).unwrap().data;
    let config = AgreementConfig::try_deserialize(&mut config_data.as_slice()).unwrap();
    let holder = f.outsider.pubkey();
    let (claim, bump) =
        Pubkey::find_program_address(&[CLAIM_SEED, f.config.as_ref(), holder.as_ref()], &ID);
    f.claim = claim;
    f.svm
        .set_account(
            claim,
            account(
                ID,
                serialized(&ClaimRecord {
                    config: f.config,
                    holder,
                    last_acc: [7; MAX_TIERS],
                    pending: [11; MAX_TIERS],
                    frozen: false,
                    bump,
                }),
            ),
        )
        .unwrap();
    let mut holder_token =
        TokenAccount::unpack(&f.svm.get_account(&f.token).unwrap().data).unwrap();
    holder_token.owner = holder;
    let mut token_data = vec![0; TokenAccount::LEN];
    TokenAccount::pack(holder_token, &mut token_data).unwrap();
    f.svm
        .set_account(f.token, account(pra::ID, token_data))
        .unwrap();

    let mut payment_mint = vec![0; Mint::LEN];
    Mint::pack(
        Mint {
            mint_authority: COption::None,
            supply: 1_000,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut payment_mint,
    )
    .unwrap();
    f.svm
        .set_account(config.payment_mint, account(pra::ID, payment_mint))
        .unwrap();
    let destination = Pubkey::new_unique();
    for (address, owner, amount) in [(config.vault, f.config, 1_000), (destination, holder, 0)] {
        let mut data = vec![0; TokenAccount::LEN];
        TokenAccount::pack(
            TokenAccount {
                mint: config.payment_mint,
                owner,
                amount,
                state: AccountState::Initialized,
                ..TokenAccount::default()
            },
            &mut data,
        )
        .unwrap();
        f.svm.set_account(address, account(pra::ID, data)).unwrap();
    }
    let tiers: Vec<Pubkey> = (0..MAX_TIERS)
        .map(|i| {
            let (key, bump) =
                Pubkey::find_program_address(&[TIER_SEED, f.config.as_ref(), &[i as u8]], &ID);
            f.svm
                .set_account(
                    key,
                    account(
                        ID,
                        serialized(&TierState {
                            agreement: f.config,
                            tier_index: i as u8,
                            threshold: u64::MAX,
                            filled: 1_000,
                            acc_per_token: 7 + 2 * PRECISION,
                            splits: std::array::from_fn::<_, MAX_SPLITS, _>(|_| Split {
                                party: Party::Holders,
                                bps: 0,
                                owed: 0,
                            }),
                            split_count: 1,
                            bump,
                        }),
                    ),
                )
                .unwrap();
            key
        })
        .collect();
    let vault_before = f.svm.get_account(&config.vault).unwrap().data;
    let tiers_before: Vec<_> = tiers
        .iter()
        .map(|key| f.svm.get_account(key).unwrap().data)
        .collect();
    f.expire().unwrap();
    f.assert_expired();
    assert_eq!(f.svm.get_account(&config.vault).unwrap().data, vault_before);
    for (key, before) in tiers.iter().zip(tiers_before) {
        assert_eq!(f.svm.get_account(key).unwrap().data, before);
    }
    if !claim_after_expiry {
        return;
    }
    f.send(Instruction {
        program_id: ID,
        accounts: accounts::ClaimTierShare {
            holder,
            agreement_config: f.config,
            share_mint: f.mint,
            payment_mint: config.payment_mint,
            holder_share_ata: f.token,
            holder_usdc_ata: destination,
            vault: config.vault,
            claim_record: f.claim,
            tier0: tiers[0],
            tier1: tiers[1],
            tier2: tiers[2],
            tier3: tiers[3],
            tier4: tiers[4],
            token_program: pra::ID,
        }
        .to_account_metas(None),
        data: instruction::ClaimTierShare {}.data(),
    })
    .unwrap();
    let payout = TokenAccount::unpack(&f.svm.get_account(&destination).unwrap().data)
        .unwrap()
        .amount;
    assert_eq!(payout, 31); // 10 tokens * 2 accrued per token + 11 pending.
    assert_eq!(
        TokenAccount::unpack(&f.svm.get_account(&config.vault).unwrap().data)
            .unwrap()
            .amount,
        969
    );
}

#[test]
fn deadline_uses_expiry_call_timestamp_or_none() {
    for window in [None, Some(30)] {
        let mut f = Fixture::new(Some(99), None, 0, AgreementStatus::Active);
        f.set_time(100);
        f.set_claim_window(window);
        f.expire().unwrap();
        f.assert_expired();
        let data = f.svm.get_account(&f.config).unwrap().data;
        let config = AgreementConfig::try_deserialize(&mut data.as_slice()).unwrap();
        assert_eq!(config.claim_deadline, window.map(|_| 130));
        assert_eq!(config.claim_window, window);
    }
}

#[test]
fn deadline_conversion_and_addition_overflow_roll_back() {
    for (now, window) in [(100, u64::MAX), (i64::MAX - 1, 2)] {
        let mut f = Fixture::new(Some(99), None, 0, AgreementStatus::Active);
        f.set_time(now);
        f.set_claim_window(Some(window));
        f.assert_rejected(PraErrorCode::MathOverflow);
    }
}

#[test]
fn empty_frozen_treasury_skips_burn_cpi() {
    let mut f = Fixture::new(Some(100), None, 0, AgreementStatus::Active);
    f.set_time(100);
    let mut data = f.svm.get_account(&f.treasury).unwrap().data;
    let mut treasury = TokenAccount::unpack(&data).unwrap();
    treasury.amount = 0;
    treasury.state = AccountState::Frozen; // Even a zero-amount burn would fail.
    TokenAccount::pack(treasury, &mut data).unwrap();
    f.svm
        .set_account(f.treasury, account(pra::ID, data.clone()))
        .unwrap();
    let mint_before = f.svm.get_account(&f.mint).unwrap().data;
    let result = f.expire().unwrap();
    assert!(!result
        .logs
        .iter()
        .any(|log| log.contains("Instruction: Burn")));
    assert_eq!(f.svm.get_account(&f.treasury).unwrap().data, data);
    assert_eq!(f.svm.get_account(&f.mint).unwrap().data, mint_before);
    let config_data = f.svm.get_account(&f.config).unwrap().data;
    let config = AgreementConfig::try_deserialize(&mut config_data.as_slice()).unwrap();
    assert!(matches!(config.status, AgreementStatus::Expired));
    assert_eq!(config.claim_deadline, None);
    assert_eq!(config.supply, 100);
}

#[test]
fn wrong_share_mint_or_treasury_authority_is_rejected() {
    for wrong_mint in [true, false] {
        let mut f = Fixture::new(Some(100), None, 0, AgreementStatus::Active);
        f.set_time(100);
        if wrong_mint {
            let substitute = Pubkey::new_unique();
            f.svm
                .set_account(substitute, f.svm.get_account(&f.mint).unwrap())
                .unwrap();
            f.mint = substitute;
        } else {
            let mut data = f.svm.get_account(&f.treasury).unwrap().data;
            let mut treasury = TokenAccount::unpack(&data).unwrap();
            treasury.owner = Pubkey::new_unique();
            TokenAccount::pack(treasury, &mut data).unwrap();
            f.svm
                .set_account(f.treasury, account(pra::ID, data))
                .unwrap();
        }
        let before: Vec<_> = [f.config, f.mint, f.treasury]
            .iter()
            .map(|key| f.svm.get_account(key).unwrap())
            .collect();
        let failure = f.expire().unwrap_err();
        let expected = if wrong_mint {
            "ConstraintAddress"
        } else {
            "ConstraintTokenOwner"
        };
        assert!(
            failure.meta.logs.iter().any(|log| log.contains(expected)),
            "{failure:?}"
        );
        for (key, previous) in [f.config, f.mint, f.treasury].iter().zip(before) {
            assert_eq!(f.svm.get_account(key).unwrap(), previous);
        }
    }
}

#[test]
fn burn_uses_observed_balance_instead_of_contractual_supply_minus_sales() {
    let mut f = Fixture::new(None, Some(500), 500, AgreementStatus::Active);
    f.set_time(100);
    f.set_claim_window(Some(30));
    let mut data = f.svm.get_account(&f.treasury).unwrap().data;
    let mut treasury = TokenAccount::unpack(&data).unwrap();
    treasury.amount = 37; // Deliberately differs from supply (100) minus sales (10).
    TokenAccount::pack(treasury, &mut data).unwrap();
    f.svm
        .set_account(f.treasury, account(pra::ID, data))
        .unwrap();
    f.expire().unwrap();
    let treasury = TokenAccount::unpack(&f.svm.get_account(&f.treasury).unwrap().data).unwrap();
    assert_eq!(treasury.amount, 0);
    assert_eq!(treasury.owner, f.config);
    assert_eq!(
        Mint::unpack(&f.svm.get_account(&f.mint).unwrap().data)
            .unwrap()
            .supply,
        63
    );
    let data = f.svm.get_account(&f.config).unwrap().data;
    let config = AgreementConfig::try_deserialize(&mut data.as_slice()).unwrap();
    assert_eq!(config.supply, 100);
    assert_eq!(config.shares_sold, 10);
    assert_eq!(config.claim_deadline, Some(130));
}
