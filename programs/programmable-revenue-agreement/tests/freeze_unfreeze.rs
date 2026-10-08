//! Local runtime tests. Build first with `anchor build --ignore-keys`.
//! ClaimRecords are injected as fixtures; no production setup instruction is needed.
use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program_option::COption, program_pack::Pack},
    AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use pra::state::{Account as TokenAccount, AccountState, Mint};
use programmable_revenue_agreement::{
    accounts, error::PraErrorCode, instruction, AccessMode, AgreementConfig, AgreementStatus,
    ClaimRecord, AGREEMENT_SEED, CLAIM_SEED, ID, MAX_TIERS,
};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

struct Fixture {
    svm: LiteSVM,
    admin: Keypair,
    outsider: Keypair,
    config: Pubkey,
    mint: Pubkey,
    token: Pubkey,
    claim: Pubkey,
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

impl Fixture {
    fn new(frozen: bool) -> Self {
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
        let cfg = AgreementConfig {
            agreement_id,
            creator,
            share_mint: mint,
            payment_mint: Pubkey::new_unique(),
            depositor: Pubkey::new_unique(),
            compliance_admin: admin.pubkey(),
            vault: Pubkey::new_unique(),
            treasury: Pubkey::new_unique(),
            payment_destination: Pubkey::new_unique(),
            supply: 100,
            share_price: 1,
            access_mode: AccessMode::Open,
            tier_count: 1,
            start_time: None,
            exp_time: Some(i64::MAX),
            end_cap: None,
            total_deposited: 0,
            shares_sold: 10,
            status: AgreementStatus::Active,
            config_bump,
            vault_bump: 0,
            treasury_bump: 0,
        };
        svm.set_account(config, account(ID, serialized(&cfg)))
            .unwrap();
        let record = ClaimRecord {
            config,
            holder,
            last_acc: [7; MAX_TIERS],
            pending: [11; MAX_TIERS],
            frozen,
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
                state: if frozen {
                    AccountState::Frozen
                } else {
                    AccountState::Initialized
                },
                ..TokenAccount::default()
            },
            &mut token_data,
        )
        .unwrap();
        svm.set_account(token, account(pra::ID, token_data))
            .unwrap();
        Self {
            svm,
            admin,
            outsider,
            config,
            mint,
            token,
            claim,
        }
    }

    fn instruction(&self, freeze: bool, authorized: bool) -> Instruction {
        let admin = if authorized {
            self.admin.pubkey()
        } else {
            self.outsider.pubkey()
        };
        let metas = if freeze {
            accounts::FreezePosition {
                compliance_admin: admin,
                agreement_config: self.config,
                share_mint: self.mint,
                holder_share_ata: self.token,
                claim_record: self.claim,
                token_2022_program: pra::ID,
            }
            .to_account_metas(None)
        } else {
            accounts::UnfreezePosition {
                compliance_admin: admin,
                agreement_config: self.config,
                share_mint: self.mint,
                holder_share_ata: self.token,
                claim_record: self.claim,
                token_2022_program: pra::ID,
            }
            .to_account_metas(None)
        };
        Instruction {
            program_id: ID,
            accounts: metas,
            data: if freeze {
                instruction::FreezePosition {}.data()
            } else {
                instruction::UnfreezePosition {}.data()
            },
        }
    }

    fn send(&mut self, freeze: bool, authorized: bool) -> litesvm::types::TransactionResult {
        let ix = self.instruction(freeze, authorized);
        let signer = if authorized {
            &self.admin
        } else {
            &self.outsider
        };
        let tx = Transaction::new(
            &[signer],
            Message::new(&[ix], Some(&signer.pubkey())),
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx)
    }

    fn assert_state(&self, frozen: bool) {
        let claim = self.svm.get_account(&self.claim).unwrap();
        let record = ClaimRecord::try_deserialize(&mut claim.data.as_slice()).unwrap();
        assert_eq!(record.frozen, frozen);
        assert_eq!(record.last_acc, [7; MAX_TIERS]);
        assert_eq!(record.pending, [11; MAX_TIERS]);
        let token = self.svm.get_account(&self.token).unwrap();
        let state = TokenAccount::unpack(&token.data).unwrap();
        assert_eq!(
            state.state,
            if frozen {
                AccountState::Frozen
            } else {
                AccountState::Initialized
            }
        );
        assert_eq!(state.amount, 10);
    }

    fn assert_rejected(&mut self, freeze: bool, authorized: bool, error: PraErrorCode) {
        let before_claim = self.svm.get_account(&self.claim).unwrap();
        let before_token = self.svm.get_account(&self.token).unwrap();
        let failure = self.send(freeze, authorized).unwrap_err();
        // Match the runtime's custom error, not merely any transaction failure.
        assert_eq!(
            format!("{:?}", failure.err),
            format!("InstructionError(0, Custom({}))", u32::from(error))
        );
        assert_eq!(
            self.svm.get_account(&self.claim).unwrap().data,
            before_claim.data
        );
        assert_eq!(
            self.svm.get_account(&self.token).unwrap().data,
            before_token.data
        );
    }
}

#[test]
fn authorized_admin_can_freeze() {
    let mut f = Fixture::new(false);
    f.send(true, true).unwrap();
    f.assert_state(true);
}

#[test]
fn unauthorized_signer_cannot_freeze() {
    let mut f = Fixture::new(false);
    f.assert_rejected(true, false, PraErrorCode::UnauthorizedComplianceAdmin);
    f.assert_state(false);
}

#[test]
fn already_frozen_is_rejected() {
    let mut f = Fixture::new(true);
    f.assert_rejected(true, true, PraErrorCode::PositionAlreadyFrozen);
    f.assert_state(true);
}

#[test]
fn authorized_admin_can_unfreeze() {
    let mut f = Fixture::new(true);
    f.send(false, true).unwrap();
    f.assert_state(false);
}

#[test]
fn unauthorized_signer_cannot_unfreeze() {
    let mut f = Fixture::new(true);
    f.assert_rejected(false, false, PraErrorCode::UnauthorizedComplianceAdmin);
    f.assert_state(true);
}

#[test]
fn already_unfrozen_is_rejected() {
    let mut f = Fixture::new(false);
    f.assert_rejected(false, true, PraErrorCode::PositionAlreadyUnfrozen);
    f.assert_state(false);
}

#[test]
fn freeze_unfreeze_round_trip() {
    let mut f = Fixture::new(false);
    f.send(true, true).unwrap();
    f.assert_state(true);
    f.send(false, true).unwrap();
    f.assert_state(false);
}

#[test]
fn missing_claim_record_is_rejected_for_both_instructions() {
    for freeze in [true, false] {
        let mut f = Fixture::new(!freeze);
        f.claim = Pubkey::new_unique();
        let before = f.svm.get_account(&f.token).unwrap().data;
        let failure = f.send(freeze, true).unwrap_err();
        assert!(
            failure
                .meta
                .logs
                .iter()
                .any(|log| log.contains("AccountNotInitialized")),
            "{:?}",
            failure
        );
        assert_eq!(f.svm.get_account(&f.token).unwrap().data, before);
    }
}
