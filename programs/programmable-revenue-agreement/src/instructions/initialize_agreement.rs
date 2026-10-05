use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeAgreement {}

impl InitializeAgreement {
    pub fn initialize(&mut self) -> Result<()> {
        Ok(())
    }
}
