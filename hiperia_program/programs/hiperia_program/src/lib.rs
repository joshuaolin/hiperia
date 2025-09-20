use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_lang::solana_program::keccak::hashv;

declare_id!("4BqH8D4WRxthkMBKjyFHoWVBbrogaCWJf8oC2tV2HGnR");

/// settlement window in seconds (5 minutes)
const SETTLEMENT_WINDOW_SECS: i64 = 300;

/// optional guard: allow buying tickets within this many hours of the target draw
const BUY_AHEAD_LIMIT_HOURS: i64 = 24;

/// game domain
const MAX_NUMBER: u8 = 22;
const NUM_PICKS: usize = 2;

/// pda seeds
const CONFIG_SEED: &[u8] = b"config";
const VAULT_SEED: &[u8] = b"vault";
const TICKET_SEED: &[u8] = b"ticket";
const RESULT_SEED: &[u8] = b"result";

#[program]
pub mod hiperia_program {
    use super::*;

    /// Initialize program config
    pub fn initialize(
        ctx: Context<Initialize>,
        ticket_cost_lamports: u64,
        payout_lamports: u64,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.is_initialized, ErrorCode::AlreadyInitialized);
        require!(ticket_cost_lamports > 0, ErrorCode::InvalidTicketCost);
        require!(payout_lamports > 0, ErrorCode::InvalidPayout);

        cfg.is_initialized = true;
        cfg.ticket_cost_lamports = ticket_cost_lamports;
        cfg.payout_lamports = payout_lamports;
        cfg.bump = ctx.bumps.config;

        ctx.accounts.vault.bump = ctx.bumps.vault;

        emit!(Initialized {
            ticket_cost_lamports,
            payout_lamports
        });

        Ok(())
    }

    /// User buys a ticket with two ordered numbers and a target draw_time
    pub fn buy_ticket(
        ctx: Context<BuyTicket>,
        ticket_nonce: u64,
        draw_time: i64,
        numbers: [u8; NUM_PICKS],
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(cfg.is_initialized, ErrorCode::Uninitialized);
        require!(valid_numbers(&numbers), ErrorCode::InvalidNumbers);

        let now = Clock::get()?.unix_timestamp;
        require!(
            draw_time >= now.saturating_sub(60 * 60) &&
            draw_time <= now.saturating_add(60 * 60 * BUY_AHEAD_LIMIT_HOURS),
            ErrorCode::BadDrawTime
        );

        // Validate nonce uniqueness (optional, but recommended)
        let existing_tickets = ctx.remaining_accounts.iter().filter(|acc| {
            acc.owner == ctx.program_id && acc.data.borrow()[8..40] == ctx.accounts.user.key().to_bytes()
        });
        for acc in existing_tickets {
            let ticket = Ticket::try_deserialize(&mut &acc.data.borrow()[..])?;
            require!(ticket.nonce != ticket_nonce, ErrorCode::NonceAlreadyUsed);
        }

        // Transfer payment to vault
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            cfg.ticket_cost_lamports,
        )?;

        let t = &mut ctx.accounts.ticket;
        t.user = ctx.accounts.user.key();
        t.nonce = ticket_nonce;
        t.draw_time = draw_time;
        t.paid_lamports = cfg.ticket_cost_lamports;
        t.settled = false;
        t.bump = ctx.bumps.ticket;
        t.numbers = numbers;

        emit!(TicketPurchased {
            user: t.user,
            nonce: t.nonce,
            draw_time: t.draw_time,
            numbers: t.numbers,
            paid_lamports: t.paid_lamports,
        });

        Ok(())
    }

    /// Publish result numbers for a draw_time (demo RNG, replace with oracle in production)
    pub fn publish_result(ctx: Context<PublishResult>, draw_time: i64) -> Result<()> {
        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= draw_time, ErrorCode::TooEarly);

        let r = &mut ctx.accounts.result;
        require!(!r.is_published, ErrorCode::AlreadyPublished);

        // TODO: For production, use a secure RNG like Chainlink VRF instead of keccak
        let digest = hashv(&[
            &clock.unix_timestamp.to_le_bytes(),
            &draw_time.to_le_bytes(),
            ctx.accounts.vault.key().as_ref(),
            ctx.accounts.config.key().as_ref(),
        ])
        .0;

        let a = (u16::from(digest[0]) << 8 | u16::from(digest[1])) % (MAX_NUMBER as u16);
        let b = (u16::from(digest[2]) << 8 | u16::from(digest[3])) % (MAX_NUMBER as u16);

        let na = (a as u8) + 1;  // Removed `mut` as suggested
        let mut nb = (b as u8) + 1;  // Kept `mut` because it’s modified below
        if na == nb {
            nb = if nb == MAX_NUMBER { 1 } else { nb + 1 };
        }

        r.draw_time = draw_time;
        r.numbers = [na, nb];
        r.is_published = true;
        r.bump = ctx.bumps.result;

        emit!(ResultPublished {
            draw_time,
            numbers: r.numbers,
        });

        Ok(())
    }

    /// Settle a ticket within the settlement window
    pub fn settle_ticket(ctx: Context<SettleTicket>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let t = &mut ctx.accounts.ticket;

        require_keys_eq!(t.user, ctx.accounts.user.key(), ErrorCode::Unauthorized);
        require!(!t.settled, ErrorCode::AlreadySettled);
        require!(
            within_window(now, t.draw_time, SETTLEMENT_WINDOW_SECS),
            ErrorCode::SettlementWindowClosed
        );

        let r = &ctx.accounts.result;
        require!(r.is_published, ErrorCode::ResultNotPublished);
        require_eq!(r.draw_time, t.draw_time, ErrorCode::MismatchedDraw);

        let is_winner = t.numbers == r.numbers;

        if is_winner {
            let payout = ctx.accounts.config.payout_lamports;
            let signer_seeds: &[&[u8]] = &[VAULT_SEED, &[ctx.accounts.vault.bump]];

            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.user.to_account_info(),
                    },
                    &[signer_seeds],
                ),
                payout,
            )?;
        }

        t.settled = true;

        emit!(TicketSettled {
            user: t.user,
            nonce: t.nonce,
            draw_time: t.draw_time,
            numbers: t.numbers,
            is_winner,
        });

        Ok(())
    }
}

fn within_window(current_time: i64, draw_time: i64, window_secs: i64) -> bool {
    let end = draw_time.saturating_add(window_secs.max(0));
    current_time >= draw_time && current_time <= end
}

fn valid_numbers(nums: &[u8; NUM_PICKS]) -> bool {
    let a = nums[0];
    let b = nums[1];
    a >= 1 && a <= MAX_NUMBER && b >= 1 && b <= MAX_NUMBER && a != b
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = Config::SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = Vault::SPACE,
        seeds = [VAULT_SEED],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ticket_nonce: u64, draw_time: i64, numbers: [u8; 2])]
pub struct BuyTicket<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::Uninitialized
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = user,
        space = Ticket::SPACE,
        seeds = [
            TICKET_SEED,
            user.key().as_ref(),
            &ticket_nonce.to_le_bytes()
        ],
        bump
    )]
    pub ticket: Account<'info, Ticket>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(draw_time: i64)]
pub struct PublishResult<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::Uninitialized
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [VAULT_SEED],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = payer,
        space = ResultAccount::SPACE,
        seeds = [RESULT_SEED, &draw_time.to_le_bytes()],
        bump
    )]
    pub result: Account<'info, ResultAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleTicket<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::Uninitialized
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [
            TICKET_SEED,
            ticket.user.as_ref(),
            &ticket.nonce.to_le_bytes()
        ],
        bump = ticket.bump,
        constraint = !ticket.settled @ ErrorCode::AlreadySettled
    )]
    pub ticket: Account<'info, Ticket>,

    #[account(
        seeds = [RESULT_SEED, &ticket.draw_time.to_le_bytes()],
        bump = result.bump
    )]
    pub result: Account<'info, ResultAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Config {
    pub is_initialized: bool,      // 1
    pub bump: u8,                  // 1
    pub ticket_cost_lamports: u64, // 8
    pub payout_lamports: u64,      // 8
    pub padding: [u8; 32],         // 32 for future use
}
impl Config {
    pub const SPACE: usize = 8 + 1 + 1 + 8 + 8 + 32;
}

#[account]
pub struct Vault {
    pub bump: u8,      // 1
    pub padding: [u8; 32], // 32 for future use
}
impl Vault {
    pub const SPACE: usize = 8 + 1 + 32;
}

#[account]
pub struct Ticket {
    pub user: Pubkey,            // 32
    pub nonce: u64,              // 8
    pub draw_time: i64,          // 8
    pub paid_lamports: u64,      // 8
    pub settled: bool,           // 1
    pub bump: u8,                // 1
    pub numbers: [u8; NUM_PICKS], // 2
    pub padding: [u8; 32],       // 32 for future use
}
impl Ticket {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 1 + 1 + NUM_PICKS + 32;
}

#[account]
pub struct ResultAccount {
    pub draw_time: i64,           // 8
    pub numbers: [u8; NUM_PICKS], // 2
    pub is_published: bool,       // 1
    pub bump: u8,                 // 1
    pub padding: [u8; 32],       // 32 for future use
}
impl ResultAccount {
    pub const SPACE: usize = 8 + 8 + NUM_PICKS + 1 + 1 + 32;
}

#[event]
pub struct Initialized {
    pub ticket_cost_lamports: u64,
    pub payout_lamports: u64,
}

#[event]
pub struct TicketPurchased {
    pub user: Pubkey,
    pub nonce: u64,
    pub draw_time: i64,
    pub numbers: [u8; 2],
    pub paid_lamports: u64,
}

#[event]
pub struct ResultPublished {
    pub draw_time: i64,
    pub numbers: [u8; 2],
}

#[event]
pub struct TicketSettled {
    pub user: Pubkey,
    pub nonce: u64,
    pub draw_time: i64,
    pub numbers: [u8; 2],
    pub is_winner: bool,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Program already initialized")]
    AlreadyInitialized,
    #[msg("Program not initialized")]
    Uninitialized,
    #[msg("Settlement window closed")]
    SettlementWindowClosed,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Ticket already settled")]
    AlreadySettled,
    #[msg("Invalid numbers selected")]
    InvalidNumbers,
    #[msg("Result already published")]
    AlreadyPublished,
    #[msg("Result not yet published")]
    ResultNotPublished,
    #[msg("Too early to publish result")]
    TooEarly,
    #[msg("Result and ticket draw times do not match")]
    MismatchedDraw,
    #[msg("Draw time too far in past or future")]
    BadDrawTime,
    #[msg("Ticket nonce already used")]
    NonceAlreadyUsed,
    #[msg("Invalid ticket cost")]
    InvalidTicketCost,
    #[msg("Invalid payout amount")]
    InvalidPayout,
}