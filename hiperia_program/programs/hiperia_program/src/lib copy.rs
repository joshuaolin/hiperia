use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use sha2::{Digest, Sha256};

declare_id!("B71ikRSMNVSAoxsYPZarMnghd5zztXzUxomTtRMvsGAz");

#[program]
pub mod hiperia_lottery {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let lottery_state = &mut ctx.accounts.lottery_state;
        lottery_state.authority = ctx.accounts.authority.key();
        lottery_state.ticket_price = 5_000_000; // 0.005 SOL
        lottery_state.draw_timestamp = 0;
        lottery_state.prize_pool = 0;
        lottery_state.donation_sum = 0;
        lottery_state.ticket_count = 0;
        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, digit1: u8, digit2: u8) -> Result<()> {
        require!(digit1 >= 1 && digit1 <= 31, LotteryError::InvalidDigit);
        require!(digit2 >= 1 && digit2 <= 31, LotteryError::InvalidDigit);
        require!(digit1 != digit2, LotteryError::DuplicateDigits);
        require!(
            ctx.accounts.payer.lamports() >= ctx.accounts.lottery_state.ticket_price,
            LotteryError::InsufficientFunds
        );

        let ticket = &mut ctx.accounts.ticket;
        ticket.player = ctx.accounts.payer.key();
        ticket.digit1 = digit1;
        ticket.digit2 = digit2;
        ticket.timestamp = Clock::get()?.unix_timestamp;

        let lottery_state = &mut ctx.accounts.lottery_state;
        lottery_state.ticket_count += 1;
        lottery_state.prize_pool += lottery_state.ticket_price;

        let leaderboard = &mut ctx.accounts.leaderboard;
        leaderboard.player = ctx.accounts.payer.key();
        leaderboard.tickets += 1;

        let system_program = ctx.accounts.system_program.to_account_info();
        let lottery_info = lottery_state.to_account_info();

        transfer(
            CpiContext::new(
                system_program,
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: lottery_info,
                },
            ),
            lottery_state.ticket_price,
        )?;

        Ok(())
    }

    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        const MAX_DONATION: u64 = 1_000_000_000_000; // 1000 SOL
        require!(amount > 0, LotteryError::InvalidDonationAmount);
        require!(amount <= MAX_DONATION, LotteryError::DonationTooLarge);
        require!(
            ctx.accounts.payer.lamports() >= amount,
            LotteryError::InsufficientFunds
        );

        let donation = &mut ctx.accounts.donation;
        donation.donator = ctx.accounts.payer.key();
        donation.amount = amount;
        donation.timestamp = Clock::get()?.unix_timestamp;

        let lottery_state = &mut ctx.accounts.lottery_state;
        lottery_state.donation_sum += amount;
        lottery_state.prize_pool += amount;

        let leaderboard = &mut ctx.accounts.leaderboard;
        leaderboard.player = ctx.accounts.payer.key();
        leaderboard.donations += amount;

        let system_program = ctx.accounts.system_program.to_account_info();
        let lottery_info = lottery_state.to_account_info();

        transfer(
            CpiContext::new(
                system_program,
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: lottery_info,
                },
            ),
            amount,
        )?;

        Ok(())
    }

    pub fn draw<'info>(ctx: Context<'info, 'info, 'info, 'info, Draw<'info>>) -> Result<()> {
        // --- phase 1: use mutable borrow just for checks and rng
        let (next_draw, rng_result, donation_sum) = {
            let lottery_state = &mut ctx.accounts.lottery_state;

            require!(lottery_state.ticket_count > 0, LotteryError::NoTickets);

            let clock = Clock::get()?;
            let current_time = clock.unix_timestamp;
            let next_draw = get_next_draw_time(current_time);
            require!(current_time >= next_draw, LotteryError::DrawNotDue);

            let rng_result = generate_random_digits(
                &lottery_state.to_account_info().key(),
                &clock,
                lottery_state.ticket_count,
                ctx.remaining_accounts,
            )?;

            let donation_sum = lottery_state.donation_sum;
            lottery_state.draw_timestamp = next_draw;

            (next_draw, rng_result, donation_sum)
        }; // <- mutable borrow ends here

        // --- phase 2: immutable work with remaining_accounts
        let system_program = ctx.accounts.system_program.to_account_info();
        let lottery_info = ctx.accounts.lottery_state.to_account_info();

        let winning_digits = rng_result.digits;
        let airdrop_winner = rng_result
            .airdrop_winner
            .unwrap_or(ctx.remaining_accounts[0].key());

        let mut winners_exact = Vec::new();
        let mut winners_any = Vec::new();

        for ticket_acc in ctx.remaining_accounts.iter() {
            let ticket = Account::<TicketAccount>::try_from(ticket_acc)?;
            let digits = [ticket.digit1, ticket.digit2];
            if digits == winning_digits {
                winners_exact.push((ticket.player, 1_200_000_000));
            } else if (digits[0] == winning_digits[0] && digits[1] == winning_digits[1])
                || (digits[0] == winning_digits[1] && digits[1] == winning_digits[0])
            {
                winners_any.push((ticket.player, 600_000_000));
            }
        }

        for (winner, amount) in winners_exact.iter().chain(winners_any.iter()) {
            let winner_account = ctx
                .remaining_accounts
                .iter()
                .find(|acc| acc.key() == *winner)
                .ok_or(LotteryError::InvalidWinnerAccount)?
                .to_account_info();

            transfer(
                CpiContext::new(
                    system_program.clone(),
                    Transfer {
                        from: lottery_info.clone(),
                        to: winner_account,
                    },
                ),
                *amount,
            )?;

            let leaderboard = &mut ctx.accounts.leaderboard;
            if leaderboard.player == *winner {
                leaderboard.wins += 1;
            }
        }

        // airdrop
        let airdrop_amount = 2_000_000_000 + (donation_sum / 2);
        let airdrop_account = ctx
            .remaining_accounts
            .iter()
            .find(|acc| acc.key() == airdrop_winner)
            .ok_or(LotteryError::InvalidWinnerAccount)?
            .to_account_info();

        transfer(
            CpiContext::new(
                system_program,
                Transfer {
                    from: lottery_info,
                    to: airdrop_account,
                },
            ),
            airdrop_amount,
        )?;

        // --- phase 3: reborrow mut to reset
        let lottery_state = &mut ctx.accounts.lottery_state;
        lottery_state.ticket_count = 0;
        lottery_state.prize_pool = 0;
        lottery_state.donation_sum = 0;
        lottery_state.draw_timestamp = next_draw;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 8 + 8 + 8 + 8,
        seeds = [b"lottery-state"],
        bump
    )]
    pub lottery_state: Account<'info, LotteryState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(digit1: u8, digit2: u8)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub lottery_state: Account<'info, LotteryState>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 1 + 1 + 8,
        seeds = [b"ticket", payer.key().as_ref(), &lottery_state.ticket_count.to_le_bytes()],
        bump
    )]
    pub ticket: Account<'info, TicketAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 8 + 8 + 8,
        seeds = [b"leaderboard", payer.key().as_ref()],
        bump
    )]
    pub leaderboard: Account<'info, LeaderboardAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub lottery_state: Account<'info, LotteryState>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 8 + 8,
        seeds = [b"donation", payer.key().as_ref(), &Clock::get()?.unix_timestamp.to_le_bytes()],
        bump
    )]
    pub donation: Account<'info, DonationAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 8 + 8 + 8,
        seeds = [b"leaderboard", payer.key().as_ref()],
        bump
    )]
    pub leaderboard: Account<'info, LeaderboardAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Draw<'info> {
    #[account(mut)]
    pub lottery_state: Account<'info, LotteryState>,
    #[account(mut)]
    pub leaderboard: Account<'info, LeaderboardAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct LotteryState {
    pub authority: Pubkey,
    pub ticket_price: u64,
    pub draw_timestamp: i64,
    pub prize_pool: u64,
    pub donation_sum: u64,
    pub ticket_count: u64,
}

#[account]
pub struct TicketAccount {
    pub player: Pubkey,
    pub digit1: u8,
    pub digit2: u8,
    pub timestamp: i64,
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
    pub tickets: u64,
    pub wins: u64,
    pub donations: u64,
}

#[error_code]
pub enum LotteryError {
    #[msg("Invalid digit (must be 1-31)")]
    InvalidDigit,
    #[msg("Digits must be unique")]
    DuplicateDigits,
    #[msg("Insufficient funds for ticket purchase or donation")]
    InsufficientFunds,
    #[msg("Invalid donation amount. Must be greater than 0 SOL.")]
    InvalidDonationAmount,
    #[msg("Donation amount cannot exceed 1000 SOL.")]
    DonationTooLarge,
    #[msg("Draw not due yet")]
    DrawNotDue,
    #[msg("No tickets purchased for draw")]
    NoTickets,
    #[msg("Invalid winner account")]
    InvalidWinnerAccount,
}

fn get_next_draw_time(current_time: i64) -> i64 {
    let one_day = 24 * 60 * 60;
    let draw_time_utc = 14 * 60 * 60 - 8 * 60 * 60; // 2:00 PM UTC+8 to UTC
    let current_day_start = current_time - (current_time % one_day);
    let next_draw = current_day_start + draw_time_utc + one_day;
    if current_time >= current_day_start + draw_time_utc {
        next_draw + one_day
    } else {
        next_draw
    }
}

pub struct RngResult {
    pub digits: [u8; 2],
    pub airdrop_winner: Option<Pubkey>,
}

pub fn generate_random_digits(
    lottery_state: &Pubkey,
    clock: &Clock,
    ticket_count: u64,
    remaining_accounts: &[AccountInfo],
) -> Result<RngResult> {
    let mut hasher = Sha256::new();
    hasher.update(lottery_state.as_ref());
    hasher.update(&clock.unix_timestamp.to_le_bytes());
    hasher.update(&ticket_count.to_le_bytes());
    let result = hasher.finalize();

    let mut digits = [0u8; 2];
    digits[0] = (result[0] % 31) + 1;
    digits[1] = (result[1] % 31) + 1;
    if digits[1] == digits[0] {
        digits[1] = ((digits[1] + 1) % 31) + 1;
    }

    let airdrop_winner = if ticket_count > 0 {
        let index = (result[2] as u64 % ticket_count) as usize;
        remaining_accounts.get(index).map(|acc| acc.key())
    } else {
        None
    };

    Ok(RngResult {
        digits,
        airdrop_winner,
    })
}
