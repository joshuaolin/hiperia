use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use solana_system_interface::transfer;
use anchor_lang::solana_program::sysvar::rent::Rent;

mod utils;
mod constants;
use crate::utils::*;
use crate::constants::*;

declare_id!("B71ikRSMNVSAoxsYPZarMnghd5zztXzUxomTtRMvsGAz"); // Replace with actual program ID

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

        draw_state.draw_time = 0;
        draw_state.airdrop_winner = Pubkey::default();
        draw_state.authority = ctx.accounts.authority.key();
        draw_state.oracle = Pubkey::default();
        draw_state.purchase_tracker_bump = ctx.bumps.purchase_tracker;
        draw_state.draw_state_bump = ctx.bumps.draw_state;
        draw_state.draw_executed = false;
        draw_state.nonce = 0;
        draw_state.winning_numbers = [0, 0];
        draw_state.airdrop_fund = 0;
        
        // Calculate rent-exempt minimum dynamically
        let purchase_tracker_space = 8 + 32768;
        draw_state.treasury_seed = rent.minimum_balance(purchase_tracker_space);

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

        invoke_signed(
            &transfer(
                &ctx.accounts.user.key(),
                &ctx.accounts.purchase_tracker.key(),
                TICKET_PRICE,
            ),
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.purchase_tracker.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[],
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
        draw_state.nonce = draw_state.nonce.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

        emit!(VrfRequested { draw_time: draw_state.draw_time });
        Ok(())
    }

    // Fulfill VRF with random numbers and auto-send prizes
    pub fn fulfill_vrf(
        ctx: Context<FulfillVrf>,
        random_numbers: [u8; 2],
        aux_random: u64,
        nonce: u64,
    ) -> Result<()> {
        let draw_state = &mut ctx.accounts.draw_state;
        let purchase_tracker = &mut ctx.accounts.purchase_tracker;
        let oracle = &ctx.accounts.oracle;

        require!(oracle.key() == draw_state.oracle && oracle.is_signer, ErrorCode::Unauthorized);
        require!(draw_state.draw_time > 0, ErrorCode::DrawNotReady);
        require!(nonce == draw_state.nonce, ErrorCode::InvalidNonce);
        require!(purchase_tracker.ticket_count > 0, ErrorCode::NoTicketsForAirdrop);
        
        require!(random_numbers[0] != random_numbers[1], ErrorCode::DuplicateNumber);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= draw_state.draw_time, ErrorCode::DrawNotReady);

        for &n in random_numbers.iter() {
            require!(n >= 1 && n <= 31, ErrorCode::InvalidRandomNumberLength);
        }

        let winners = find_winners_with_limit(purchase_tracker, random_numbers, usize::MAX)?;
        let exact_prize = 1_200_000_000; // 1.2 SOL
        let any_order_prize = 600_000_000; // 0.6 SOL

        // Group prizes by owner
        let mut prize_map: std::collections::HashMap<Pubkey, u64> = std::collections::HashMap::new();
        for (owner, is_exact) in winners.iter() {
            let prize = if *is_exact { exact_prize } else { any_order_prize };
            *prize_map.entry(*owner).or_insert(0) += prize;
        }

        let total_funds = purchase_tracker.to_account_info().lamports();
        let ticket_price_lamports = TICKET_PRICE as u64 * purchase_tracker.ticket_count;
        let donation_pool = total_funds.saturating_sub(ticket_price_lamports);
        let airdrop_fund = (donation_pool / 2).min(500_000_000); // 0.5 SOL cap

        let mut total_prize_pool = airdrop_fund;
        for &prize in prize_map.values() {
            total_prize_pool += prize;
        }

        require!(total_prize_pool <= total_funds, ErrorCode::InsufficientFunds);

        draw_state.airdrop_winner = select_airdrop_winner_with_random(purchase_tracker, aux_random)?;
        draw_state.draw_executed = true;
        draw_state.winning_numbers = random_numbers;
        draw_state.airdrop_fund = airdrop_fund;

        let bump = draw_state.purchase_tracker_bump;
        let id_ref = ID.as_ref();
        let seeds = &[b"purchase_tracker".as_ref(), id_ref, &[bump]];
        let signer_seeds = &[&seeds[..]];

        // Auto-transfer prizes to winners using remaining_accounts
        let remaining_accounts = ctx.remaining_accounts;
        for (owner, prize) in prize_map.iter() {
            let winner_account = remaining_accounts.iter().find(|acc| acc.key() == *owner)
                .ok_or(ErrorCode::InvalidWinnerAccount)?;
            invoke_signed(
                &transfer(
                    &ctx.accounts.purchase_tracker.key(),
                    owner,
                    *prize,
                ),
                &[
                    ctx.accounts.purchase_tracker.to_account_info(),
                    winner_account.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer_seeds,
            )?;
        }

        // Auto-transfer airdrop
        if airdrop_fund > 0 {
            let airdrop_account = remaining_accounts.iter().find(|acc| acc.key() == draw_state.airdrop_winner)
                .ok_or(ErrorCode::InvalidWinnerAccount)?;
            invoke_signed(
                &transfer(
                    &ctx.accounts.purchase_tracker.key(),
                    &draw_state.airdrop_winner,
                    airdrop_fund,
                ),
                &[
                    ctx.accounts.purchase_tracker.to_account_info(),
                    airdrop_account.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer_seeds,
            )?;
        }

        // Reset state for next draw
        purchase_tracker.tickets.clear();
        purchase_tracker.ticket_count = 0;
        draw_state.draw_time = 0;
        draw_state.airdrop_winner = Pubkey::default();
        draw_state.draw_executed = false;
        draw_state.winning_numbers = [0, 0];
        draw_state.airdrop_fund = 0;

        emit!(DrawSettled {
            exact_winners: winners.iter().filter(|(_, is_exact)| *is_exact).map(|(owner, _)| *owner).collect(),
            any_order_winners: winners.iter().filter(|(_, is_exact)| !*is_exact).map(|(owner, _)| *owner).collect(),
            airdrop_winner: draw_state.airdrop_winner,
            total_prize: total_prize_pool,
        });

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
    pub draw_time: i64,
    pub airdrop_winner: Pubkey,
    pub authority: Pubkey,
    pub oracle: Pubkey,
    pub purchase_tracker_bump: u8,
    pub draw_state_bump: u8,
    pub draw_executed: bool,
    pub nonce: u64,
    pub treasury_seed: u64,
    pub winning_numbers: [u8; 2],
    pub airdrop_fund: u64,
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
    #[msg("Invalid winner account")]
    InvalidWinnerAccount,
    #[msg("Invalid nonce")]
    InvalidNonce,
}