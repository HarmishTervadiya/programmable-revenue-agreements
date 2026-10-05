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
