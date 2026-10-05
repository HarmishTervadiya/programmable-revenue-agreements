use anchor_lang::prelude::*;

#[error_code]
pub enum PraErrorCode {
    #[msg("Access mode only allows Open and Allowlist")]
    InvalidAccessMode,
}
