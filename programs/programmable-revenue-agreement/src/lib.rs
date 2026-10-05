pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2iEFwZ8qPjvEfSAtHqE7G7apQo9tVKFsiLrdAFC5sXop");

#[program]
pub mod programmable_revenue_agreement {
    use super::*;

    pub fn initialize_agreement(ctx: Context<InitializeAgreement>) -> Result<()> {
        ctx.accounts.initialize()
    }
}
