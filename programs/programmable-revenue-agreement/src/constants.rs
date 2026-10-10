use anchor_lang::prelude::*;

#[constant]
pub const AGREEMENT_SEED: &[u8] = b"agreement";

#[constant]
pub const TIER_SEED: &[u8] = b"tier";

#[constant]
pub const TREASURY_SEED: &[u8] = b"treasury";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[constant]
pub const MAX_BPS: u64 = 10000;

pub const MAX_SPLITS: usize = 4;

pub const MAX_TIERS: usize = 5;

pub const PRECISION: u128 = 1_000_000_000_000;

#[constant]
pub const CLAIM_SEED: &[u8] = b"claim";

#[constant]
pub const EXTRA_METAS: &[u8] = b"extra-account-metas";

#[constant]
pub const DUST_ALLOWANCE: u64 = 1_000;
