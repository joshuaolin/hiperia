use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use solana_program::keccak::{hashv};

declare_id!("ByMjwdbvNGEbVNt89aLkg86Em25cpVPgqaZN2fMs1X7T");

/// settlement window in seconds (5 minutes)
const SETTLEMENT_WINDOW_SECS: i64 = 300;

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

    /// one-time config
    pub fn initialize(
        ctx: Context<Initialize>,
        ticket_cost_lamports: u64,
        payout_lamports: u64,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.is_initialized, ErrorCode::AlreadyInitialized);

        cfg.is_initialized = true;
        cfg.ticket_cost_lamports = ticket_cost_lamports;
        cfg.payout_lamports = payout_lamports;

        // anchor 0.31: bumps are fields
        cfg.bump = ctx.bumps.config;
        ctx.accounts.vault.bump = ctx.bumps.vault;
        Ok(())
    }

    /// user buys a ticket with two ordered numbers and a target draw_time
    pub fn buy_ticket(
        ctx: Context<BuyTicket>,
        ticket_nonce: u64,
        draw_time: i64,
        numbers: [u8; NUM_PICKS],
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(cfg.is_initialized, ErrorCode::Uninitialized);

        // validate picks
        require!(valid_numbers(&numbers), ErrorCode::InvalidNumbers);

        // take payment into vault
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

        // record ticket
        let t = &mut ctx.accounts.ticket;
        t.user = ctx.accounts.user.key();
        t.nonce = ticket_nonce;
        t.draw_time = draw_time;
        t.paid_lamports = cfg.ticket_cost_lamports;
        t.settled = false;
        t.bump = ctx.bumps.ticket;
        t.numbers = numbers;

        Ok(())
    }

    /// publish result numbers for a draw_time (anyone can call, once).
    /// demo rng: keccak(clock.now, draw_time, vault, config)
    pub fn publish_result(ctx: Context<PublishResult>, draw_time: i64) -> Result<()> {
        let clock = Clock::get()?;
        // allow publication at >= draw_time (or slightly before if you want)
        require!(clock.unix_timestamp >= draw_time, ErrorCode::TooEarly);

        let r = &mut ctx.accounts.result;
        require!(!r.is_published, ErrorCode::AlreadyPublished);

        let digest = hashv(&[
            &clock.unix_timestamp.to_le_bytes(),
            &draw_time.to_le_bytes(),
            ctx.accounts.vault.key().as_ref(),
            ctx.accounts.config.key().as_ref(),
        ])
        .0;

        // derive two distinct 1..=MAX_NUMBER ordered values from digest
        let mut a = (u16::from(digest[0]) << 8 | u16::from(digest[1])) % (MAX_NUMBER as u16);
        let mut b = (u16::from(digest[2]) << 8 | u16::from(digest[3])) % (MAX_NUMBER as u16);

        // map 0..(MAX_NUMBER-1) → 1..=MAX_NUMBER
        let mut na = (a as u8) + 1;
        let mut nb = (b as u8) + 1;
        if na == nb {
            // push second forward cyclically to ensure distinct
            nb = if nb == MAX_NUMBER { 1 } else { nb + 1 };
        }

        r.draw_time = draw_time;
        r.numbers = [na, nb]; // ordered
        r.is_published = true;
        r.bump = ctx.bumps.result;

        Ok(())
    }

    /// settle a ticket: must be within [draw_time, draw_time + window]; pays if exact ordered match
    pub fn settle_ticket(ctx: Context<SettleTicket>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let t = &mut ctx.accounts.ticket;

        // only owner can settle (optional)
        require_keys_eq!(t.user, ctx.accounts.user.key(), ErrorCode::Unauthorized);
        require!(!t.settled, ErrorCode::AlreadySettled);
        require!(
            within_window(now, t.draw_time, SETTLEMENT_WINDOW_SECS),
            ErrorCode::SettlementWindowClosed
        );

        // ensure result exists & published
        let r = &ctx.accounts.result;
        require!(r.is_published, ErrorCode::ResultNotPublished);
        require_eq!(r.draw_time, t.draw_time, ErrorCode::MismatchedDraw);

        // match if both ordered numbers equal
        let is_winner = t.numbers == r.numbers;

        if is_winner {
            // pay fixed payout from vault to user
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

        // mark settled either way (one ticket, one outcome)
        t.settled = true;
        Ok(())
    }
}

/* ---------------- helpers ---------------- */

fn within_window(current_time: i64, draw_time: i64, window_secs: i64) -> bool {
    let end = draw_time.saturating_add(window_secs.max(0));
    current_time >= draw_time && current_time <= end
}

fn valid_numbers(nums: &[u8; NUM_PICKS]) -> bool {
    // two distinct picks in 1..=MAX_NUMBER
    let a = nums[0];
    let b = nums[1];
    a >= 1 && a <= MAX_NUMBER && b >= 1 && b <= MAX_NUMBER && a != b
}

/* ---------------- accounts ---------------- */

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

    // result for this draw_time must already exist
    #[account(
        seeds = [RESULT_SEED, &ticket.draw_time.to_le_bytes()],
        bump = result.bump
    )]
    pub result: Account<'info, ResultAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/* ---------------- data structs ---------------- */

#[account]
pub struct Config {
    pub is_initialized: bool,      // 1
    pub bump: u8,                  // 1
    pub ticket_cost_lamports: u64, // 8
    pub payout_lamports: u64,      // 8
    pub numbers: [u8; 2],
}
impl Config {
    pub const SPACE: usize = 8 + 1 + 1 + 8 + 8;
}

#[account]
pub struct Vault {
    pub bump: u8, // 1
}
impl Vault {
    pub const SPACE: usize = 8 + 1;
}

#[account]
pub struct Ticket {
    pub user: Pubkey,            // 32
    pub nonce: u64,              // 8
    pub draw_time: i64,          // 8
    pub paid_lamports: u64,      // 8
    pub settled: bool,           // 1
    pub bump: u8,                // 1
    pub numbers: [u8; NUM_PICKS] // 2
}
impl Ticket {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 1 + 1 + NUM_PICKS; // = 8+32+8+8+8+1+1+2
}

#[account]
pub struct ResultAccount {
    pub draw_time: i64,           // 8
    pub numbers: [u8; NUM_PICKS], // 2
    pub is_published: bool,       // 1
    pub bump: u8,                 // 1
}
impl ResultAccount {
    pub const SPACE: usize = 8 + 8 + NUM_PICKS + 1 + 1; // 8 disc + fields
}

/* ---------------- errors ---------------- */

#[error_code]
pub enum ErrorCode {
    #[msg("Program already initialized")]
    AlreadyInitialized,
    #[msg("Program not initialized")]
    Uninitialized,
    #[msg("Settlement window closed")]
    SettlementWindowClosed,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Ticket already settled")]
    AlreadySettled,
    #[msg("Bump not found")]
    BumpNotFound,
    #[msg("Invalid numbers")]
    InvalidNumbers,
    #[msg("Result already published")]
    AlreadyPublished,
    #[msg("Result not published")]
    ResultNotPublished,
    #[msg("Too early to publish result")]
    TooEarly,
    #[msg("Result/ticket draw mismatch")]
    MismatchedDraw,
}
