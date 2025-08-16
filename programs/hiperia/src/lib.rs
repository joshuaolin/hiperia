use anchor_lang::prelude::*;

declare_id!("7DfLQnKCcdTY7HxJd5XBTyzRGTsCkDtbAmWRnF2wrnum");

#[program]
pub mod hiperia {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
