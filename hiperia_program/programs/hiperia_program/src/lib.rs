use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_lang::system_program::{transfer, Transfer};
use std::str::FromStr;

declare_id!("FxYNWgFbQ9qmvtCq4HNAZoYy3EfTyx45aNGeBxsfdg6c");

const DONATION_WALLET: &str = "Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa";

#[program]
pub mod hiperia_program {
    use super::*;

    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        const MAX_DONATION: u64 = 1_000_000_000_000; // 1000 SOL in lamports
        require!(amount > 0, DonationError::InvalidAmount);
        require!(amount <= MAX_DONATION, DonationError::TooLarge);
        require!(
            ctx.accounts.payer.lamports() >= amount,
            DonationError::InsufficientFunds
        );

        let donation = &mut ctx.accounts.donation;
        donation.donator = ctx.accounts.payer.key();
        donation.amount = amount;
        donation.timestamp = Clock::get()?.unix_timestamp;

        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.donation_wallet.to_account_info(),
            },
        );
        transfer(cpi_context, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = donation_wallet.key() == Pubkey::from_str(DONATION_WALLET).unwrap() @ DonationError::InvalidDonationWallet
    )]
    pub donation_wallet: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 8 + 8, // discriminator + Pubkey + u64 + i64
        seeds = [b"donation", payer.key().as_ref()],
        bump
    )]
    pub donation: Account<'info, DonationAccount>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct DonationAccount {
    pub donator: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum DonationError {
    #[msg("Invalid donation amount")]
    InvalidAmount,
    #[msg("Donation amount exceeds maximum limit (1000 SOL)")]
    TooLarge,
    #[msg("Insufficient funds in payer's account")]
    InsufficientFunds,
    #[msg("Invalid donation wallet address")]
    InvalidDonationWallet,
}