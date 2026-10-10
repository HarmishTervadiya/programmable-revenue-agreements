//! Closure runtime tests against the built SBF program, with independent fee payer.
use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program_option::COption, program_pack::Pack},
    AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use pra::{
    extension::{
        default_account_state::DefaultAccountState,
        transfer_hook::{TransferHook, TransferHookAccount},
        BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
    },
    state::{Account as TokenAccount, AccountState, Mint},
};
use programmable_revenue_agreement::{
    accounts, error::PraErrorCode, instruction, AccessMode, AgreementConfig, AgreementStatus,
    ClaimRecord, Party, Split, TierState, AGREEMENT_SEED, CLAIM_SEED, EXTRA_METAS, ID, MAX_SPLITS,
    MAX_TIERS, TIER_SEED, TREASURY_SEED, VAULT_SEED,
};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

const RENT: u64 = 10_000_000;
const INITIAL_DESTINATION_BALANCE: u64 = 17;

fn account(owner: Pubkey, data: Vec<u8>) -> Account {
    Account {
        lamports: RENT,
        owner,
        data,
        executable: false,
        rent_epoch: 0,
    }
}

fn serialized(value: &impl AccountSerialize, space: usize) -> Vec<u8> {
    let mut data = Vec::new();
    value.try_serialize(&mut data).unwrap();
    data.resize(space, 0);
    data
}

fn token_data(mint: Pubkey, owner: Pubkey, amount: u64) -> Vec<u8> {
    let mut data = vec![0; TokenAccount::LEN];
    TokenAccount::pack(
        TokenAccount {
            mint,
            owner,
            amount,
            state: AccountState::Initialized,
            ..TokenAccount::default()
        },
        &mut data,
    )
    .unwrap();
    data
}

struct Fixture {
    svm: LiteSVM,
    creator: Keypair,
    payer: Keypair,
    config: Pubkey,
    payment_mint: Pubkey,
    destination: Pubkey,
    vault: Pubkey,
    mint: Pubkey,
    treasury: Pubkey,
    tiers: [Pubkey; MAX_TIERS],
    extra: Pubkey,
    claim: Pubkey,
    payment_program: Pubkey,
}

impl Fixture {
    fn new(amount: u64, deadline: Option<i64>, payment_program: Pubkey) -> Self {
        let mut svm = LiteSVM::new().with_transaction_history(0);
        svm.add_program_from_file(
            ID,
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../target/deploy/programmable_revenue_agreement.so"),
        )
        .unwrap();
        let creator = Keypair::new();
        let payer = Keypair::new();
        svm.airdrop(&creator.pubkey(), 1_000_000_000).unwrap();
        svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
        let creator_key = creator.pubkey();
        let agreement_id = 42u64;
        let (config, config_bump) = Pubkey::find_program_address(
            &[
                AGREEMENT_SEED,
                creator_key.as_ref(),
                &agreement_id.to_le_bytes(),
            ],
            &ID,
        );
        let (vault, vault_bump) = Pubkey::find_program_address(&[VAULT_SEED, config.as_ref()], &ID);
        let (treasury, treasury_bump) =
            Pubkey::find_program_address(&[TREASURY_SEED, config.as_ref()], &ID);
        let mint = Pubkey::new_unique();
        let payment_mint = Pubkey::new_unique();
        let destination = Pubkey::new_unique();
        let (extra, _) = Pubkey::find_program_address(&[EXTRA_METAS, mint.as_ref()], &ID);
        let holder = Pubkey::new_unique();
        let (claim, claim_bump) =
            Pubkey::find_program_address(&[CLAIM_SEED, config.as_ref(), holder.as_ref()], &ID);
        let cfg = AgreementConfig {
            agreement_id,
            creator: creator_key,
            share_mint: mint,
            payment_mint,
            depositor: Pubkey::new_unique(),
            compliance_admin: Pubkey::new_unique(),
            vault,
            treasury,
            payment_destination: destination,
            supply: 100,
            share_price: 1,
            access_mode: AccessMode::Open,
            tier_count: 1,
            start_time: None,
            exp_time: Some(50),
            end_cap: None,
            claim_window: deadline.map(|_| 50),
            claim_deadline: deadline,
            total_deposited: amount,
            shares_sold: 10,
            status: AgreementStatus::Expired,
            config_bump,
            vault_bump,
            treasury_bump,
        };
        svm.set_account(
            config,
            account(ID, serialized(&cfg, 8 + AgreementConfig::INIT_SPACE)),
        )
        .unwrap();
        let tiers = std::array::from_fn(|i| {
            let (key, bump) =
                Pubkey::find_program_address(&[TIER_SEED, config.as_ref(), &[i as u8]], &ID);
            let tier = TierState {
                agreement: config,
                tier_index: i as u8,
                threshold: if i == 0 { u64::MAX } else { 0 },
                filled: amount,
                acc_per_token: 5,
                splits: std::array::from_fn::<_, MAX_SPLITS, _>(|_| Split {
                    party: Party::Holders,
                    bps: 0,
                    owed: 0,
                }),
                split_count: if i == 0 { 1 } else { 0 },
                bump,
            };
            svm.set_account(
                key,
                account(ID, serialized(&tier, 8 + TierState::INIT_SPACE)),
            )
            .unwrap();
            key
        });
        let record = ClaimRecord {
            config,
            holder,
            last_acc: [5; MAX_TIERS],
            pending: [11; MAX_TIERS],
            frozen: false,
            bump: claim_bump,
        };
        svm.set_account(
            claim,
            account(ID, serialized(&record, 8 + ClaimRecord::INIT_SPACE)),
        )
        .unwrap();
        let mut extra_data = vec![0; ExtraAccountMetaList::size_of(0).unwrap()];
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut extra_data, &[]).unwrap();
        svm.set_account(extra, account(ID, extra_data)).unwrap();

        let mint_base = Mint {
            mint_authority: COption::None,
            supply: 10,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::Some(config),
        };
        let mut mint_data = vec![
            0;
            ExtensionType::try_calculate_account_len::<Mint>(&[
                ExtensionType::DefaultAccountState,
                ExtensionType::TransferHook
            ])
            .unwrap()
        ];
        let mut extended =
            StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut mint_data).unwrap();
        extended
            .init_extension::<DefaultAccountState>(true)
            .unwrap()
            .state = AccountState::Frozen as u8;
        extended
            .init_extension::<TransferHook>(true)
            .unwrap()
            .program_id = Some(ID).try_into().unwrap();
        extended.base = mint_base;
        extended.pack_base();
        extended.init_account_type().unwrap();
        svm.set_account(mint, account(pra::ID, mint_data)).unwrap();
        let mut treasury_data = vec![
            0;
            ExtensionType::try_calculate_account_len::<TokenAccount>(&[
                ExtensionType::TransferHookAccount
            ])
            .unwrap()
        ];
        let mut extended =
            StateWithExtensionsMut::<TokenAccount>::unpack_uninitialized(&mut treasury_data)
                .unwrap();
        extended
            .init_extension::<TransferHookAccount>(true)
            .unwrap();
        extended.base = TokenAccount::unpack(&token_data(mint, config, 0)).unwrap();
        extended.pack_base();
        extended.init_account_type().unwrap();
        svm.set_account(treasury, account(pra::ID, treasury_data))
            .unwrap();

        let mut payment_data = vec![0; Mint::LEN];
        Mint::pack(
            Mint {
                mint_authority: COption::None,
                supply: amount + INITIAL_DESTINATION_BALANCE,
                decimals: 6,
                is_initialized: true,
                freeze_authority: COption::None,
            },
            &mut payment_data,
        )
        .unwrap();
        svm.set_account(payment_mint, account(payment_program, payment_data))
            .unwrap();
        svm.set_account(
            vault,
            account(payment_program, token_data(payment_mint, config, amount)),
        )
        .unwrap();
        svm.set_account(
            destination,
            account(
                payment_program,
                token_data(payment_mint, creator_key, INITIAL_DESTINATION_BALANCE),
            ),
        )
        .unwrap();
        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = 100;
        svm.set_sysvar(&clock);
        Self {
            svm,
            creator,
            payer,
            config,
            payment_mint,
            destination,
            vault,
            mint,
            treasury,
            tiers,
            extra,
            claim,
            payment_program,
        }
    }

    fn instruction(&self, creator: Pubkey, destination: Pubkey) -> Instruction {
        Instruction {
            program_id: ID,
            accounts: accounts::CloseAgreement {
                creator,
                agreement_config: self.config,
                payment_mint: self.payment_mint,
                payment_destination: destination,
                vault: self.vault,
                share_mint: self.mint,
                treasury: self.treasury,
                tier0: self.tiers[0],
                tier1: self.tiers[1],
                tier2: self.tiers[2],
                tier3: self.tiers[3],
                tier4: self.tiers[4],
                extra_metas: self.extra,
                payment_token_program: self.payment_program,
                token_2022_program: pra::ID,
            }
            .to_account_metas(None),
            data: instruction::CloseAgreement {}.data(),
        }
    }

    fn send(&mut self, ix: Instruction, authorized: bool) -> litesvm::types::TransactionResult {
        let signers: Vec<&Keypair> = if authorized {
            vec![&self.payer, &self.creator]
        } else {
            vec![&self.payer]
        };
        self.svm.send_transaction(Transaction::new(
            &signers,
            Message::new(&[ix], Some(&self.payer.pubkey())),
            self.svm.latest_blockhash(),
        ))
    }

    fn close(&mut self) -> litesvm::types::TransactionResult {
        self.send(
            self.instruction(self.creator.pubkey(), self.destination),
            true,
        )
    }

    fn closed_keys(&self) -> Vec<Pubkey> {
        let mut keys = vec![self.config, self.vault, self.treasury, self.extra];
        keys.extend(self.tiers);
        keys
    }

    fn snapshot(&self) -> Vec<(Pubkey, Account)> {
        let mut keys = self.closed_keys();
        keys.extend([
            self.mint,
            self.claim,
            self.destination,
            self.creator.pubkey(),
        ]);
        keys.into_iter()
            .map(|k| (k, self.svm.get_account(&k).unwrap()))
            .collect()
    }

    fn assert_unchanged(&self, before: Vec<(Pubkey, Account)>) {
        for (key, value) in before {
            assert_eq!(self.svm.get_account(&key), Some(value), "{key}");
        }
    }

    fn assert_rejected(&mut self, expected: PraErrorCode) {
        let before = self.snapshot();
        let failure = self.close().unwrap_err();
        assert_eq!(
            format!("{:?}", failure.err),
            format!("InstructionError(0, Custom({}))", u32::from(expected))
        );
        self.assert_unchanged(before);
    }

    fn assert_success(&mut self, amount: u64) {
        let before_creator = self
            .svm
            .get_account(&self.creator.pubkey())
            .unwrap()
            .lamports;
        let rent: u64 = self
            .closed_keys()
            .iter()
            .map(|k| self.svm.get_account(k).unwrap().lamports)
            .sum();
        let retained: Vec<_> = [self.mint, self.claim, self.payment_mint]
            .into_iter()
            .map(|k| (k, self.svm.get_account(&k).unwrap()))
            .collect();
        self.close().unwrap();
        for key in self.closed_keys() {
            assert!(
                self.svm
                    .get_account(&key)
                    .is_none_or(|a| a.lamports == 0 && a.data.is_empty()),
                "{key}"
            );
        }
        assert_eq!(
            TokenAccount::unpack(&self.svm.get_account(&self.destination).unwrap().data)
                .unwrap()
                .amount,
            INITIAL_DESTINATION_BALANCE + amount
        );
        assert_eq!(
            self.svm
                .get_account(&self.creator.pubkey())
                .unwrap()
                .lamports,
            before_creator + rent
        );
        self.assert_unchanged(retained);
    }
}

#[test]
fn unauthorized_creator_and_missing_signature_are_rejected() {
    let mut f = Fixture::new(0, None, anchor_spl::token::ID);
    let before = f.snapshot();
    let failure = f
        .send(f.instruction(f.payer.pubkey(), f.destination), false)
        .unwrap_err();
    assert!(
        failure
            .meta
            .logs
            .iter()
            .any(|l| l.contains("UnauthorizedCreator")),
        "{failure:?}"
    );
    f.assert_unchanged(before);
    let before = f.snapshot();
    let mut ix = f.instruction(f.creator.pubkey(), f.destination);
    ix.accounts[0].is_signer = false;
    let failure = f.send(ix, false).unwrap_err();
    assert!(
        failure
            .meta
            .logs
            .iter()
            .any(|l| l.contains("AccountNotSigner")),
        "{failure:?}"
    );
    f.assert_unchanged(before);
}

#[test]
fn active_and_closed_status_are_rejected() {
    for status in [AgreementStatus::Active, AgreementStatus::Closed] {
        let mut f = Fixture::new(0, Some(99), anchor_spl::token::ID);
        let data = f.svm.get_account(&f.config).unwrap().data;
        let mut config = AgreementConfig::try_deserialize(&mut data.as_slice()).unwrap();
        config.status = status;
        f.svm
            .set_account(
                f.config,
                account(ID, serialized(&config, 8 + AgreementConfig::INIT_SPACE)),
            )
            .unwrap();
        f.assert_rejected(PraErrorCode::AgreementNotExpired);
    }
}

#[test]
fn dust_boundaries_with_missing_or_future_deadline() {
    for deadline in [None, Some(101)] {
        for amount in [999, 1_000, 1_001] {
            let mut f = Fixture::new(amount, deadline, anchor_spl::token::ID);
            if amount <= 1_000 {
                f.assert_success(amount);
            } else {
                f.assert_rejected(PraErrorCode::ClaimWindowStillOpen);
            }
        }
    }
}

#[test]
fn deadline_before_at_and_after_boundary() {
    for now in [99, 100, 101] {
        let mut f = Fixture::new(50_000, Some(100), anchor_spl::token::ID);
        let mut clock = f.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = now;
        f.svm.set_sysvar(&clock);
        if now < 100 {
            f.assert_rejected(PraErrorCode::ClaimWindowStillOpen);
        } else {
            f.assert_success(50_000);
        }
    }
}

#[test]
fn zero_balance_vault_and_treasury_close_for_both_payment_programs() {
    for program in [anchor_spl::token::ID, pra::ID] {
        let mut f = Fixture::new(0, None, program);
        f.assert_success(0);
    }
}

#[test]
fn token_2022_payment_vault_is_swept_and_closed() {
    let mut f = Fixture::new(1_000, None, pra::ID);
    f.assert_success(1_000);
}

#[test]
fn incorrect_payment_destination_is_rejected() {
    let mut f = Fixture::new(1_000, None, anchor_spl::token::ID);
    let substitute = Pubkey::new_unique();
    let substitute_account = account(
        f.payment_program,
        token_data(f.payment_mint, f.creator.pubkey(), 0),
    );
    f.svm
        .set_account(substitute, substitute_account.clone())
        .unwrap();
    let before = f.snapshot();
    let failure = f
        .send(f.instruction(f.creator.pubkey(), substitute), true)
        .unwrap_err();
    assert!(
        failure
            .meta
            .logs
            .iter()
            .any(|l| l.contains("ConstraintAddress")),
        "{failure:?}"
    );
    f.assert_unchanged(before);
    assert_eq!(f.svm.get_account(&substitute), Some(substitute_account));
}

#[test]
fn nonempty_treasury_is_rejected_without_sweeping() {
    let mut f = Fixture::new(1_000, None, anchor_spl::token::ID);
    let mut data = f.svm.get_account(&f.treasury).unwrap().data;
    let mut treasury = StateWithExtensionsMut::<TokenAccount>::unpack(&mut data).unwrap();
    treasury.base.amount = 1;
    treasury.pack_base();
    f.svm
        .set_account(f.treasury, account(pra::ID, data))
        .unwrap();
    f.assert_rejected(PraErrorCode::TreasuryNotEmpty);
}

#[test]
fn late_treasury_close_failure_rolls_back_sweep_and_vault_close() {
    let mut f = Fixture::new(1_000, None, anchor_spl::token::ID);
    let mut data = f.svm.get_account(&f.treasury).unwrap().data;
    let mut treasury = StateWithExtensionsMut::<TokenAccount>::unpack(&mut data).unwrap();
    treasury.base.close_authority = COption::Some(f.payer.pubkey());
    treasury.pack_base();
    f.svm
        .set_account(f.treasury, account(pra::ID, data))
        .unwrap();
    let before = f.snapshot();
    let failure = f.close().unwrap_err();
    // LiteSVM's classic-token builtin omits instruction-name logs; inspect
    // actual CPI opcodes: TransferChecked, vault CloseAccount, treasury CloseAccount.
    let opcodes: Vec<_> = failure
        .meta
        .inner_instructions
        .iter()
        .flatten()
        .map(|inner| inner.instruction.data[0])
        .collect();
    assert_eq!(opcodes, [12, 9, 9]);
    let classic_success = format!("Program {} success", anchor_spl::token::ID);
    assert_eq!(
        failure
            .meta
            .logs
            .iter()
            .filter(|l| *l == &classic_success)
            .count(),
        2
    );
    assert!(
        failure
            .meta
            .logs
            .iter()
            .any(|l| l.contains("owner does not match")),
        "{failure:?}"
    );
    f.assert_unchanged(before);
}

#[test]
fn wrong_tier_order_and_extra_meta_address_are_rejected_before_sweep() {
    for wrong_tier in [true, false] {
        let mut f = Fixture::new(1_000, None, anchor_spl::token::ID);
        let before = f.snapshot();
        let mut ix = f.instruction(f.creator.pubkey(), f.destination);
        if wrong_tier {
            // tier0/1 occupy account slots 7/8 in the declared instruction.
            ix.accounts.swap(7, 8);
        } else {
            let unrelated = Pubkey::new_unique();
            f.svm
                .set_account(unrelated, f.svm.get_account(&f.extra).unwrap())
                .unwrap();
            ix.accounts[12].pubkey = unrelated;
        }
        let failure = f.send(ix, true).unwrap_err();
        assert!(
            failure
                .meta
                .logs
                .iter()
                .any(|l| l.contains("ConstraintSeeds")),
            "{failure:?}"
        );
        assert!(!failure
            .meta
            .logs
            .iter()
            .any(|l| l.contains("Instruction: TransferChecked")));
        f.assert_unchanged(before);
    }
}
