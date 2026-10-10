//! Differential tests against the independently specified decimal-string vectors.
//! Uses the existing SBF artifact; does not simulate an unimplemented deposit instruction.
use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program_option::COption, program_pack::Pack},
    AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use pra::state::{Account as TokenAccount, AccountState, Mint};
use programmable_revenue_agreement::{
    accounts, error::PraErrorCode, instruction, AccessMode, AgreementConfig, AgreementStatus,
    ClaimRecord, Party, Split, TierState, AGREEMENT_SEED, CLAIM_SEED, ID, MAX_TIERS, PRECISION,
    TIER_SEED,
};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

#[derive(Clone)]
struct Vector {
    name: String,
    balance: u64,
    acc: [u128; 5],
    last: [u128; 5],
    pending: [u64; 5],
    vault: u64,
    frozen: bool,
    count: u8,
    expected: String,
    discrepancy: String,
}
fn vectors() -> Vec<Vector> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = std::process::Command::new("node")
        .arg(root.join("tests/reference/export-claims.mts"))
        .output()
        .expect("Node 24 required");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| {
            let f: Vec<_> = line.split('\t').collect();
            Vector {
                name: f[0].into(),
                balance: f[1].parse().unwrap(),
                acc: array(f[2]),
                last: array(f[3]),
                pending: array(f[4]),
                vault: f[5].parse().unwrap(),
                frozen: f[6].parse().unwrap(),
                count: f[7].parse().unwrap(),
                expected: f[8].into(),
                discrepancy: f[9].into(),
            }
        })
        .collect()
}
fn array<T: std::str::FromStr + std::fmt::Debug>(s: &str) -> [T; 5]
where
    T::Err: std::fmt::Debug,
{
    s.split(',')
        .map(|s| s.parse().unwrap())
        .collect::<Vec<_>>()
        .try_into()
        .unwrap()
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
struct Fixture {
    svm: LiteSVM,
    holder: Keypair,
    config: Pubkey,
    claim: Pubkey,
    mint: Pubkey,
    payment: Pubkey,
    token: Pubkey,
    destination: Pubkey,
    vault: Pubkey,
    tiers: [Pubkey; 5],
}
impl Fixture {
    fn new(v: &Vector) -> Self {
        let mut svm = LiteSVM::new().with_transaction_history(0);
        svm.add_program_from_file(
            ID,
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../target/deploy/programmable_revenue_agreement.so"),
        )
        .expect("existing SBF artifact required");
        let holder = Keypair::new();
        svm.airdrop(&holder.pubkey(), 1_000_000_000).unwrap();
        let creator = Pubkey::new_unique();
        let agreement_id = 42u64;
        let (config, config_bump) = Pubkey::find_program_address(
            &[
                AGREEMENT_SEED,
                creator.as_ref(),
                &agreement_id.to_le_bytes(),
            ],
            &ID,
        );
        let (claim, bump) = Pubkey::find_program_address(
            &[CLAIM_SEED, config.as_ref(), holder.pubkey().as_ref()],
            &ID,
        );
        let mint = Pubkey::new_unique();
        let payment = Pubkey::new_unique();
        let vault = Pubkey::new_unique();
        let token = Pubkey::new_unique();
        let destination = Pubkey::new_unique();
        let cfg = AgreementConfig {
            agreement_id,
            creator,
            share_mint: mint,
            payment_mint: payment,
            depositor: creator,
            compliance_admin: creator,
            vault,
            treasury: Pubkey::new_unique(),
            payment_destination: Pubkey::new_unique(),
            supply: v.balance,
            share_price: 1,
            access_mode: AccessMode::Open,
            tier_count: v.count,
            start_time: None,
            exp_time: None,
            end_cap: None,
            claim_window: None,
            claim_deadline: None,
            total_deposited: v.vault,
            shares_sold: v.balance,
            status: AgreementStatus::Expired,
            config_bump,
            vault_bump: 0,
            treasury_bump: 0,
        };
        let mut data = serialized(&cfg);
        data.resize(8 + AgreementConfig::INIT_SPACE, 0);
        svm.set_account(config, account(ID, data)).unwrap();
        svm.set_account(
            claim,
            account(
                ID,
                serialized(&ClaimRecord {
                    config,
                    holder: holder.pubkey(),
                    last_acc: v.last,
                    pending: v.pending,
                    frozen: v.frozen,
                    bump,
                }),
            ),
        )
        .unwrap();
        for (key, supply) in [(mint, v.balance), (payment, v.vault)] {
            let mut data = vec![0; Mint::LEN];
            Mint::pack(
                Mint {
                    mint_authority: COption::None,
                    supply,
                    decimals: 6,
                    is_initialized: true,
                    freeze_authority: COption::None,
                },
                &mut data,
            )
            .unwrap();
            svm.set_account(key, account(pra::ID, data)).unwrap();
        }
        for (key, mint, owner, amount) in [
            (token, mint, holder.pubkey(), v.balance),
            (vault, payment, config, v.vault),
            (destination, payment, holder.pubkey(), 0),
        ] {
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
            svm.set_account(key, account(pra::ID, data)).unwrap();
        }
        let tiers = std::array::from_fn(|i| {
            let (key, bump) =
                Pubkey::find_program_address(&[TIER_SEED, config.as_ref(), &[i as u8]], &ID);
            svm.set_account(
                key,
                account(
                    ID,
                    serialized(&TierState {
                        agreement: config,
                        tier_index: i as u8,
                        threshold: u64::MAX,
                        filled: 0,
                        acc_per_token: v.acc[i],
                        splits: std::array::from_fn(|_| Split {
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
        });
        Self {
            svm,
            holder,
            config,
            claim,
            mint,
            payment,
            token,
            destination,
            vault,
            tiers,
        }
    }
    fn send(&mut self) -> litesvm::types::TransactionResult {
        let ix = Instruction {
            program_id: ID,
            accounts: accounts::ClaimTierShare {
                holder: self.holder.pubkey(),
                agreement_config: self.config,
                share_mint: self.mint,
                payment_mint: self.payment,
                holder_share_ata: self.token,
                holder_usdc_ata: self.destination,
                vault: self.vault,
                claim_record: self.claim,
                tier0: self.tiers[0],
                tier1: self.tiers[1],
                tier2: self.tiers[2],
                tier3: self.tiers[3],
                tier4: self.tiers[4],
                token_program: pra::ID,
            }
            .to_account_metas(None),
            data: instruction::ClaimTierShare {}.data(),
        };
        self.svm.send_transaction(Transaction::new(
            &[&self.holder],
            Message::new(&[ix], Some(&self.holder.pubkey())),
            self.svm.latest_blockhash(),
        ))
    }
    fn amount(&self, key: Pubkey) -> u64 {
        TokenAccount::unpack(&self.svm.get_account(&key).unwrap().data)
            .unwrap()
            .amount
    }
    fn record(&self) -> ClaimRecord {
        ClaimRecord::try_deserialize(
            &mut self.svm.get_account(&self.claim).unwrap().data.as_slice(),
        )
        .unwrap()
    }
    fn set_acc(&mut self, acc: u128) {
        let key = self.tiers[0];
        let mut a = self.svm.get_account(&key).unwrap();
        let mut tier = TierState::try_deserialize(&mut a.data.as_slice()).unwrap();
        tier.acc_per_token = acc;
        a.data = serialized(&tier);
        self.svm.set_account(key, a).unwrap();
    }
}

#[test]
fn golden_claim_vectors_match_sbf_including_error_rollback() {
    let all = vectors();
    let mut checked = 0;
    for v in all.iter() {
        let mut f = Fixture::new(v);
        if let Some(payout) = v.expected.strip_prefix("payout:") {
            let payout: u64 = payout.parse().unwrap();
            f.send().unwrap_or_else(|err| panic!("{}: {err:?}", v.name));
            assert_eq!(f.amount(f.destination), payout, "{}", v.name);
            assert_eq!(f.amount(f.vault), v.vault - payout, "{}", v.name);
            let r = f.record();
            for i in 0..MAX_TIERS {
                assert_eq!(
                    r.last_acc[i],
                    if i < v.count as usize {
                        v.acc[i]
                    } else {
                        v.last[i]
                    },
                    "{}",
                    v.name
                );
                assert_eq!(
                    r.pending[i],
                    if i < v.count as usize {
                        0
                    } else {
                        v.pending[i]
                    },
                    "{}",
                    v.name
                );
            }
        } else {
            let error = match v.expected.strip_prefix("error:").unwrap() {
                "NothingToClaim" => PraErrorCode::NothingToClaim,
                "InsufficientVaultFunds" => PraErrorCode::InsufficientVaultFunds,
                "FrozenPosition" => PraErrorCode::FrozenPosition,
                "MathOverflow" | "NarrowingOverflow" => PraErrorCode::MathOverflow,
                other => panic!("unexpected error {other}"),
            };
            let keys = [f.claim, f.vault, f.destination];
            let before = keys.map(|key| f.svm.get_account(&key).unwrap());
            let err = f.send().unwrap_err();
            assert_eq!(
                format!("{:?}", err.err),
                format!("InstructionError(0, Custom({}))", u32::from(error)),
                "{}",
                v.name
            );
            for (key, before) in keys.into_iter().zip(before) {
                assert_eq!(f.svm.get_account(&key).unwrap(), before, "{}", v.name);
            }
        }
        checked += 1;
    }
    assert_eq!(checked, 22);
}

#[test]
fn earnings_narrowing_overflow_rejects_without_state_changes() {
    let all = vectors();
    let v = all
        .iter()
        .find(|v| v.name == "unsafe-earned-narrowing")
        .unwrap();
    assert_eq!(v.expected, "error:NarrowingOverflow");
    // Retain the historical vector: the buggy cast previously paid pending alone.
    assert_eq!(v.discrepancy, "1");
    assert_eq!(
        u128::from(v.balance) * (v.acc[0] - v.last[0]) / PRECISION,
        u128::from(u64::MAX) + 1
    );
    let mut f = Fixture::new(v);
    let mut keys = vec![
        f.config,
        f.claim,
        f.vault,
        f.destination,
        f.token,
        f.mint,
        f.payment,
    ];
    keys.extend(f.tiers);
    let before: Vec<_> = keys
        .iter()
        .map(|key| f.svm.get_account(key).unwrap())
        .collect();
    let failure = f
        .send()
        .expect_err("unrepresentable earnings must reject, never truncate");
    assert_eq!(
        format!("{:?}", failure.err),
        format!(
            "InstructionError(0, Custom({}))",
            u32::from(PraErrorCode::MathOverflow)
        )
    );
    assert!(
        failure
            .meta
            .inner_instructions
            .iter()
            .flatten()
            .next()
            .is_none(),
        "overflow must reject before any token CPI"
    );
    for (key, previous) in keys.iter().zip(before) {
        assert_eq!(
            f.svm.get_account(key).unwrap(),
            previous,
            "account {key} changed on overflow"
        );
    }
    assert_eq!(f.record().last_acc, v.last);
    assert_eq!(f.record().pending, v.pending);
    assert_eq!(f.amount(f.destination), 0);
    assert_eq!(f.amount(f.vault), v.vault);
}

#[test]
fn documented_claim_timing_rounding_discrepancy_is_reproduced() {
    let all = vectors();
    let mut v = all
        .iter()
        .find(|v| v.name == "round-down-positive")
        .unwrap()
        .clone();
    v.vault = 6;
    let mut frequent = Fixture::new(&v);
    frequent.send().unwrap();
    frequent.set_acc(3 * PRECISION);
    frequent.send().unwrap();
    assert_eq!(frequent.amount(frequent.destination), 2);
    v.acc[0] = 3 * PRECISION;
    let mut delayed = Fixture::new(&v);
    delayed.send().unwrap();
    assert_eq!(delayed.amount(delayed.destination), 3);
}
