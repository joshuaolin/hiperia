use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction, sysvar::rent::Rent};

mod utils;
mod constants;
use crate::utils::*;
use crate::constants::*;

declare_id!("...");

#[program]
pub mod projecthiperia {
    use super::*;

    // Initialize the program state
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let purchase_tracker = &mut ctx.accounts.purchase_tracker;
        let draw_state = &mut ctx.accounts.draw_state;
        let rent = Rent::get()?;
        
        purchase_tracker.tickets = vec![];
        purchase_tracker.ticket_count = 0;

        draw_state.winners = vec![];
        draw_state.draw_time = 0;
        draw_state.airdrop_winner = Pubkey::default();
        draw_state.authority = ctx.accounts.authority.key();
        draw_state.oracle = Pubkey::default();
        draw_state.purchase_tracker_bump = ctx.bumps.purchase_tracker;
        draw_state.draw_executed = false;
        draw_state.funds_withdrawn = false;
        draw_state.nonce = 0;
        
        // Calculate rent-exempt minimum dynamically
        let purchase_tracker_space = 8 + 32768;
        draw_state.treasury_seed = rent.minimum_balance(purchase_tracker_space);
        
        // Store draw_state PDA bump
        draw_state.draw_state_bump = ctx.bumps.draw_state;

        Ok(())
    }

    // Buy a ticket
    pub fn buy_ticket(ctx: Context<BuyTicket>, number1: u8, number2: u8) -> Result<()> {
        require!(number1 >= 1 && number1 <= 31, ErrorCode::InvalidNumber);
        require!(number2 >= 1 && number2 <= 31, ErrorCode::InvalidNumber);
        require!(number1 != number2, ErrorCode::DuplicateNumber);

        let draw_state = &ctx.accounts.draw_state;
        let purchase_tracker = &mut ctx.accounts.purchase_tracker;
        let clock = Clock::get()?;

        require!(
            draw_state.draw_time == 0 || clock.unix_timestamp < draw_state.draw_time,
            ErrorCode::TicketSalesClosed
        );

        let user_tickets: usize = purchase_tracker
            .tickets
            .iter()
            .filter(|t| t.owner == ctx.accounts.user.key())
            .count();
        require!(user_tickets < MAX_TICKETS_PER_USER as usize, ErrorCode::MaxTicketsPerUserReached);
        require!(purchase_tracker.ticket_count < MAX_TOTAL_TICKETS, ErrorCode::MaxSupplyReached);

        let bump = draw_state.purchase_tracker_bump;
        let id_ref = ID.as_ref();
        let seeds = &[b"purchase_tracker".as_ref(), id_ref, &[bump]];
        let signer_seeds = &[&seeds[..]];

        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.user.key(),
                &ctx.accounts.purchase_tracker.key(),
                TICKET_PRICE,
            ),
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.purchase_tracker.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        let ticket = Ticket {
            owner: ctx.accounts.user.key(),
            numbers: [number1, number2],
            timestamp: clock.unix_timestamp,
        };
        purchase_tracker.tickets.push(ticket);
        purchase_tracker.ticket_count = purchase_tracker.ticket_count.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    // Request VRF for draw
    pub fn request_vrf(ctx: Context<RequestVrf>) -> Result<()> {
        let draw_state = &mut ctx.accounts.draw_state;
        let purchase_tracker = &ctx.accounts.purchase_tracker;
        let authority = &ctx.accounts.authority;

        require!(authority.key() == draw_state.authority, ErrorCode::Unauthorized);
        require!(purchase_tracker.ticket_count >= DRAW_TICKET_THRESHOLD, ErrorCode::InsufficientTickets);

        let clock = Clock::get()?;
        draw_state.draw_time = get_next_draw_time(clock.unix_timestamp);
        draw_state.draw_executed = false;
        draw_state.funds_withdrawn = false;
        draw_state.nonce = draw_state.nonce.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

        emit!(VrfRequested { draw_time: draw_state.draw_time });
        Ok(())
    }

    // Fulfill VRF with random numbers
    pub fn fulfill_vrf(
        ctx: Context<FulfillVrf>,
        random_numbers: [u8; 2],
        aux_random: u64,
        nonce: u64,
    ) -> Result<()> {
        let draw_state = &mut ctx.accounts.draw_state;
        let purchase_tracker = &ctx.accounts.purchase_tracker;
        let oracle = &ctx.accounts.oracle;

        require!(oracle.key() == draw_state.oracle && oracle.is_signer, ErrorCode::Unauthorized);
        require!(draw_state.draw_time > 0, ErrorCode::DrawNotReady);
        require!(nonce == draw_state.nonce, ErrorCode::InvalidNonce);
        require!(purchase_tracker.ticket_count > 0, ErrorCode::NoTicketsForAirdrop);
        
        // Critical fix: Prevent duplicate draw numbers
        require!(random_numbers[0] != random_numbers[1], ErrorCode::DuplicateNumber);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= draw_state.draw_time, ErrorCode::DrawNotReady);

        for &n in random_numbers.iter() {
            require!(n >= 1 && n <= 31, ErrorCode::InvalidRandomNumberLength);
        }

        let winners = find_winners_with_limit(purchase_tracker, random_numbers, usize::MAX)?;
        let exact_winners: Vec<Pubkey> = winners.iter().filter(|(_, is_exact)| *is_exact).map(|(owner, _)| *owner).collect();
        let any_order_winners: Vec<Pubkey> = winners.iter().filter(|(_, is_exact)| !*is_exact).map(|(owner, _)| *owner).collect();

        let total_funds = purchase_tracker.to_account_info().lamports();
        let ticket_price_lamports = TICKET_PRICE as u64 * purchase_tracker.ticket_count;
        let donation_pool = total_funds.saturating_sub(ticket_price_lamports);
        let airdrop_fund = (donation_pool / 2).min(500_000_000); // 0.5 SOL cap

        let exact_prize = 1_200_000_000;
        let any_order_prize = 600_000_000;
        let total_prize_pool = (exact_winners.len() as u64 * exact_prize)
            + (any_order_winners.len() as u64 * any_order_prize)
            + airdrop_fund;

        require!(total_prize_pool <= total_funds, ErrorCode::InsufficientFunds);

        draw_state.winners = exact_winners.clone();
        draw_state.winners.extend(any_order_winners.clone());
        draw_state.airdrop_winner = select_airdrop_winner_with_random(purchase_tracker, aux_random)?;
        draw_state.draw_executed = true;

        emit!(DrawSettled {
            exact_winners,
            any_order_winners,
            airdrop_winner: draw_state.airdrop_winner,
            total_prize: total_prize_pool,
        });

        Ok(())
    }

    // Withdraw funds from escrow
    pub fn withdraw_escrow(ctx: Context<WithdrawEscrow>, amount: u64) -> Result<()> {
        let draw_state = &mut ctx.accounts.draw_state;
        require!(ctx.accounts.authority.key() == draw_state.authority, ErrorCode::Unauthorized);
        require!(draw_state.draw_executed, ErrorCode::DrawNotExecuted);
        require!(!draw_state.funds_withdrawn, ErrorCode::FundsAlreadyWithdrawn);
        require!(amount > 0, ErrorCode::InvalidWithdrawAmount);

        let pda_info = ctx.accounts.purchase_tracker.to_account_info();
        let pda_lamports = pda_info.lamports();
        require!(amount <= pda_lamports - draw_state.treasury_seed, ErrorCode::InsufficientFunds);

        let bump = draw_state.purchase_tracker_bump;
        let id_ref = ID.as_ref();
        let seeds = &[b"purchase_tracker".as_ref(), id_ref, &[bump]];
        let signer_seeds = &[&seeds[..]];

        invoke_signed(
            &system_instruction::transfer(&pda_info.key(), &ctx.accounts.destination.key(), amount),
            &[pda_info.clone(), ctx.accounts.destination.to_account_info(), ctx.accounts.system_program.to_account_info()],
            signer_seeds,
        )?;

        let purchase_tracker = &mut ctx.accounts.purchase_tracker;
        purchase_tracker.tickets.clear();
        purchase_tracker.ticket_count = 0;

        draw_state.funds_withdrawn = true;
        draw_state.winners.clear();
        draw_state.airdrop_winner = Pubkey::default();
        draw_state.draw_time = 0;

        Ok(())
    }

    // Change authority
    pub fn change_authority(ctx: Context<ChangeAuthority>, new_authority: Pubkey) -> Result<()> {
        let draw_state = &mut ctx.accounts.draw_state;
        require!(ctx.accounts.authority.key() == draw_state.authority, ErrorCode::Unauthorized);

        let old = draw_state.authority;
        draw_state.authority = new_authority;
        emit!(AuthorityChanged {
            old_authority: old,
            new_authority
        });
        Ok(())
    }

    // Set oracle
    pub fn set_oracle(ctx: Context<SetOracle>, oracle: Pubkey) -> Result<()> {
        let draw_state = &mut ctx.accounts.draw_state;
        require!(ctx.accounts.authority.key() == draw_state.authority, ErrorCode::Unauthorized);

        draw_state.oracle = oracle;
        emit!(OracleUpdated { oracle });
        Ok(())
    }
}

// === Account Definitions ===

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, seeds = [b"purchase_tracker", ID.as_ref()], bump, space = 8 + 32768)]
    pub purchase_tracker: Account<'info, PurchaseTracker>,

    #[account(init, payer = authority, seeds = [b"draw_state", ID.as_ref()], bump, space = 8 + 10240)]
    pub draw_state: Account<'info, DrawState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut, seeds = [b"purchase_tracker", ID.as_ref()], bump = draw_state.purchase_tracker_bump)]
    pub purchase_tracker: Account<'info, PurchaseTracker>,

    #[account(seeds = [b"draw_state", ID.as_ref()], bump = draw_state.draw_state_bump)]
    pub draw_state: Account<'info, DrawState>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestVrf<'info> {
    #[account(mut, seeds = [b"draw_state", ID.as_ref()], bump = draw_state.draw_state_bump)]
    pub draw_state: Account<'info, DrawState>,

    #[account(mut, seeds = [b"purchase_tracker", ID.as_ref()], bump = draw_state.purchase_tracker_bump)]
    pub purchase_tracker: Account<'info, PurchaseTracker>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillVrf<'info> {
    #[account(mut, seeds = [b"draw_state", ID.as_ref()], bump = draw_state.draw_state_bump)]
    pub draw_state: Account<'info, DrawState>,

    #[account(mut, seeds = [b"purchase_tracker", ID.as_ref()], bump = draw_state.purchase_tracker_bump)]
    pub purchase_tracker: Account<'info, PurchaseTracker>,

    pub oracle: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawEscrow<'info> {
    #[account(mut, seeds = [b"draw_state", ID.as_ref()], bump = draw_state.draw_state_bump)]
    pub draw_state: Account<'info, DrawState>,

    #[account(mut, seeds = [b"purchase_tracker", ID.as_ref()], bump = draw_state.purchase_tracker_bump)]
    pub purchase_tracker: Account<'info, PurchaseTracker>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub destination: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ChangeAuthority<'info> {
    #[account(mut, seeds = [b"draw_state", ID.as_ref()], bump = draw_state.draw_state_bump)]
    pub draw_state: Account<'info, DrawState>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetOracle<'info> {
    #[account(mut, seeds = [b"draw_state", ID.as_ref()], bump = draw_state.draw_state_bump)]
    pub draw_state: Account<'info, DrawState>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

// === State ===

#[account]
pub struct PurchaseTracker {
    pub tickets: Vec<Ticket>,
    pub ticket_count: u64,
}

#[account]
pub struct DrawState {
    pub winners: Vec<Pubkey>,
    pub draw_time: i64,
    pub airdrop_winner: Pubkey,
    pub authority: Pubkey,
    pub oracle: Pubkey,
    pub purchase_tracker_bump: u8,
    pub draw_state_bump: u8, // NEW: Added for PDA verification
    pub draw_executed: bool,
    pub funds_withdrawn: bool,
    pub nonce: u64,
    pub treasury_seed: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Ticket {
    pub owner: Pubkey,
    pub numbers: [u8; 2],
    pub timestamp: i64,
}

// === Events ===

#[event]
pub struct VrfRequested {
    pub draw_time: i64,
}

#[event]
pub struct AuthorityChanged {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct OracleUpdated {
    pub oracle: Pubkey,
}

#[event]
pub struct DrawSettled {
    pub exact_winners: Vec<Pubkey>,
    pub any_order_winners: Vec<Pubkey>,
    pub airdrop_winner: Pubkey,
    pub total_prize: u64,
}

// === Errors ===

#[error_code]
pub enum ErrorCode {
    #[msg("Number must be between 1 and 31")]
    InvalidNumber,
    #[msg("Numbers cannot be the same")]
    DuplicateNumber,
    #[msg("Draw not ready")]
    DrawNotReady,
    #[msg("Ticket sales are closed for this draw")]
    TicketSalesClosed,
    #[msg("User already bought maximum tickets for this draw")]
    MaxTicketsPerUserReached,
    #[msg("Not enough tickets sold to start draw")]
    InsufficientTickets,
    #[msg("Invalid random number or out of allowed range")]
    InvalidRandomNumberLength,
    #[msg("No tickets available for airdrop")]
    NoTicketsForAirdrop,
    #[msg("Unauthorized action")]
    Unauthorized,
    #[msg("Maximum supply reached")]
    MaxSupplyReached,
    #[msg("Integer math overflow")]
    MathOverflow,
    #[msg("Insufficient PDA funds")]
    InsufficientFunds,
    #[msg("Draw has not been executed")]
    DrawNotExecuted,
    #[msg("Escrow funds already withdrawn")]
    FundsAlreadyWithdrawn,
    #[msg("Invalid withdraw amount")]
    InvalidWithdrawAmount,
    #[msg("Invalid system program supplied")]
    InvalidSystemProgram,
    #[msg("Invalid nonce")]
    InvalidNonce,
}