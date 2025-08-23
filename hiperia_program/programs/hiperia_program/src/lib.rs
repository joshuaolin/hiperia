use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("9bGeMZAaj9Tiw9Qwh9Uv2hh7F56tPCCc5qDTcREsMqJC");

#[program]
pub mod donation_program {
    use super::*;

    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        const MAX_DONATION: u64 = 1_000_000_000_000; // 1000 SOL
        require!(amount > 0, DonationError::InvalidAmount);
        require!(amount <= MAX_DONATION, DonationError::TooLarge);
        require!(
            ctx.accounts.payer.lamports() >= amount,
            DonationError::InsufficientFunds
        );

        // update per-user donation account (stores last donation)
        let donation = &mut ctx.accounts.donation;
        donation.donator = ctx.accounts.payer.key();
        donation.amount = amount;
        donation.timestamp = Clock::get()?.unix_timestamp;

        // update leaderboard entry
        let leaderboard = &mut ctx.accounts.leaderboard;
        leaderboard.player = ctx.accounts.payer.key();
        leaderboard.total_donations =
            leaderboard.total_donations.saturating_add(amount);

        // transfer lamports into vault
        let system_program = ctx.accounts.system_program.to_account_info();
        let vault_info = ctx.accounts.vault.to_account_info();

        transfer(
            CpiContext::new(
                system_program,
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: vault_info,
                },
            ),
            amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// vault PDA to hold all donations
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    /// each user has a single DonationAccount
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 8 + 8, // discriminator + pubkey + amount + timestamp
        seeds = [b"donation", payer.key().as_ref()],
        bump
    )]
    pub donation: Account<'info, DonationAccount>,

    /// per-user leaderboard entry
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 8,
        seeds = [b"leaderboard", payer.key().as_ref()],
        bump
    )]
    pub leaderboard: Account<'info, LeaderboardAccount>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct DonationAccount {
    pub donator: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[account]
pub struct LeaderboardAccount {
    pub player: Pubkey,
    pub total_donations: u64,
}

#[error_code]
pub enum DonationError {
    #[msg("Invalid donation amount")]
    InvalidAmount,
    #[msg("Donation too large (max 1000 SOL)")]
    TooLarge,
    #[msg("Insufficient funds")]
    InsufficientFunds,
}
