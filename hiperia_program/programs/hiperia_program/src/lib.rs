use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use hiperia_lottery_rng::generate_random_digits;

declare_id!("Hiperia11111111111111111111111111111111111");

#[program]
pub mod hiperia_lottery {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let lottery_state = &mut ctx.accounts.lottery_state;
        lottery_state.authority = ctx.accounts.authority.key();
        lottery_state.ticket_price = 5_000_000; // 0.005 SOL in lamports
        lottery_state.draw_timestamp = 0; // Set by first draw
        lottery_state.prize_pool = 0;
        lottery_state.donation_sum = 0;
        lottery_state.ticket_count = 0;
        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, digit1: u8, digit2: u8) -> Result<()> {
        require!(digit1 >= 1 && digit1 <= 31, LotteryError::InvalidDigit);
        require!(digit2 >= 1 && digit2 <= 31, LotteryError::InvalidDigit);
        require!(digit1 != digit2, LotteryError::DuplicateDigits);
        require!(ctx.accounts.payer.lamports() >= ctx.accounts.lottery_state.ticket_price, LotteryError::InsufficientFunds);

        let ticket = &mut ctx.accounts.ticket;
        ticket.player = ctx.accounts.payer.key();
        ticket.digit1 = digit1;
        ticket.digit2 = digit2;
        ticket.timestamp = Clock::get()?.unix_timestamp;

        let lottery_state = &mut ctx.accounts.lottery_state;
        lottery_state.ticket_count += 1;
        lottery_state.prize_pool += ctx.accounts.lottery_state.ticket_price;

        // Update leaderboard
        let leaderboard = &mut ctx.accounts.leaderboard;
        leaderboard.player = ctx.accounts.payer.key();
        leaderboard.tickets += 1;

        // Transfer ticket price to lottery state account
        transfer(CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.lottery_state.to_account_info(),
            },
        ), ctx.accounts.lottery_state.ticket_price)?;

        Ok(())
    }

    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        require!(amount > 0, LotteryError::InvalidAmount);
        require!(ctx.accounts.payer.lamports() >= amount, LotteryError::InsufficientFunds);

        let donation = &mut ctx.accounts.donation;
        donation.donator = ctx.accounts.payer.key();
        donation.amount = amount;
        donation.timestamp = Clock::get()?.unix_timestamp;

        let lottery_state = &mut ctx.accounts.lottery_state;
        lottery_state.donation_sum += amount;
        lottery_state.prize_pool += amount;

        // Transfer donation to lottery state account
        transfer(CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.lottery_state.to_account_info(),
            },
        ), amount)?;

        Ok(())
    }

    pub fn request_vrf(ctx: Context<RequestVrf>) -> Result<()> {
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        let next_draw = get_next_draw_time(current_time);
        require!(current_time >= next_draw, LotteryError::DrawNotDue);

        let lottery_state = &mut ctx.accounts.lottery_state;
        require!(lottery_state.ticket_count > 0, LotteryError::NoTickets);
        lottery_state.draw_timestamp = next_draw;

        Ok(())
    }

    pub fn fulfill_vrf(ctx: Context<FulfillVrf>) -> Result<()> {
        let lottery_state = &mut ctx.accounts.lottery_state;
        require!(lottery_state.ticket_count > 0, LotteryError::NoTickets);

        // Generate random digits and airdrop winner using RNG module
        let clock = Clock::get()?;
        let rng_result = generate_random_digits(
            &lottery_state.to_account_info().key(),
            &clock,
            ctx.remaining_accounts.len() as u64,
        )?;

        let winning_digits = rng_result.digits;
        let airdrop_winner = rng_result.airdrop_winner.unwrap_or(ctx.remaining_accounts[0].key());

        // Process tickets (simplified, assumes tickets are passed via remaining_accounts)
        let mut winners_exact = vec![];
        let mut winners_any = vec![];
        for ticket_acc in ctx.remaining_accounts.iter() {
            let ticket = Account::<TicketAccount>::try_from(ticket_acc)?;
            let digits = [ticket.digit1, ticket.digit2];
            if digits == winning_digits {
                winners_exact.push((ticket.player, 1_200_000_000)); // 1.2 SOL
            } else if (digits[0] == winning_digits[0] && digits[1] == winning_digits[1]) ||
                     (digits[0] == winning_digits[1] && digits[1] == winning_digits[0]) {
                winners_any.push((ticket.player, 600_000_000)); // 0.6 SOL
            }
        }

        // Distribute prizes
        for (winner, amount) in winners_exact.iter().chain(winners_any.iter()) {
            let winner_account = ctx.accounts.system_program.to_account_info(); // Replace with actual winner account
            transfer(CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.lottery_state.to_account_info(),
                    to: winner_account,
                },
            ), *amount)?;
            let leaderboard = &mut ctx.accounts.leaderboard;
            if leaderboard.player == *winner {
                leaderboard.wins += 1;
            }
        }

        // Airdrop: Award 2 SOL + 50% donations
        let airdrop_amount = 2_000_000_000 + (lottery_state.donation_sum / 2); // 2 SOL + 50% donations
        let airdrop_account = ctx.accounts.system_program.to_account_info(); // Replace with airdrop_winner account
        transfer(CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.lottery_state.to_account_info(),
                to: airdrop_account,
            },
        ), airdrop_amount)?;

        // Reset lottery state
        lottery_state.ticket_count = 0;
        lottery_state.prize_pool = 0;
        lottery_state.donation_sum = 0;
        lottery_state.draw_timestamp = get_next_draw_time(Clock::get()?.unix_timestamp);

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
        space = 8 + 32 + 8 + 8,
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
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestVrf<'info> {
    #[account(mut)]
    pub lottery_state: Account<'info, LotteryState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillVrf<'info> {
    #[account(mut)]
    pub lottery_state: Account<'info, LotteryState>,
    #[account(mut)]
    pub leaderboard: Account<'info, LeaderboardAccount>,
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
}

#[error_code]
pub enum LotteryError {
    #[msg("Invalid digit (must be 1-31)")]
    InvalidDigit,
    #[msg("Digits must be unique")]
    DuplicateDigits,
    #[msg("Insufficient funds for ticket purchase or donation")]
    InsufficientFunds,
    #[msg("Invalid donation amount")]
    InvalidAmount,
    #[msg("Draw not due yet")]
    DrawNotDue,
    #[msg("No tickets purchased for draw")]
    NoTickets,
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