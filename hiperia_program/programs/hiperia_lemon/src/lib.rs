use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::hashv,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    system_instruction,
};
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("7ZDTrz498pQuMyV4frPv2cZu5vR1ZrpfzFWAPGpVGcYr");

const MIN_NUMBER: u8 = 0;
const MAX_NUMBER: u8 = 9;
const QUICK_COST: u64 = 7_200_000;
const DAILY_COST: u64 = 6_250_000;
const BASE_PRIZE: u64 = 2_500_000_000;
const DAILY_PRIZE: u64 = 4_750_000_000;
const OUTCOME_COUNT: u16 = 1_000;
const BUY_AHEAD_SECONDS: i64 = 86_400;
const REFUND_AFTER_SECONDS: i64 = 86_400;
const DAILY_INTERVAL: i64 = 14_400;
const DAILY_OFFSET: i64 = 10_800;
const DAILY_HOURS: [u8; 6] = [3, 7, 11, 15, 19, 23];
const CONFIG_SEED: &[u8] = b"config";
const VAULT_SEED: &[u8] = b"vault";
const TICKET_SEED: &[u8] = b"ticket";
const DRAW_SEED: &[u8] = b"draw";
const BANKROLL_SEED: &[u8] = b"bankroll-draw";
const BANKROLL_VERSION_SEED: &[u8] = b"v1";
const CLIENT_SEED: &[u8] = b"oracle-client";
const REQUEST_SEED: &[u8] = b"orao-vrf-randomness-request";
const RANDOMNESS_DOMAIN: &[u8] = b"hiperia-lemon-vrf-v1";
const PENDING_REQUEST_SPACE: usize = 749;
const FULFILLED_REQUEST_SPACE: usize = 137;
const REQUEST_DISCRIMINATOR: [u8; 8] = [38, 151, 209, 6, 195, 102, 28, 217];
const RANDOMNESS_DISCRIMINATOR: [u8; 8] = [139, 239, 184, 215, 227, 86, 191, 226];
const NETWORK_DISCRIMINATOR: [u8; 8] = [212, 237, 148, 56, 97, 245, 51, 169];
const ADMIN: Pubkey = Pubkey::new_from_array([
    28, 43, 82, 159, 210, 138, 77, 138, 204, 1, 163, 32, 151, 71, 49, 247, 221, 252, 123, 74, 21,
    62, 203, 193, 151, 138, 173, 173, 138, 5, 57, 119,
]);
const ORACLE_ID: Pubkey = Pubkey::new_from_array([
    7, 71, 177, 26, 250, 145, 180, 209, 249, 34, 242, 123, 14, 186, 193, 218, 178, 59, 33, 41,
    164, 190, 243, 79, 50, 164, 123, 88, 245, 206, 252, 120,
]);
const NETWORK_ID: Pubkey = Pubkey::new_from_array([
    62, 222, 115, 93, 185, 139, 92, 162, 172, 202, 195, 188, 18, 105, 229, 75, 84, 9, 229, 234,
    44, 43, 246, 178, 190, 13, 128, 219, 16, 238, 143, 140,
]);

#[program]
pub mod hiperia_lemon {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        ticket_cost_lamports: u64,
        payout_lamports: u64,
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.payer.key(), ADMIN, ErrorCode::Unauthorized);
        require_eq!(ticket_cost_lamports, QUICK_COST, ErrorCode::InvalidTicketCost);
        require_eq!(payout_lamports, BASE_PRIZE, ErrorCode::InvalidPayout);
        let config = &mut ctx.accounts.config;
        config.is_initialized = true;
        config.bump = ctx.bumps.config;
        config.ticket_cost_lamports = ticket_cost_lamports;
        config.payout_lamports = payout_lamports;
        config.padding = ADMIN.to_bytes();
        ctx.accounts.vault.bump = ctx.bumps.vault;
        ctx.accounts.vault.padding = [0; 32];
        Ok(())
    }

    pub fn get_rules(ctx: Context<GetRules>) -> Result<LemonRules> {
        game_rules(ctx.accounts.config.ticket_cost_lamports, ctx.accounts.config.payout_lamports)
    }

    pub fn get_access_rules(_ctx: Context<GetRules>) -> Result<AccessRules> {
        Ok(AccessRules { revision: 1, public_play: true, public_results: true })
    }

    pub fn get_randomness_rules(_ctx: Context<GetRules>) -> Result<RandomnessRules> {
        Ok(RandomnessRules {
            revision: 1,
            oracle_program: ORACLE_ID,
            refund_after_seconds: REFUND_AFTER_SECONDS as u32,
            pending_request_space: PENDING_REQUEST_SPACE as u16,
        })
    }

    pub fn get_bankroll_rules(_ctx: Context<GetRules>) -> Result<BankrollRules> {
        Ok(BankrollRules {
            revision: 1, daily_enabled: true, quick_enabled: true,
            entry_refunds_reserved: true, prize_reserved_at_purchase: false,
            claim_requires_funding: true, ticket_version: 4,
            ledger_account_space: BankrollDraw::SPACE as u16,
        })
    }

    pub fn buy_bankroll_ticket(
        ctx: Context<BuyBankrollTicket>, ticket_nonce: u64, draw_time: i64, numbers: [u8; 3],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(valid_numbers(&numbers), ErrorCode::InvalidNumbers);
        require!(draw_time > now && draw_time <= now.saturating_add(BUY_AHEAD_SECONDS), ErrorCode::BadDrawTime);
        require!(draw_time.rem_euclid(DAILY_INTERVAL) != 7_200, ErrorCode::BadDrawTime);
        let cost = draw_cost(draw_time, ctx.accounts.config.ticket_cost_lamports);
        let prize = draw_prize(draw_time, ctx.accounts.config.payout_lamports)?;
        let draw_info = ctx.accounts.draw.to_account_info();
        let mut draw = load_or_create_draw(
            &draw_info, &ctx.accounts.user.to_account_info(), &ctx.accounts.system_program.to_account_info(),
            draw_time, ctx.bumps.draw, cost, prize,
        )?;
        require_eq!(draw.status, 0, ErrorCode::DrawNotOpen);
        require_eq!(draw.ticket_cost_lamports, cost, ErrorCode::InvalidTicketCost);
        require_eq!(draw.payout_lamports, prize, ErrorCode::InvalidPayout);
        let ledger_info = ctx.accounts.bankroll_draw.to_account_info();
        let mut ledger = load_or_create_bankroll(
            &ledger_info, &ctx.accounts.user.to_account_info(), &ctx.accounts.system_program.to_account_info(),
            &draw, ctx.bumps.bankroll_draw,
        )?;
        validate_bankroll_draw(&ledger, &draw)?;
        require_eq!(ledger.phase, 0, ErrorCode::InvalidBankrollDraw);
        let previous = ledger.pending_entry_lamports;
        ledger.unsettled_entries = ledger.unsettled_entries.checked_add(1).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
        ledger.pending_entry_lamports = previous.checked_add(cost).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
        let after = replace_reserved_liability(&ctx.accounts.vault, previous, ledger.pending_entry_lamports, cost, 0)?;
        draw.ticket_count = draw.ticket_count.checked_add(1).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
        transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), Transfer {
            from: ctx.accounts.user.to_account_info(), to: ctx.accounts.vault.to_account_info(),
        }), cost)?;
        ctx.accounts.vault.padding[..8].copy_from_slice(&after.to_le_bytes());
        let ticket = &mut ctx.accounts.ticket;
        ticket.user = ctx.accounts.user.key();
        ticket.nonce = ticket_nonce;
        ticket.draw_time = draw_time;
        ticket.paid_lamports = cost;
        ticket.settled = false;
        ticket.bump = ctx.bumps.ticket;
        ticket.numbers = numbers;
        ticket.padding = bankroll_prize_snapshot(prize)?;
        save_draw(&draw_info, &draw)?;
        ledger.try_serialize(&mut &mut ledger_info.try_borrow_mut_data()?[..])?;
        emit!(TicketPurchased { user: ticket.user, nonce: ticket_nonce, draw_time, numbers, paid_lamports: cost });
        Ok(())
    }

    pub fn reconcile_bankroll_draw(ctx: Context<ReconcileBankrollDraw>, draw_time: i64) -> Result<()> {
        require_eq!(ctx.accounts.draw.draw_time, draw_time, ErrorCode::MismatchedDraw);
        reconcile_bankroll(&mut ctx.accounts.vault, &ctx.accounts.draw, &mut ctx.accounts.bankroll_draw)
    }

    pub fn settle_bankroll_ticket(ctx: Context<SettleBankrollTicket>) -> Result<()> {
        let ticket = &ctx.accounts.ticket;
        validate_ticket_owner(ticket, ctx.accounts.user.key())?;
        require!(Clock::get()?.unix_timestamp >= ticket.draw_time, ErrorCode::TooEarly);
        validate_bankroll_ticket(ticket, &ctx.accounts.draw)?;
        reconcile_bankroll(&mut ctx.accounts.vault, &ctx.accounts.draw, &mut ctx.accounts.bankroll_draw)?;
        let is_winner = ticket.numbers == ctx.accounts.draw.numbers;
        let payout = if is_winner { bankroll_ticket_prize(&ticket.padding)? } else { 0 };
        let info = ctx.accounts.vault.to_account_info();
        let owner = ctx.accounts.user.to_account_info();
        let reserved = reserved_liability(&ctx.accounts.vault.padding)?;
        let rent = Rent::get()?.minimum_balance(info.data_len());
        let (vault_after, owner_after) = bankroll_payout_balances(info.lamports(), owner.lamports(), payout, rent, reserved)?;
        ctx.accounts.bankroll_draw.unsettled_entries = ctx.accounts.bankroll_draw.unsettled_entries.checked_sub(1)
            .ok_or_else(|| error!(ErrorCode::InvalidBankrollDraw))?;
        if payout > 0 {
            **info.try_borrow_mut_lamports()? = vault_after;
            **owner.try_borrow_mut_lamports()? = owner_after;
        }
        let ticket = &mut ctx.accounts.ticket;
        ticket.settled = true;
        emit!(TicketSettled { user: ticket.user, nonce: ticket.nonce, draw_time: ticket.draw_time, numbers: ticket.numbers, is_winner });
        Ok(())
    }

    pub fn release_bankroll_losing_ticket(ctx: Context<ReleaseBankrollLosingTicket>) -> Result<()> {
        let ticket = &ctx.accounts.ticket;
        validate_ticket_owner(ticket, ticket.user)?;
        require!(Clock::get()?.unix_timestamp >= ticket.draw_time, ErrorCode::TooEarly);
        validate_bankroll_ticket(ticket, &ctx.accounts.draw)?;
        require!(ticket.numbers != ctx.accounts.draw.numbers, ErrorCode::WinningTicketCannotRelease);
        reconcile_bankroll(&mut ctx.accounts.vault, &ctx.accounts.draw, &mut ctx.accounts.bankroll_draw)?;
        ctx.accounts.bankroll_draw.unsettled_entries = ctx.accounts.bankroll_draw.unsettled_entries.checked_sub(1)
            .ok_or_else(|| error!(ErrorCode::InvalidBankrollDraw))?;
        let ticket = &mut ctx.accounts.ticket;
        ticket.settled = true;
        emit!(TicketSettled { user: ticket.user, nonce: ticket.nonce, draw_time: ticket.draw_time, numbers: ticket.numbers, is_winner: false });
        Ok(())
    }

    pub fn refund_bankroll_ticket(ctx: Context<RefundBankrollTicket>) -> Result<()> {
        let ticket = &ctx.accounts.ticket;
        let draw = &ctx.accounts.draw;
        validate_ticket_owner(ticket, ctx.accounts.user.key())?;
        validate_bankroll_ticket(ticket, draw)?;
        require!(refund_due(ticket.draw_time, Clock::get()?.unix_timestamp), ErrorCode::RefundNotAvailable);
        match draw.status {
            0 => require_keys_eq!(ctx.accounts.oracle_request.key(), System::id(), ErrorCode::InvalidOracleRequest),
            1 => {
                require_keys_eq!(ctx.accounts.oracle_request.key(), draw.oracle_request, ErrorCode::InvalidOracleRequest);
                validate_oracle_request(&ctx.accounts.oracle_request.to_account_info(), &draw.oracle_client, &draw.seed, Some(false))?;
            }
            _ => return err!(ErrorCode::RefundNotAvailable),
        }
        let ledger = &mut ctx.accounts.bankroll_draw;
        validate_bankroll_draw(ledger, draw)?;
        require_eq!(ledger.phase, 0, ErrorCode::InvalidBankrollDraw);
        let previous = ledger.pending_entry_lamports;
        ledger.unsettled_entries = ledger.unsettled_entries.checked_sub(1).ok_or_else(|| error!(ErrorCode::InvalidBankrollDraw))?;
        ledger.pending_entry_lamports = previous.checked_sub(ticket.paid_lamports).ok_or_else(|| error!(ErrorCode::InvalidBankrollDraw))?;
        let after = replace_reserved_liability(&ctx.accounts.vault, previous, ledger.pending_entry_lamports, 0, ticket.paid_lamports)?;
        let info = ctx.accounts.vault.to_account_info();
        let owner = ctx.accounts.user.to_account_info();
        let rent = Rent::get()?.minimum_balance(info.data_len());
        let (vault_after, owner_after) = payout_balances(info.lamports(), owner.lamports(), ticket.paid_lamports, rent, after)?;
        **info.try_borrow_mut_lamports()? = vault_after;
        **owner.try_borrow_mut_lamports()? = owner_after;
        ctx.accounts.vault.padding[..8].copy_from_slice(&after.to_le_bytes());
        let ticket = &mut ctx.accounts.ticket;
        ticket.settled = true;
        ticket.padding[9] = 1;
        emit!(TicketRefunded { user: ticket.user, nonce: ticket.nonce, draw_time: ticket.draw_time, paid_lamports: ticket.paid_lamports });
        Ok(())
    }

    pub fn request_draw(
        ctx: Context<RequestDraw>,
        draw_time: i64,
        nonce: [u8; 32],
        max_fee_lamports: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_request_window(&ctx.accounts.draw, now)?;
        let (treasury, fee) = oracle_network(&ctx.accounts.network_state.to_account_info())?;
        require_keys_eq!(ctx.accounts.treasury.key(), treasury, ErrorCode::InvalidOracleNetwork);
        require!(fee <= max_fee_lamports, ErrorCode::OracleFeeExceeded);
        let draw_key = ctx.accounts.draw.key();
        let seed = request_seed(&draw_key, &nonce);
        let expected_request = Pubkey::find_program_address(&[REQUEST_SEED, &seed], &ORACLE_ID).0;
        require_keys_eq!(ctx.accounts.oracle_request.key(), expected_request, ErrorCode::InvalidOracleRequest);
        let request_info = ctx.accounts.oracle_request.to_account_info();
        require!(request_info.owner == &System::id() && request_info.data_is_empty() && request_info.lamports() == 0, ErrorCode::OracleRequestAlreadyExists);
        let rent = Rent::get()?;
        let funding = fee.checked_add(rent.minimum_balance(PENDING_REQUEST_SPACE))
            .and_then(|amount| amount.checked_add(rent.minimum_balance(0)))
            .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
        let client_info = ctx.accounts.oracle_client.to_account_info();
        require!(client_info.data_is_empty(), ErrorCode::InvalidOracleClient);
        let top_up = funding.saturating_sub(client_info.lamports());
        if top_up > 0 {
            transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), Transfer {
                from: ctx.accounts.requester.to_account_info(), to: client_info.clone(),
            }), top_up)?;
        }
        let mut instruction_data = Vec::with_capacity(40);
        instruction_data.extend_from_slice(&REQUEST_DISCRIMINATOR);
        instruction_data.extend_from_slice(&seed);
        let instruction = Instruction {
            program_id: ORACLE_ID,
            accounts: vec![
                AccountMeta::new(client_info.key(), true),
                AccountMeta::new(ctx.accounts.network_state.key(), false),
                AccountMeta::new(ctx.accounts.treasury.key(), false),
                AccountMeta::new(request_info.key(), false),
                AccountMeta::new_readonly(System::id(), false),
            ],
            data: instruction_data,
        };
        let draw_bytes = draw_time.to_le_bytes();
        let bump = [ctx.bumps.oracle_client];
        let signer: &[&[u8]] = &[CLIENT_SEED, &draw_bytes, &bump];
        invoke_signed(&instruction, &[
            client_info.clone(),
            ctx.accounts.network_state.to_account_info(),
            ctx.accounts.treasury.to_account_info(),
            request_info.clone(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.oracle_program.to_account_info(),
        ], &[signer])?;
        validate_oracle_request(&request_info, &client_info.key(), &seed, Some(false))?;
        let draw = &mut ctx.accounts.draw;
        draw.status = 1;
        draw.seed = seed;
        draw.oracle_request = expected_request;
        draw.oracle_client = client_info.key();
        draw.requested_by = ctx.accounts.requester.key();
        draw.requested_at = now;
        emit!(RandomnessRequested { draw_time, request: expected_request, client: client_info.key(), requested_by: draw.requested_by, seed });
        Ok(())
    }

    pub fn finalize_draw(ctx: Context<FinalizeDraw>, draw_time: i64) -> Result<()> {
        let draw = &ctx.accounts.draw;
        require_eq!(draw.status, 1, ErrorCode::DrawNotPending);
        require_eq!(draw.draw_time, draw_time, ErrorCode::MismatchedDraw);
        require_keys_eq!(ctx.accounts.oracle_request.key(), draw.oracle_request, ErrorCode::InvalidOracleRequest);
        let randomness = validate_oracle_request(
            &ctx.accounts.oracle_request.to_account_info(), &draw.oracle_client, &draw.seed, Some(true),
        )?.ok_or_else(|| error!(ErrorCode::RandomnessPending))?;
        let numbers = winning_numbers(&randomness)?;
        let draw = &mut ctx.accounts.draw;
        draw.numbers = numbers;
        draw.status = 2;
        emit!(DrawFinalized { draw_time, numbers, request: draw.oracle_request });
        Ok(())
    }

    pub fn reclaim_oracle_funding(ctx: Context<ReclaimOracleFunding>, draw_time: i64) -> Result<()> {
        let draw = &ctx.accounts.draw;
        require_eq!(draw.status, 2, ErrorCode::ResultNotPublished);
        require_eq!(draw.draw_time, draw_time, ErrorCode::MismatchedDraw);
        require_keys_eq!(ctx.accounts.oracle_client.key(), draw.oracle_client, ErrorCode::InvalidOracleClient);
        require_keys_eq!(ctx.accounts.requester.key(), draw.requested_by, ErrorCode::Unauthorized);
        require!(!ctx.accounts.requester.executable, ErrorCode::Unauthorized);
        let draw_bytes = draw_time.to_le_bytes();
        let bump = [ctx.bumps.oracle_client];
        let signer: &[&[u8]] = &[CLIENT_SEED, &draw_bytes, &bump];
        let remaining = ctx.accounts.oracle_client.to_account_info().lamports();
        if remaining > 0 {
            invoke_signed(
                &system_instruction::transfer(&ctx.accounts.oracle_client.key(), &ctx.accounts.requester.key(), remaining),
                &[
                    ctx.accounts.oracle_client.to_account_info(),
                    ctx.accounts.requester.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[signer],
            )?;
        }
        Ok(())
    }
}

fn is_daily(draw_time: i64) -> bool {
    draw_time.rem_euclid(DAILY_INTERVAL) == DAILY_OFFSET
}

fn draw_cost(draw_time: i64, quick_cost: u64) -> u64 {
    if is_daily(draw_time) { DAILY_COST } else { quick_cost }
}

fn load_or_create_draw<'info>(
    info: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    draw_time: i64,
    bump: u8,
    cost: u64,
    prize: u64,
) -> Result<Draw> {
    if info.owner == &crate::ID {
        require_eq!(info.data_len(), Draw::SPACE, ErrorCode::InvalidDraw);
        let draw = Draw::try_deserialize(&mut &info.try_borrow_data()?[..])?;
        require_eq!(draw.draw_time, draw_time, ErrorCode::MismatchedDraw);
        require_eq!(draw.bump, bump, ErrorCode::InvalidDraw);
        return Ok(draw);
    }
    require!(info.owner == &System::id() && info.data_is_empty(), ErrorCode::InvalidDraw);
    let top_up = Rent::get()?.minimum_balance(Draw::SPACE).saturating_sub(info.lamports());
    if top_up > 0 {
        invoke_signed(&system_instruction::transfer(payer.key, info.key, top_up), &[payer.clone(), info.clone(), system_program.clone()], &[])?;
    }
    let time_bytes = draw_time.to_le_bytes();
    let bump_bytes = [bump];
    let signer: &[&[u8]] = &[DRAW_SEED, &time_bytes, &bump_bytes];
    invoke_signed(&system_instruction::allocate(info.key, Draw::SPACE as u64), &[info.clone(), system_program.clone()], &[signer])?;
    invoke_signed(&system_instruction::assign(info.key, &crate::ID), &[info.clone(), system_program.clone()], &[signer])?;
    Ok(Draw {
        draw_time, bump, status: 0, ticket_count: 0, seed: [0; 32],
        oracle_request: Pubkey::default(), oracle_client: Pubkey::default(), requested_by: Pubkey::default(),
        requested_at: 0, numbers: [0, 0, 0], is_daily: is_daily(draw_time), ticket_cost_lamports: cost, payout_lamports: prize,
    })
}

fn save_draw(info: &AccountInfo, draw: &Draw) -> Result<()> {
    draw.try_serialize(&mut &mut info.try_borrow_mut_data()?[..])
}

fn load_or_create_bankroll<'info>(
    info: &AccountInfo<'info>, payer: &AccountInfo<'info>, system_program: &AccountInfo<'info>,
    draw: &Draw, bump: u8,
) -> Result<BankrollDraw> {
    if info.owner == &crate::ID {
        require_eq!(info.data_len(), BankrollDraw::SPACE, ErrorCode::InvalidBankrollDraw);
        let ledger = BankrollDraw::try_deserialize(&mut &info.try_borrow_data()?[..])?;
        require_eq!(ledger.bump, bump, ErrorCode::InvalidBankrollDraw);
        validate_bankroll_draw(&ledger, draw)?;
        return Ok(ledger);
    }
    require!(info.owner == &System::id() && info.data_is_empty(), ErrorCode::InvalidBankrollDraw);
    let top_up = Rent::get()?.minimum_balance(BankrollDraw::SPACE).saturating_sub(info.lamports());
    if top_up > 0 {
        invoke_signed(&system_instruction::transfer(payer.key, info.key, top_up), &[payer.clone(), info.clone(), system_program.clone()], &[])?;
    }
    let time = draw.draw_time.to_le_bytes();
    let bump_bytes = [bump];
    let seeds: &[&[u8]] = &[BANKROLL_SEED, BANKROLL_VERSION_SEED, &time, &bump_bytes];
    invoke_signed(&system_instruction::allocate(info.key, BankrollDraw::SPACE as u64), &[info.clone(), system_program.clone()], &[seeds])?;
    invoke_signed(&system_instruction::assign(info.key, &crate::ID), &[info.clone(), system_program.clone()], &[seeds])?;
    Ok(BankrollDraw {
        draw_time: draw.draw_time, bump, phase: 0, pending_entry_lamports: 0,
        unsettled_entries: 0, padding: [0; 16],
    })
}

fn validate_bankroll_draw(ledger: &BankrollDraw, draw: &Draw) -> Result<()> {
    require_eq!(ledger.draw_time, draw.draw_time, ErrorCode::MismatchedDraw);
    require!(ledger.padding.iter().all(|byte| *byte == 0), ErrorCode::InvalidBankrollDraw);
    require!(ledger.unsettled_entries <= draw.ticket_count, ErrorCode::InvalidBankrollDraw);
    let expected = match ledger.phase {
        0 => ledger.unsettled_entries.checked_mul(draw.ticket_cost_lamports).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?,
        1 => {
            require_eq!(draw.status, 2, ErrorCode::ResultNotPublished);
            0
        }
        _ => return err!(ErrorCode::InvalidBankrollDraw),
    };
    require_eq!(ledger.pending_entry_lamports, expected, ErrorCode::InvalidBankrollDraw);
    Ok(())
}

fn reconcile_bankroll(vault: &mut Account<Vault>, draw: &Draw, ledger: &mut BankrollDraw) -> Result<()> {
    require_eq!(draw.status, 2, ErrorCode::ResultNotPublished);
    require!(valid_numbers(&draw.numbers), ErrorCode::InvalidNumbers);
    validate_bankroll_draw(ledger, draw)?;
    let previous = ledger.pending_entry_lamports;
    let after = replace_reserved_liability(vault, previous, 0, 0, 0)?;
    vault.padding[..8].copy_from_slice(&after.to_le_bytes());
    ledger.phase = 1;
    ledger.pending_entry_lamports = 0;
    if previous > 0 {
        emit!(BankrollEntriesReleased { draw_time: draw.draw_time, entry_lamports: previous });
    }
    Ok(())
}

fn bankroll_prize_snapshot(prize: u64) -> Result<[u8; 32]> {
    let mut padding = prize_snapshot(prize)?;
    padding[0] = 4;
    Ok(padding)
}

fn bankroll_ticket_prize(padding: &[u8; 32]) -> Result<u64> {
    require!(padding[0] == 4 && padding[9] <= 1 && padding[10..].iter().all(|byte| *byte == 0), ErrorCode::InvalidTicketReserve);
    let prize = u64::from_le_bytes(padding[1..9].try_into().map_err(|_| error!(ErrorCode::InvalidTicketReserve))?);
    require!(prize > 0, ErrorCode::InvalidTicketReserve);
    Ok(prize)
}

fn validate_bankroll_ticket(ticket: &Ticket, draw: &Draw) -> Result<()> {
    require_eq!(ticket.draw_time, draw.draw_time, ErrorCode::MismatchedDraw);
    require_eq!(ticket.paid_lamports, draw.ticket_cost_lamports, ErrorCode::InvalidTicketCost);
    require_eq!(bankroll_ticket_prize(&ticket.padding)?, draw.payout_lamports, ErrorCode::InvalidPayout);
    require!(valid_numbers(&ticket.numbers), ErrorCode::InvalidNumbers);
    Ok(())
}

fn bankroll_payout_balances(balance: u64, owner: u64, payout: u64, rent: u64, reserved: u64) -> Result<(u64, u64)> {
    let protected = rent.checked_add(reserved).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(balance >= protected, ErrorCode::InvalidVaultReserve);
    let spendable = balance.checked_sub(protected).ok_or_else(|| error!(ErrorCode::InvalidVaultReserve))?;
    require!(spendable >= payout, ErrorCode::ClaimAwaitingFunds);
    payout_balances(balance, owner, payout, rent, reserved)
}

fn replace_reserved_liability(vault: &Account<Vault>, previous: u64, next: u64, incoming: u64, payout: u64) -> Result<u64> {
    let info = vault.to_account_info();
    let reserved = reserved_liability(&vault.padding)?;
    let rent = Rent::get()?.minimum_balance(info.data_len());
    replace_liability_balances(info.lamports(), rent, reserved, previous, next, incoming, payout)
}

fn replace_liability_balances(balance: u64, rent: u64, reserved: u64, previous: u64, next: u64, incoming: u64, payout: u64) -> Result<u64> {
    let required_before = rent.checked_add(reserved).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(balance >= required_before, ErrorCode::InvalidVaultReserve);
    let after = reserved.checked_sub(previous).and_then(|other| other.checked_add(next))
        .ok_or_else(|| error!(ErrorCode::InvalidVaultReserve))?;
    let balance_after = balance.checked_add(incoming).and_then(|funds| funds.checked_sub(payout))
        .ok_or_else(|| error!(ErrorCode::InsufficientVaultFunds))?;
    let required_after = rent.checked_add(after).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(balance_after >= required_after, ErrorCode::InsufficientVaultFunds);
    Ok(after)
}

fn request_seed(draw: &Pubkey, nonce: &[u8; 32]) -> [u8; 32] {
    hashv(&[RANDOMNESS_DOMAIN, crate::ID.as_ref(), draw.as_ref(), nonce]).to_bytes()
}

fn validate_request_window(draw: &Draw, now: i64) -> Result<()> {
    require_eq!(draw.status, 0, ErrorCode::DrawNotOpen);
    require!(draw.ticket_count > 0, ErrorCode::EmptyDraw);
    require!(draw.draw_time > 0 && now >= draw.draw_time, ErrorCode::TooEarly);
    require!(!refund_due(draw.draw_time, now), ErrorCode::RefundNotAvailable);
    Ok(())
}

fn oracle_network(info: &AccountInfo) -> Result<(Pubkey, u64)> {
    require_keys_eq!(info.key(), NETWORK_ID, ErrorCode::InvalidOracleNetwork);
    require_keys_eq!(*info.owner, ORACLE_ID, ErrorCode::InvalidOracleNetwork);
    let data = info.try_borrow_data()?;
    require!(data.len() >= 85 && data[..8] == NETWORK_DISCRIMINATOR, ErrorCode::InvalidOracleNetwork);
    let treasury = Pubkey::new_from_array(data[40..72].try_into().map_err(|_| error!(ErrorCode::InvalidOracleNetwork))?);
    let fee = u64::from_le_bytes(data[72..80].try_into().map_err(|_| error!(ErrorCode::InvalidOracleNetwork))?);
    let authorities = u32::from_le_bytes(data[80..84].try_into().map_err(|_| error!(ErrorCode::InvalidOracleNetwork))?) as usize;
    require!(authorities > 0 && authorities <= 10 && data.len() >= 85 + authorities * 32 + 8 && treasury != Pubkey::default(), ErrorCode::InvalidOracleNetwork);
    Ok((treasury, fee))
}

fn validate_oracle_request(
    info: &AccountInfo,
    client: &Pubkey,
    seed: &[u8; 32],
    expected_fulfilled: Option<bool>,
) -> Result<Option<[u8; 64]>> {
    require_keys_eq!(*info.owner, ORACLE_ID, ErrorCode::InvalidOracleRequest);
    let expected = Pubkey::find_program_address(&[REQUEST_SEED, seed], &ORACLE_ID).0;
    require_keys_eq!(info.key(), expected, ErrorCode::InvalidOracleRequest);
    let data = info.try_borrow_data()?;
    parse_oracle_data(&data, client, seed, expected_fulfilled)
}

fn parse_oracle_data(data: &[u8], client: &Pubkey, seed: &[u8; 32], expected_fulfilled: Option<bool>) -> Result<Option<[u8; 64]>> {
    require!(data.len() >= 73 && data[..8] == RANDOMNESS_DISCRIMINATOR, ErrorCode::InvalidOracleRequest);
    require!(data[9..41] == client.to_bytes() && data[41..73] == *seed, ErrorCode::InvalidOracleRequest);
    match data[8] {
        0 => {
            require!(data.len() == PENDING_REQUEST_SPACE, ErrorCode::InvalidOracleRequest);
            let count = u32::from_le_bytes(data[73..77].try_into().map_err(|_| error!(ErrorCode::InvalidOracleRequest))?);
            require!(count <= 7, ErrorCode::InvalidOracleRequest);
            require!(expected_fulfilled != Some(true), ErrorCode::RandomnessPending);
            Ok(None)
        }
        1 => {
            require!(data.len() == FULFILLED_REQUEST_SPACE, ErrorCode::InvalidOracleRequest);
            require!(expected_fulfilled != Some(false), ErrorCode::RefundNotAvailable);
            let mut randomness = [0; 64];
            randomness.copy_from_slice(&data[73..137]);
            Ok(Some(randomness))
        }
        _ => err!(ErrorCode::InvalidOracleRequest),
    }
}

fn refund_due(draw_time: i64, now: i64) -> bool {
    draw_time > 0 && now.saturating_sub(draw_time) >= REFUND_AFTER_SECONDS
}

fn prize_snapshot(prize: u64) -> Result<[u8; 32]> {
    require!(prize > 0, ErrorCode::InvalidTicketReserve);
    let mut padding = [0; 32];
    padding[0] = 2;
    padding[1..9].copy_from_slice(&prize.to_le_bytes());
    Ok(padding)
}

fn validate_ticket_owner(ticket: &Ticket, recipient: Pubkey) -> Result<()> {
    require_keys_eq!(ticket.user, recipient, ErrorCode::Unauthorized);
    require!(!ticket.settled && ticket.padding[9] == 0, ErrorCode::AlreadySettled);
    Ok(())
}

fn reserved_liability(padding: &[u8; 32]) -> Result<u64> {
    require!(padding[8..].iter().all(|byte| *byte == 0), ErrorCode::InvalidVaultReserve);
    Ok(u64::from_le_bytes(padding[..8].try_into().map_err(|_| error!(ErrorCode::InvalidVaultReserve))?))
}

fn payout_balances(balance: u64, owner: u64, payout: u64, rent: u64, remaining: u64) -> Result<(u64, u64)> {
    let after = balance.checked_sub(payout).ok_or_else(|| error!(ErrorCode::InsufficientVaultFunds))?;
    let required = rent.checked_add(remaining).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(after >= required, ErrorCode::InsufficientVaultFunds);
    let owner_after = owner.checked_add(payout).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    Ok((after, owner_after))
}

fn draw_prize(draw_time: i64, base: u64) -> Result<u64> {
    Ok(if is_daily(draw_time) { DAILY_PRIZE } else { base })
}

fn valid_numbers(numbers: &[u8; 3]) -> bool {
    numbers.iter().all(|number| *number <= MAX_NUMBER)
}

fn game_rules(quick_cost: u64, base: u64) -> Result<LemonRules> {
    Ok(LemonRules {
        revision: 1, min_number: MIN_NUMBER, max_number: MAX_NUMBER, pick_count: 3,
        repeats_allowed: true, ordered: true, outcome_count: OUTCOME_COUNT,
        quick_ticket_cost_lamports: quick_cost, daily_ticket_cost_lamports: DAILY_COST,
        quick_payout_lamports: base, daily_payout_lamports: DAILY_PRIZE,
        daily_hours: DAILY_HOURS, schedule_interval_seconds: DAILY_INTERVAL as u32,
        schedule_offset_seconds: DAILY_OFFSET as u32, buy_ahead_seconds: BUY_AHEAD_SECONDS as u32,
    })
}

fn winning_numbers(randomness: &[u8; 64]) -> Result<[u8; 3]> {
    if let Some(numbers) = accepted_triple(randomness) { return Ok(numbers); }
    for counter in 0_u32..8 {
        let expanded = hashv(&[b"hiperia-lemon-vrf-expand-v1", randomness, &counter.to_le_bytes()]).to_bytes();
        if let Some(numbers) = accepted_triple(&expanded) { return Ok(numbers); }
    }
    err!(ErrorCode::InvalidRandomness)
}

fn accepted_triple(entropy: &[u8]) -> Option<[u8; 3]> {
    for bytes in entropy.chunks_exact(2) {
        let sample = u16::from_le_bytes([bytes[0], bytes[1]]);
        if sample < 65_000 {
            let rank = sample % OUTCOME_COUNT;
            return Some([(rank / 100) as u8, ((rank / 10) % 10) as u8, (rank % 10) as u8]);
        }
    }
    None
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = Config::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = payer, space = Vault::SPACE, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetRules<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.is_initialized @ ErrorCode::Uninitialized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(ticket_nonce: u64, draw_time: i64, numbers: [u8; 3])]
pub struct BuyBankrollTicket<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.is_initialized @ ErrorCode::Uninitialized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = user, space = Ticket::SPACE, seeds = [TICKET_SEED, user.key().as_ref(), &ticket_nonce.to_le_bytes()], bump)]
    pub ticket: Account<'info, Ticket>,
    /// CHECK: The canonical draw PDA is allocated with exact owner and size checks.
    #[account(mut, seeds = [DRAW_SEED, &draw_time.to_le_bytes()], bump)]
    pub draw: UncheckedAccount<'info>,
    /// CHECK: The canonical entry ledger PDA is allocated with exact owner and size checks.
    #[account(mut, seeds = [BANKROLL_SEED, BANKROLL_VERSION_SEED, &draw_time.to_le_bytes()], bump)]
    pub bankroll_draw: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(draw_time: i64)]
pub struct ReconcileBankrollDraw<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [DRAW_SEED, &draw_time.to_le_bytes()], bump = draw.bump, constraint = draw.draw_time == draw_time @ ErrorCode::MismatchedDraw)]
    pub draw: Account<'info, Draw>,
    #[account(mut, seeds = [BANKROLL_SEED, BANKROLL_VERSION_SEED, &draw_time.to_le_bytes()], bump = bankroll_draw.bump)]
    pub bankroll_draw: Account<'info, BankrollDraw>,
}

#[derive(Accounts)]
pub struct SettleBankrollTicket<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [TICKET_SEED, ticket.user.as_ref(), &ticket.nonce.to_le_bytes()], bump = ticket.bump, constraint = !ticket.settled @ ErrorCode::AlreadySettled)]
    pub ticket: Account<'info, Ticket>,
    #[account(seeds = [DRAW_SEED, &ticket.draw_time.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    #[account(mut, seeds = [BANKROLL_SEED, BANKROLL_VERSION_SEED, &ticket.draw_time.to_le_bytes()], bump = bankroll_draw.bump)]
    pub bankroll_draw: Account<'info, BankrollDraw>,
    #[account(mut)]
    pub user: SystemAccount<'info>,
}

#[derive(Accounts)]
pub struct ReleaseBankrollLosingTicket<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [TICKET_SEED, ticket.user.as_ref(), &ticket.nonce.to_le_bytes()], bump = ticket.bump, constraint = !ticket.settled @ ErrorCode::AlreadySettled)]
    pub ticket: Account<'info, Ticket>,
    #[account(seeds = [DRAW_SEED, &ticket.draw_time.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    #[account(mut, seeds = [BANKROLL_SEED, BANKROLL_VERSION_SEED, &ticket.draw_time.to_le_bytes()], bump = bankroll_draw.bump)]
    pub bankroll_draw: Account<'info, BankrollDraw>,
}

#[derive(Accounts)]
pub struct RefundBankrollTicket<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [TICKET_SEED, ticket.user.as_ref(), &ticket.nonce.to_le_bytes()], bump = ticket.bump, constraint = !ticket.settled @ ErrorCode::AlreadySettled)]
    pub ticket: Account<'info, Ticket>,
    #[account(seeds = [DRAW_SEED, &ticket.draw_time.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    #[account(mut, seeds = [BANKROLL_SEED, BANKROLL_VERSION_SEED, &ticket.draw_time.to_le_bytes()], bump = bankroll_draw.bump)]
    pub bankroll_draw: Account<'info, BankrollDraw>,
    /// CHECK: Open draws require the System Program sentinel; pending requests are verified against the pinned oracle.
    pub oracle_request: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: SystemAccount<'info>,
}

#[derive(Accounts)]
#[instruction(draw_time: i64)]
pub struct RequestDraw<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.is_initialized @ ErrorCode::Uninitialized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [DRAW_SEED, &draw_time.to_le_bytes()], bump = draw.bump, constraint = draw.draw_time == draw_time @ ErrorCode::MismatchedDraw)]
    pub draw: Account<'info, Draw>,
    #[account(mut, seeds = [CLIENT_SEED, &draw_time.to_le_bytes()], bump)]
    pub oracle_client: SystemAccount<'info>,
    #[account(mut)]
    pub requester: Signer<'info>,
    /// CHECK: The CPI program is pinned and executable.
    #[account(address = ORACLE_ID, executable)]
    pub oracle_program: UncheckedAccount<'info>,
    /// CHECK: Canonical oracle PDA, owner, discriminator and fields are validated before CPI.
    #[account(mut, address = NETWORK_ID)]
    pub network_state: UncheckedAccount<'info>,
    /// CHECK: Must equal the treasury in the verified oracle configuration.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: Must be an unused canonical request PDA for the committed seed.
    #[account(mut)]
    pub oracle_request: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(draw_time: i64)]
pub struct FinalizeDraw<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.is_initialized @ ErrorCode::Uninitialized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [DRAW_SEED, &draw_time.to_le_bytes()], bump = draw.bump, constraint = draw.draw_time == draw_time @ ErrorCode::MismatchedDraw)]
    pub draw: Account<'info, Draw>,
    /// CHECK: The pinned oracle owns this exact committed request and its fulfilled data.
    pub oracle_request: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(draw_time: i64)]
pub struct ReclaimOracleFunding<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.is_initialized @ ErrorCode::Uninitialized)]
    pub config: Account<'info, Config>,
    #[account(seeds = [DRAW_SEED, &draw_time.to_le_bytes()], bump = draw.bump, constraint = draw.draw_time == draw_time @ ErrorCode::MismatchedDraw)]
    pub draw: Account<'info, Draw>,
    #[account(mut, seeds = [CLIENT_SEED, &draw_time.to_le_bytes()], bump)]
    pub oracle_client: SystemAccount<'info>,
    /// CHECK: Exact immutable original funder is validated before crediting unused oracle funding.
    #[account(mut)]
    pub requester: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}


#[account]
pub struct Config {
    pub is_initialized: bool,
    pub bump: u8,
    pub ticket_cost_lamports: u64,
    pub payout_lamports: u64,
    pub padding: [u8; 32],
}
impl Config { pub const SPACE: usize = 58; }

#[account]
pub struct Vault {
    pub bump: u8,
    pub padding: [u8; 32],
}
impl Vault { pub const SPACE: usize = 41; }

#[account]
pub struct Ticket {
    pub user: Pubkey,
    pub nonce: u64,
    pub draw_time: i64,
    pub paid_lamports: u64,
    pub settled: bool,
    pub bump: u8,
    pub numbers: [u8; 3],
    pub padding: [u8; 32],
}
impl Ticket { pub const SPACE: usize = 101; }

#[account]
pub struct Draw {
    pub draw_time: i64,
    pub bump: u8,
    pub status: u8,
    pub ticket_count: u64,
    pub seed: [u8; 32],
    pub oracle_request: Pubkey,
    pub oracle_client: Pubkey,
    pub requested_by: Pubkey,
    pub requested_at: i64,
    pub numbers: [u8; 3],
    pub is_daily: bool,
    pub ticket_cost_lamports: u64,
    pub payout_lamports: u64,
}
impl Draw { pub const SPACE: usize = 182; }

#[account]
pub struct BankrollDraw {
    pub draw_time: i64,
    pub bump: u8,
    pub phase: u8,
    pub pending_entry_lamports: u64,
    pub unsettled_entries: u64,
    pub padding: [u8; 16],
}
impl BankrollDraw { pub const SPACE: usize = 50; }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct LemonRules {
    pub revision: u8,
    pub min_number: u8,
    pub max_number: u8,
    pub pick_count: u8,
    pub repeats_allowed: bool,
    pub ordered: bool,
    pub outcome_count: u16,
    pub quick_ticket_cost_lamports: u64,
    pub daily_ticket_cost_lamports: u64,
    pub quick_payout_lamports: u64,
    pub daily_payout_lamports: u64,
    pub daily_hours: [u8; 6],
    pub schedule_interval_seconds: u32,
    pub schedule_offset_seconds: u32,
    pub buy_ahead_seconds: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AccessRules {
    pub revision: u8,
    pub public_play: bool,
    pub public_results: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RandomnessRules {
    pub revision: u8,
    pub oracle_program: Pubkey,
    pub refund_after_seconds: u32,
    pub pending_request_space: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct BankrollRules {
    pub revision: u8,
    pub daily_enabled: bool,
    pub quick_enabled: bool,
    pub entry_refunds_reserved: bool,
    pub prize_reserved_at_purchase: bool,
    pub claim_requires_funding: bool,
    pub ticket_version: u8,
    pub ledger_account_space: u16,
}

#[event]
pub struct BankrollEntriesReleased {
    pub draw_time: i64,
    pub entry_lamports: u64,
}

#[event]
pub struct TicketPurchased {
    pub user: Pubkey,
    pub nonce: u64,
    pub draw_time: i64,
    pub numbers: [u8; 3],
    pub paid_lamports: u64,
}

#[event]
pub struct RandomnessRequested {
    pub draw_time: i64,
    pub request: Pubkey,
    pub client: Pubkey,
    pub requested_by: Pubkey,
    pub seed: [u8; 32],
}

#[event]
pub struct DrawFinalized {
    pub draw_time: i64,
    pub numbers: [u8; 3],
    pub request: Pubkey,
}

#[event]
pub struct TicketSettled {
    pub user: Pubkey,
    pub nonce: u64,
    pub draw_time: i64,
    pub numbers: [u8; 3],
    pub is_winner: bool,
}

#[event]
pub struct TicketRefunded {
    pub user: Pubkey,
    pub nonce: u64,
    pub draw_time: i64,
    pub paid_lamports: u64,
}


#[error_code]
pub enum ErrorCode {
    #[msg("Program not initialized")]
    Uninitialized,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Ticket already settled")]
    AlreadySettled,
    #[msg("Invalid numbers selected")]
    InvalidNumbers,
    #[msg("Result not yet published")]
    ResultNotPublished,
    #[msg("The draw has not closed yet")]
    TooEarly,
    #[msg("Result and ticket draw times do not match")]
    MismatchedDraw,
    #[msg("Draw time too far in past or future")]
    BadDrawTime,
    #[msg("Invalid ticket cost")]
    InvalidTicketCost,
    #[msg("Invalid payout amount")]
    InvalidPayout,
    #[msg("The vault cannot make this transfer while protecting entry refunds")]
    InsufficientVaultFunds,
    #[msg("The account balance would overflow")]
    ArithmeticOverflow,
    #[msg("The vault liability reserve is invalid or underfunded")]
    InvalidVaultReserve,
    #[msg("The ticket liability reserve marker is invalid")]
    InvalidTicketReserve,
    #[msg("Invalid draw account")]
    InvalidDraw,
    #[msg("The draw is no longer accepting a randomness request")]
    DrawNotOpen,
    #[msg("The draw has no accepted tickets")]
    EmptyDraw,
    #[msg("The oracle configuration is invalid")]
    InvalidOracleNetwork,
    #[msg("The oracle fee exceeds the approved maximum")]
    OracleFeeExceeded,
    #[msg("The oracle request does not match this draw")]
    InvalidOracleRequest,
    #[msg("The oracle request seed has already been used")]
    OracleRequestAlreadyExists,
    #[msg("The oracle client does not match this draw")]
    InvalidOracleClient,
    #[msg("This draw has no pending randomness request")]
    DrawNotPending,
    #[msg("The oracle has not fulfilled this request yet")]
    RandomnessPending,
    #[msg("The oracle output contains no usable uniform sample")]
    InvalidRandomness,
    #[msg("This ticket is not eligible for an oracle-outage entry refund")]
    RefundNotAvailable,
    #[msg("A winning ticket must preserve its owner-directed prize claim")]
    WinningTicketCannotRelease,
    #[msg("The draw's entry refund ledger is invalid")]
    InvalidBankrollDraw,
    #[msg("This winning claim is waiting for the treasury to be refilled")]
    ClaimAwaitingFunds,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draw(time: i64) -> Draw {
        Draw {
            draw_time: time, bump: 255, status: 0, ticket_count: 1,
            seed: [0; 32], oracle_request: Pubkey::default(), oracle_client: Pubkey::default(),
            requested_by: Pubkey::default(), requested_at: 0, numbers: [0; 3],
            is_daily: is_daily(time), ticket_cost_lamports: draw_cost(time, QUICK_COST),
            payout_lamports: draw_prize(time, BASE_PRIZE).unwrap(),
        }
    }

    fn ticket(owner: Pubkey, time: i64) -> Ticket {
        Ticket {
            user: owner, nonce: 1, draw_time: time, paid_lamports: draw_cost(time, QUICK_COST),
            settled: false, bump: 255, numbers: [0, 0, 0],
            padding: bankroll_prize_snapshot(draw_prize(time, BASE_PRIZE).unwrap()).unwrap(),
        }
    }

    fn oracle_data(client: Pubkey, seed: [u8; 32], fulfilled: bool) -> Vec<u8> {
        let mut data = vec![0; if fulfilled { FULFILLED_REQUEST_SPACE } else { PENDING_REQUEST_SPACE }];
        data[..8].copy_from_slice(&RANDOMNESS_DISCRIMINATOR);
        data[8] = u8::from(fulfilled);
        data[9..41].copy_from_slice(client.as_ref());
        data[41..73].copy_from_slice(&seed);
        if fulfilled { data[73..].fill(7); }
        data
    }

    #[test]
    fn metadata_describes_ordered_repeating_triples_without_a_fixed_result() {
        let rules = game_rules(QUICK_COST, BASE_PRIZE).unwrap();
        assert_eq!(rules.revision, 1);
        assert_eq!((rules.min_number, rules.max_number, rules.pick_count), (0, 9, 3));
        assert!(rules.repeats_allowed && rules.ordered);
        assert_eq!(rules.outcome_count, 1000);
        assert_eq!(rules.try_to_vec().unwrap().len(), 58);
        assert_eq!(rules.daily_hours, [3, 7, 11, 15, 19, 23]);
        assert_eq!(rules.schedule_offset_seconds, 10_800);
        assert_eq!((rules.quick_ticket_cost_lamports, rules.daily_ticket_cost_lamports), (7_200_000, 6_250_000));
        assert_eq!((rules.quick_payout_lamports, rules.daily_payout_lamports), (2_500_000_000, 4_750_000_000));
        assert_eq!(AccessRules { revision: 1, public_play: true, public_results: true }.try_to_vec().unwrap(), vec![1, 1, 1]);
        let bankroll = BankrollRules {
            revision: 1, daily_enabled: true, quick_enabled: true, entry_refunds_reserved: true,
            prize_reserved_at_purchase: false, claim_requires_funding: true, ticket_version: 4,
            ledger_account_space: BankrollDraw::SPACE as u16,
        };
        assert_eq!(bankroll.try_to_vec().unwrap(), vec![1, 1, 1, 1, 0, 1, 4, 50, 0]);
    }

    #[test]
    fn account_spaces_match_exact_serialized_layouts() {
        assert_eq!(draw(100).try_to_vec().unwrap().len() + 8, Draw::SPACE);
        assert_eq!(ticket(ADMIN, 100).try_to_vec().unwrap().len() + 8, Ticket::SPACE);
        assert_eq!(Config { is_initialized: true, bump: 255, ticket_cost_lamports: QUICK_COST, payout_lamports: BASE_PRIZE, padding: ADMIN.to_bytes() }.try_to_vec().unwrap().len() + 8, Config::SPACE);
        assert_eq!(Vault { bump: 255, padding: [0; 32] }.try_to_vec().unwrap().len() + 8, Vault::SPACE);
        let ledger = BankrollDraw { draw_time: 100, bump: 255, phase: 0, pending_entry_lamports: 0, unsettled_entries: 0, padding: [0; 16] };
        assert_eq!(ledger.try_to_vec().unwrap().len() + 8, BankrollDraw::SPACE);
        assert_eq!((Ticket::SPACE, Draw::SPACE, BankrollDraw::SPACE), (101, 182, 50));
    }

    #[test]
    fn triples_allow_zero_and_repetitions_and_reject_every_out_of_range_digit() {
        for first in 0..10 {
            for second in 0..10 {
                for third in 0..10 { assert!(valid_numbers(&[first, second, third])); }
            }
        }
        for bad in 10..=u8::MAX {
            for numbers in [[bad, 0, 0], [0, bad, 0], [0, 0, bad]] { assert!(!valid_numbers(&numbers)); }
        }
    }

    #[test]
    fn rejection_sampling_covers_each_of_the_thousand_triples_exactly_sixty_five_times() {
        let mut counts = [0u8; 1000];
        for sample in 0u16..65_000 {
            let numbers = accepted_triple(&sample.to_le_bytes()).unwrap();
            assert!(valid_numbers(&numbers));
            let rank = numbers[0] as usize * 100 + numbers[1] as usize * 10 + numbers[2] as usize;
            counts[rank] += 1;
        }
        assert!(counts.iter().all(|count| *count == 65));
        for sample in 65_000u16..=u16::MAX { assert!(accepted_triple(&sample.to_le_bytes()).is_none()); }
        assert_eq!(accepted_triple(&0u16.to_le_bytes()), Some([0, 0, 0]));
        assert_eq!(accepted_triple(&999u16.to_le_bytes()), Some([9, 9, 9]));
    }

    #[test]
    fn rejected_entropy_expands_only_the_same_committed_proof() {
        let entropy = [255; 64];
        assert_eq!(winning_numbers(&entropy).unwrap(), winning_numbers(&entropy).unwrap());
        assert!(valid_numbers(&winning_numbers(&entropy).unwrap()));
        let mut accepted = entropy;
        accepted[2..4].copy_from_slice(&999u16.to_le_bytes());
        assert_eq!(winning_numbers(&accepted).unwrap(), [9, 9, 9]);
    }

    #[test]
    fn shared_daily_schedule_and_fixed_snapshot_prizes_are_exact() {
        for day in [0, 1, 2, 10_000] {
            for slot in 0..6 {
                let time = day * 86_400 + DAILY_OFFSET + slot * DAILY_INTERVAL;
                assert!(is_daily(time));
                assert_eq!(draw_cost(time, QUICK_COST), DAILY_COST);
                assert_eq!(draw_prize(time, BASE_PRIZE).unwrap(), DAILY_PRIZE);
                assert_eq!(draw_cost(time + 1, QUICK_COST), QUICK_COST);
                assert_eq!(draw_prize(time + 1, BASE_PRIZE).unwrap(), BASE_PRIZE);
            }
        }
        assert_eq!(DAILY_PRIZE * 100 / (DAILY_COST * OUTCOME_COUNT as u64), 76);
        assert!(BASE_PRIZE < QUICK_COST * OUTCOME_COUNT as u64);
    }

    #[test]
    fn requesting_randomness_requires_closed_sales_and_rejects_second_requests() {
        let mut round = draw(100);
        assert!(validate_request_window(&round, 99).is_err());
        assert!(validate_request_window(&round, 100).is_ok());
        assert!(validate_request_window(&round, 100 + REFUND_AFTER_SECONDS - 1).is_ok());
        assert!(validate_request_window(&round, 100 + REFUND_AFTER_SECONDS).is_err());
        round.ticket_count = 0;
        assert!(validate_request_window(&round, 100).is_err());
        round.ticket_count = 1;
        for status in [1, 2, 255] {
            round.status = status;
            assert!(validate_request_window(&round, 100).is_err());
        }
    }

    #[test]
    fn request_seed_binds_the_new_program_domain_round_and_nonce() {
        let first = Pubkey::new_unique();
        let second = Pubkey::new_unique();
        assert_eq!(request_seed(&first, &[7; 32]), request_seed(&first, &[7; 32]));
        assert_ne!(request_seed(&first, &[7; 32]), request_seed(&second, &[7; 32]));
        assert_ne!(request_seed(&first, &[7; 32]), request_seed(&first, &[8; 32]));
        assert_ne!(request_seed(&first, &[7; 32]), hashv(&[b"hiperia-dodos-vrf-v1", crate::ID.as_ref(), first.as_ref(), &[7; 32]]).to_bytes());
    }

    #[test]
    fn proof_bytes_require_exact_client_seed_discriminator_and_fulfilled_shape() {
        let client = Pubkey::new_unique();
        let seed = [7; 32];
        let data = oracle_data(client, seed, true);
        assert_eq!(parse_oracle_data(&data, &client, &seed, Some(true)).unwrap(), Some([7; 64]));
        assert!(parse_oracle_data(&data, &Pubkey::new_unique(), &seed, Some(true)).is_err());
        assert!(parse_oracle_data(&data, &client, &[8; 32], Some(true)).is_err());
        assert!(parse_oracle_data(&data[..136], &client, &seed, Some(true)).is_err());
        assert!(parse_oracle_data(&data, &client, &seed, Some(false)).is_err());
        let mut forged = data;
        forged[0] ^= 1;
        assert!(parse_oracle_data(&forged, &client, &seed, Some(true)).is_err());
        let mut pending = oracle_data(client, seed, false);
        assert_eq!(parse_oracle_data(&pending, &client, &seed, Some(false)).unwrap(), None);
        assert!(parse_oracle_data(&pending, &client, &seed, Some(true)).is_err());
        pending[73..77].copy_from_slice(&8u32.to_le_bytes());
        assert!(parse_oracle_data(&pending, &client, &seed, Some(false)).is_err());
    }

    #[test]
    fn oracle_account_verification_rejects_foreign_owner_and_wrong_request_pda() {
        let client = Pubkey::new_unique();
        let seed = [7; 32];
        let expected = Pubkey::find_program_address(&[REQUEST_SEED, &seed], &ORACLE_ID).0;
        let foreign = Pubkey::new_unique();
        let mut lamports = 1;
        let mut data = oracle_data(client, seed, true);
        {
            let account = AccountInfo::new(&expected, false, false, &mut lamports, &mut data, &foreign, false, 0);
            assert!(validate_oracle_request(&account, &client, &seed, Some(true)).is_err());
        }
        {
            let account = AccountInfo::new(&foreign, false, false, &mut lamports, &mut data, &ORACLE_ID, false, 0);
            assert!(validate_oracle_request(&account, &client, &seed, Some(true)).is_err());
        }
        let account = AccountInfo::new(&expected, false, false, &mut lamports, &mut data, &ORACLE_ID, false, 0);
        assert_eq!(validate_oracle_request(&account, &client, &seed, Some(true)).unwrap(), Some([7; 64]));
    }

    #[test]
    fn refunds_require_the_full_day_and_a_fulfilled_proof_cannot_be_refunded() {
        assert!(!refund_due(100, 100 + REFUND_AFTER_SECONDS - 1));
        assert!(refund_due(100, 100 + REFUND_AFTER_SECONDS));
        assert!(!refund_due(0, i64::MAX));
        assert!(!refund_due(100, 99));
        let client = Pubkey::new_unique();
        let seed = [7; 32];
        assert!(parse_oracle_data(&oracle_data(client, seed, true), &client, &seed, Some(false)).is_err());
    }

    #[test]
    fn immutable_owner_and_refund_marker_prevent_redirect_and_replay() {
        let mut entry = ticket(ADMIN, 100);
        assert!(validate_ticket_owner(&entry, ADMIN).is_ok());
        assert!(validate_ticket_owner(&entry, Pubkey::new_unique()).is_err());
        entry.settled = true;
        assert!(validate_ticket_owner(&entry, ADMIN).is_err());
        entry.settled = false;
        entry.padding[9] = 1;
        assert!(validate_ticket_owner(&entry, ADMIN).is_err());
    }

    #[test]
    fn paid_entry_and_prize_snapshots_must_match_the_immutable_draw() {
        let round = draw(100);
        let mut entry = ticket(ADMIN, 100);
        assert!(validate_bankroll_ticket(&entry, &round).is_ok());
        entry.draw_time += 1;
        assert!(validate_bankroll_ticket(&entry, &round).is_err());
        entry.draw_time = 100;
        entry.paid_lamports += 1;
        assert!(validate_bankroll_ticket(&entry, &round).is_err());
        entry.paid_lamports = QUICK_COST;
        entry.padding = bankroll_prize_snapshot(BASE_PRIZE + 1).unwrap();
        assert!(validate_bankroll_ticket(&entry, &round).is_err());
        entry.padding = bankroll_prize_snapshot(BASE_PRIZE).unwrap();
        entry.padding[0] = 3;
        assert!(validate_bankroll_ticket(&entry, &round).is_err());
    }

    #[test]
    fn purchases_fund_only_their_own_refund_hold_without_consuming_operator_capital() {
        let rent = 100;
        let other_holds = 3 * DAILY_COST;
        let capital = 20_000_000_000;
        let balance = rent + other_holds + capital;
        for entries in [1u64, 3, 1000, 100_000] {
            for cost in [DAILY_COST, QUICK_COST] {
                let incoming = entries * cost;
                let after = replace_liability_balances(balance, rent, other_holds, 0, incoming, incoming, 0).unwrap();
                assert_eq!(after, other_holds + incoming);
                assert_eq!(balance + incoming - rent - after, capital);
            }
        }
    }

    #[test]
    fn winning_claims_preserve_other_draw_refunds_and_succeed_after_exact_refill() {
        let rent = 100;
        let protected = 3 * DAILY_COST + QUICK_COST;
        for prize in [BASE_PRIZE, DAILY_PRIZE] {
            let balance = rent + protected + prize - 1;
            assert!(bankroll_payout_balances(balance, 0, prize, rent, protected).is_err());
            assert_eq!(bankroll_payout_balances(balance + 1, 0, prize, rent, protected).unwrap(), (rent + protected, prize));
            assert!(bankroll_payout_balances(balance + 1, u64::MAX, prize, rent, protected).is_err());
        }
        assert_eq!(bankroll_payout_balances(rent + protected, 0, 0, rent, protected).unwrap(), (rent + protected, 0));
        assert!(bankroll_payout_balances(rent + protected - 1, 0, 0, rent, protected).is_err());
    }

    #[test]
    fn ledger_release_is_draw_bound_and_preserves_unrelated_refunds() {
        let mut round = draw(100);
        round.ticket_count = 3;
        let mut ledger = BankrollDraw { draw_time: 100, bump: 255, phase: 0, pending_entry_lamports: 3 * QUICK_COST, unsettled_entries: 3, padding: [0; 16] };
        assert!(validate_bankroll_draw(&ledger, &round).is_ok());
        ledger.unsettled_entries -= 1;
        ledger.pending_entry_lamports -= QUICK_COST;
        assert!(validate_bankroll_draw(&ledger, &round).is_ok());
        let unrelated = 10 * DAILY_COST;
        let total = unrelated + ledger.pending_entry_lamports;
        assert_eq!(replace_liability_balances(100 + total, 100, total, ledger.pending_entry_lamports, 0, 0, 0).unwrap(), unrelated);
        ledger.phase = 1;
        ledger.pending_entry_lamports = 0;
        assert!(validate_bankroll_draw(&ledger, &round).is_err());
        round.status = 2;
        assert!(validate_bankroll_draw(&ledger, &round).is_ok());
        ledger.draw_time += 1;
        assert!(validate_bankroll_draw(&ledger, &round).is_err());
        ledger.draw_time = 100;
        ledger.padding[0] = 1;
        assert!(validate_bankroll_draw(&ledger, &round).is_err());
    }

    #[test]
    fn reserve_overflow_or_underflow_never_releases_another_draws_protection() {
        assert!(replace_liability_balances(100, 10, 91, 0, 0, 0, 0).is_err());
        assert!(replace_liability_balances(100, 10, 90, 91, 0, 0, 0).is_err());
        assert!(replace_liability_balances(100, 10, 90, 0, 1, 0, 0).is_err());
        assert!(replace_liability_balances(u64::MAX, 10, 0, 0, 1, 1, 0).is_err());
        assert!(payout_balances(100, u64::MAX, 1, 10, 0).is_err());
    }
}

