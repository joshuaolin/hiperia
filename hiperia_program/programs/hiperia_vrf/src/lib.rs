use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::hashv,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    system_instruction,
};
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("6SWK5s22L7HDzvNdFbMhTjtMQNPfUmMzM4D8S3ZRRgRy");

const MIN_NUMBER: u8 = 2;
const MAX_NUMBER: u8 = 22;
const QUICK_COST: u64 = 7_200_000;
const DAILY_COST: u64 = 6_250_000;
const BASE_PRIZE: u64 = 1_000_000_000;
const BUY_AHEAD_SECONDS: i64 = 86_400;
const REFUND_AFTER_SECONDS: i64 = 86_400;
const DAILY_INTERVAL: i64 = 14_400;
const DAILY_OFFSET: i64 = 7_200;
const DAILY_HOURS: [u8; 6] = [2, 6, 10, 14, 18, 22];
const CONFIG_SEED: &[u8] = b"config";
const VAULT_SEED: &[u8] = b"vault";
const TICKET_SEED: &[u8] = b"ticket";
const DRAW_SEED: &[u8] = b"draw";
const CLIENT_SEED: &[u8] = b"oracle-client";
const REQUEST_SEED: &[u8] = b"orao-vrf-randomness-request";
const RANDOMNESS_DOMAIN: &[u8] = b"hiperia-dodos-vrf-v1";
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
pub mod hiperia_vrf {
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

    pub fn get_rules(ctx: Context<GetRules>) -> Result<UatRules> {
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

    pub fn buy_ticket(
        ctx: Context<BuyTicket>,
        ticket_nonce: u64,
        draw_time: i64,
        numbers: [u8; 2],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(valid_numbers(&numbers), ErrorCode::InvalidNumbers);
        require!(draw_time > now && draw_time <= now.saturating_add(BUY_AHEAD_SECONDS), ErrorCode::BadDrawTime);
        let cost = draw_cost(draw_time, ctx.accounts.config.ticket_cost_lamports);
        let prize = draw_prize(draw_time, ctx.accounts.config.payout_lamports)?;
        let draw_info = ctx.accounts.draw.to_account_info();
        let mut draw = load_or_create_draw(
            &draw_info,
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            draw_time,
            ctx.bumps.draw,
            cost,
            prize,
        )?;
        require_eq!(draw.status, 0, ErrorCode::DrawNotOpen);
        require_eq!(draw.draw_time, draw_time, ErrorCode::MismatchedDraw);
        require_eq!(draw.ticket_cost_lamports, cost, ErrorCode::InvalidTicketCost);
        require_eq!(draw.payout_lamports, prize, ErrorCode::InvalidPayout);
        let vault_info = ctx.accounts.vault.to_account_info();
        let reserved = reserved_liability(&ctx.accounts.vault.padding)?;
        let rent = Rent::get()?.minimum_balance(vault_info.data_len());
        let reserved_after = reserve_for_purchase(vault_info.lamports(), cost, prize, rent, reserved)?;
        draw.ticket_count = draw.ticket_count.checked_add(1).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
        transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: vault_info,
            }),
            cost,
        )?;
        ctx.accounts.vault.padding[..8].copy_from_slice(&reserved_after.to_le_bytes());
        let ticket = &mut ctx.accounts.ticket;
        ticket.user = ctx.accounts.user.key();
        ticket.nonce = ticket_nonce;
        ticket.draw_time = draw_time;
        ticket.paid_lamports = cost;
        ticket.settled = false;
        ticket.bump = ctx.bumps.ticket;
        ticket.numbers = numbers;
        ticket.padding = prize_snapshot(prize)?;
        save_draw(&draw_info, &draw)?;
        emit!(TicketPurchased { user: ticket.user, nonce: ticket_nonce, draw_time, numbers, paid_lamports: cost });
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

    pub fn release_losing_ticket(ctx: Context<ReleaseLosingTicket>) -> Result<()> {
        let ticket = &ctx.accounts.ticket;
        let prize = losing_ticket_prize(ticket, &ctx.accounts.draw, Clock::get()?.unix_timestamp)?;
        let vault = &mut ctx.accounts.vault;
        let info = vault.to_account_info();
        let reserved = reserved_liability(&vault.padding)?;
        let rent = Rent::get()?.minimum_balance(info.data_len());
        let required = rent.checked_add(reserved).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
        require!(info.lamports() >= required, ErrorCode::InvalidVaultReserve);
        let after = reserved.checked_sub(prize).ok_or_else(|| error!(ErrorCode::InvalidVaultReserve))?;
        vault.padding[..8].copy_from_slice(&after.to_le_bytes());
        let ticket = &mut ctx.accounts.ticket;
        ticket.settled = true;
        emit!(TicketSettled { user: ticket.user, nonce: ticket.nonce, draw_time: ticket.draw_time, numbers: ticket.numbers, is_winner: false });
        Ok(())
    }

    pub fn settle_ticket(ctx: Context<SettleTicket>) -> Result<()> {
        let ticket = &ctx.accounts.ticket;
        let draw = &ctx.accounts.draw;
        validate_ticket_owner(ticket, ctx.accounts.user.key())?;
        require!(Clock::get()?.unix_timestamp >= ticket.draw_time, ErrorCode::TooEarly);
        require_eq!(draw.status, 2, ErrorCode::ResultNotPublished);
        require_eq!(draw.draw_time, ticket.draw_time, ErrorCode::MismatchedDraw);
        let prize = ticket_prize(&ticket.padding)?;
        let is_winner = ticket.numbers == draw.numbers;
        let payout = if is_winner { prize } else { 0 };
        pay_and_release(
            &mut ctx.accounts.vault,
            &ctx.accounts.user.to_account_info(),
            prize,
            payout,
        )?;
        let ticket = &mut ctx.accounts.ticket;
        ticket.settled = true;
        emit!(TicketSettled { user: ticket.user, nonce: ticket.nonce, draw_time: ticket.draw_time, numbers: ticket.numbers, is_winner });
        Ok(())
    }

    pub fn refund_ticket(ctx: Context<RefundTicket>) -> Result<()> {
        let ticket = &ctx.accounts.ticket;
        let draw = &ctx.accounts.draw;
        validate_ticket_owner(ticket, ctx.accounts.user.key())?;
        require_eq!(draw.draw_time, ticket.draw_time, ErrorCode::MismatchedDraw);
        require!(refund_due(ticket.draw_time, Clock::get()?.unix_timestamp), ErrorCode::RefundNotAvailable);
        match draw.status {
            0 => {
                require_keys_eq!(ctx.accounts.oracle_request.key(), System::id(), ErrorCode::InvalidOracleRequest);
            }
            1 => {
                require_keys_eq!(ctx.accounts.oracle_request.key(), draw.oracle_request, ErrorCode::InvalidOracleRequest);
                validate_oracle_request(&ctx.accounts.oracle_request.to_account_info(), &draw.oracle_client, &draw.seed, Some(false))?;
            }
            _ => return err!(ErrorCode::RefundNotAvailable),
        }
        let prize = ticket_prize(&ticket.padding)?;
        pay_and_release(
            &mut ctx.accounts.vault,
            &ctx.accounts.user.to_account_info(),
            prize,
            ticket.paid_lamports,
        )?;
        let ticket = &mut ctx.accounts.ticket;
        ticket.settled = true;
        ticket.padding[9] = 1;
        emit!(TicketRefunded { user: ticket.user, nonce: ticket.nonce, draw_time: ticket.draw_time, paid_lamports: ticket.paid_lamports });
        Ok(())
    }
}

fn is_daily(draw_time: i64) -> bool {
    draw_time.rem_euclid(DAILY_INTERVAL) == DAILY_OFFSET
}

fn draw_cost(draw_time: i64, quick_cost: u64) -> u64 {
    if is_daily(draw_time) { DAILY_COST } else { quick_cost }
}

fn draw_prize(draw_time: i64, base: u64) -> Result<u64> {
    if is_daily(draw_time) {
        base.checked_mul(2).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
    } else { Ok(base) }
}

fn valid_numbers(numbers: &[u8; 2]) -> bool {
    numbers[0] >= MIN_NUMBER && numbers[0] <= MAX_NUMBER
        && numbers[1] >= MIN_NUMBER && numbers[1] <= MAX_NUMBER && numbers[0] != numbers[1]
}

fn game_rules(quick_cost: u64, base: u64) -> Result<UatRules> {
    Ok(UatRules {
        revision: 6, min_number: MIN_NUMBER, max_number: MAX_NUMBER, pick_count: 2,
        winning_numbers: [0, 0],
        quick_ticket_cost_lamports: quick_cost,
        daily_ticket_cost_lamports: DAILY_COST,
        quick_payout_lamports: base,
        daily_payout_lamports: draw_prize(DAILY_OFFSET, base)?,
        daily_hours: DAILY_HOURS,
        schedule_interval_seconds: DAILY_INTERVAL as u32,
        schedule_offset_seconds: DAILY_OFFSET as u32,
        buy_ahead_seconds: BUY_AHEAD_SECONDS as u32,
    })
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
        requested_at: 0, numbers: [0, 0], is_daily: is_daily(draw_time), ticket_cost_lamports: cost, payout_lamports: prize,
    })
}

fn save_draw(info: &AccountInfo, draw: &Draw) -> Result<()> {
    draw.try_serialize(&mut &mut info.try_borrow_mut_data()?[..])
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

fn winning_numbers(randomness: &[u8; 64]) -> Result<[u8; 2]> {
    if let Some(numbers) = accepted_pair(randomness) {
        return Ok(numbers);
    }
    for counter in 0_u32..8 {
        let expanded = hashv(&[b"hiperia-dodos-vrf-expand-v1", randomness, &counter.to_le_bytes()]).to_bytes();
        if let Some(numbers) = accepted_pair(&expanded) {
            return Ok(numbers);
        }
    }
    err!(ErrorCode::InvalidRandomness)
}

fn accepted_pair(entropy: &[u8]) -> Option<[u8; 2]> {
    for bytes in entropy.chunks_exact(2) {
        let sample = u16::from_le_bytes([bytes[0], bytes[1]]);
        if sample < 65_520 {
            let rank = sample % 420;
            let first = (rank / 20) as u8 + MIN_NUMBER;
            let mut second = (rank % 20) as u8 + MIN_NUMBER;
            if second >= first { second += 1; }
            return Some([first, second]);
        }
    }
    None
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

fn ticket_prize(padding: &[u8; 32]) -> Result<u64> {
    require!(padding[0] == 2 && padding[9] <= 1 && padding[10..].iter().all(|byte| *byte == 0), ErrorCode::InvalidTicketReserve);
    let prize = u64::from_le_bytes(padding[1..9].try_into().map_err(|_| error!(ErrorCode::InvalidTicketReserve))?);
    require!(prize > 0, ErrorCode::InvalidTicketReserve);
    Ok(prize)
}

fn validate_ticket_owner(ticket: &Ticket, recipient: Pubkey) -> Result<()> {
    require_keys_eq!(ticket.user, recipient, ErrorCode::Unauthorized);
    require!(!ticket.settled && ticket.padding[9] == 0, ErrorCode::AlreadySettled);
    Ok(())
}

fn losing_ticket_prize(ticket: &Ticket, draw: &Draw, now: i64) -> Result<u64> {
    validate_ticket_owner(ticket, ticket.user)?;
    require!(now >= ticket.draw_time, ErrorCode::TooEarly);
    require_eq!(draw.status, 2, ErrorCode::ResultNotPublished);
    require_eq!(draw.draw_time, ticket.draw_time, ErrorCode::MismatchedDraw);
    require!(ticket.numbers != draw.numbers, ErrorCode::WinningTicketCannotRelease);
    ticket_prize(&ticket.padding)
}

fn reserved_liability(padding: &[u8; 32]) -> Result<u64> {
    require!(padding[8..].iter().all(|byte| *byte == 0), ErrorCode::InvalidVaultReserve);
    Ok(u64::from_le_bytes(padding[..8].try_into().map_err(|_| error!(ErrorCode::InvalidVaultReserve))?))
}

fn reserve_for_purchase(balance: u64, cost: u64, prize: u64, rent: u64, reserved: u64) -> Result<u64> {
    let covered = rent.checked_add(reserved).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(balance >= covered, ErrorCode::InvalidVaultReserve);
    let after = reserved.checked_add(prize).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    let required = rent.checked_add(after).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    let available = balance.checked_add(cost).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(available >= required, ErrorCode::InsufficientVaultFunds);
    Ok(after)
}

fn pay_and_release(vault: &mut Account<Vault>, owner: &AccountInfo, prize: u64, payout: u64) -> Result<()> {
    let info = vault.to_account_info();
    let reserved = reserved_liability(&vault.padding)?;
    let rent = Rent::get()?.minimum_balance(info.data_len());
    let required_before = rent.checked_add(reserved).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(info.lamports() >= required_before, ErrorCode::InvalidVaultReserve);
    let after = reserved.checked_sub(prize).ok_or_else(|| error!(ErrorCode::InvalidVaultReserve))?;
    let (vault_after, owner_after) = payout_balances(info.lamports(), owner.lamports(), payout, rent, after)?;
    if payout > 0 {
        **info.try_borrow_mut_lamports()? = vault_after;
        **owner.try_borrow_mut_lamports()? = owner_after;
    }
    vault.padding[..8].copy_from_slice(&after.to_le_bytes());
    Ok(())
}

fn payout_balances(balance: u64, owner: u64, payout: u64, rent: u64, remaining: u64) -> Result<(u64, u64)> {
    let after = balance.checked_sub(payout).ok_or_else(|| error!(ErrorCode::InsufficientVaultFunds))?;
    let required = rent.checked_add(remaining).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(after >= required, ErrorCode::InsufficientVaultFunds);
    let owner_after = owner.checked_add(payout).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    Ok((after, owner_after))
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
#[instruction(ticket_nonce: u64, draw_time: i64, numbers: [u8; 2])]
pub struct BuyTicket<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.is_initialized @ ErrorCode::Uninitialized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = user, space = Ticket::SPACE, seeds = [TICKET_SEED, user.key().as_ref(), &ticket_nonce.to_le_bytes()], bump)]
    pub ticket: Account<'info, Ticket>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Canonical PDA is allocated and deserialized with owner and size validation.
    #[account(mut, seeds = [DRAW_SEED, &draw_time.to_le_bytes()], bump)]
    pub draw: UncheckedAccount<'info>,
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

#[derive(Accounts)]
pub struct ReleaseLosingTicket<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.is_initialized @ ErrorCode::Uninitialized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [TICKET_SEED, ticket.user.as_ref(), &ticket.nonce.to_le_bytes()], bump = ticket.bump, constraint = !ticket.settled @ ErrorCode::AlreadySettled)]
    pub ticket: Account<'info, Ticket>,
    #[account(seeds = [DRAW_SEED, &ticket.draw_time.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
}

#[derive(Accounts)]
pub struct SettleTicket<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.is_initialized @ ErrorCode::Uninitialized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [TICKET_SEED, ticket.user.as_ref(), &ticket.nonce.to_le_bytes()], bump = ticket.bump, constraint = !ticket.settled @ ErrorCode::AlreadySettled)]
    pub ticket: Account<'info, Ticket>,
    #[account(seeds = [DRAW_SEED, &ticket.draw_time.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    #[account(mut)]
    pub user: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundTicket<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.is_initialized @ ErrorCode::Uninitialized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [TICKET_SEED, ticket.user.as_ref(), &ticket.nonce.to_le_bytes()], bump = ticket.bump, constraint = !ticket.settled @ ErrorCode::AlreadySettled)]
    pub ticket: Account<'info, Ticket>,
    #[account(seeds = [DRAW_SEED, &ticket.draw_time.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    #[account(mut)]
    pub user: SystemAccount<'info>,
    /// CHECK: Open draws require the System Program sentinel; pending draws validate their committed oracle request.
    pub oracle_request: UncheckedAccount<'info>,
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
    pub numbers: [u8; 2],
    pub padding: [u8; 32],
}
impl Ticket { pub const SPACE: usize = 100; }

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
    pub numbers: [u8; 2],
    pub is_daily: bool,
    pub ticket_cost_lamports: u64,
    pub payout_lamports: u64,
}
impl Draw { pub const SPACE: usize = 181; }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct UatRules {
    pub revision: u8,
    pub min_number: u8,
    pub max_number: u8,
    pub pick_count: u8,
    pub winning_numbers: [u8; 2],
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

#[event]
pub struct TicketPurchased {
    pub user: Pubkey,
    pub nonce: u64,
    pub draw_time: i64,
    pub numbers: [u8; 2],
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
    pub numbers: [u8; 2],
    pub request: Pubkey,
}

#[event]
pub struct TicketSettled {
    pub user: Pubkey,
    pub nonce: u64,
    pub draw_time: i64,
    pub numbers: [u8; 2],
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
    #[msg("The draw has not closed yet")]
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
    #[msg("The vault cannot fully back another prize")]
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draw(time: i64) -> Draw {
        Draw {
            draw_time: time, bump: 255, status: 0, ticket_count: 1,
            seed: [0; 32], oracle_request: Pubkey::default(), oracle_client: Pubkey::default(),
            requested_by: Pubkey::default(), requested_at: 0, numbers: [0; 2],
            is_daily: false, ticket_cost_lamports: QUICK_COST, payout_lamports: BASE_PRIZE,
        }
    }

    fn oracle_data(client: Pubkey, seed: [u8; 32], fulfilled: bool) -> Vec<u8> {
        let mut bytes = vec![0; if fulfilled { FULFILLED_REQUEST_SPACE } else { PENDING_REQUEST_SPACE }];
        bytes[..8].copy_from_slice(&RANDOMNESS_DISCRIMINATOR);
        bytes[8] = u8::from(fulfilled);
        bytes[9..41].copy_from_slice(client.as_ref());
        bytes[41..73].copy_from_slice(&seed);
        if fulfilled { bytes[73..].fill(7); }
        bytes
    }

    #[test]
    fn metadata_exposes_public_vrf_without_a_fixed_winning_pair() {
        let rules = game_rules(QUICK_COST, BASE_PRIZE).unwrap();
        assert_eq!(rules.revision, 6);
        assert_eq!(rules.winning_numbers, [0, 0]);
        assert_eq!(rules.try_to_vec().unwrap().len(), 56);
        assert_eq!(rules.daily_hours, [2, 6, 10, 14, 18, 22]);
        assert_eq!(rules.daily_ticket_cost_lamports, DAILY_COST);
        assert_eq!(rules.daily_payout_lamports, 2 * BASE_PRIZE);
        assert_eq!(AccessRules { revision: 1, public_play: true, public_results: true }.try_to_vec().unwrap(), vec![1, 1, 1]);
        assert_eq!(RandomnessRules { revision: 1, oracle_program: ORACLE_ID, refund_after_seconds: REFUND_AFTER_SECONDS as u32, pending_request_space: PENDING_REQUEST_SPACE as u16 }.try_to_vec().unwrap().len(), 39);
    }

    #[test]
    fn account_spaces_match_serialized_layouts() {
        assert_eq!(draw(100).try_to_vec().unwrap().len() + 8, Draw::SPACE);
        let ticket = Ticket { user: ADMIN, nonce: 1, draw_time: 100, paid_lamports: QUICK_COST, settled: false, bump: 255, numbers: [2, 22], padding: prize_snapshot(BASE_PRIZE).unwrap() };
        assert_eq!(ticket.try_to_vec().unwrap().len() + 8, Ticket::SPACE);
        assert_eq!(Config { is_initialized: true, bump: 255, ticket_cost_lamports: QUICK_COST, payout_lamports: BASE_PRIZE, padding: ADMIN.to_bytes() }.try_to_vec().unwrap().len() + 8, Config::SPACE);
        assert_eq!(Vault { bump: 255, padding: [0; 32] }.try_to_vec().unwrap().len() + 8, Vault::SPACE);
    }

    #[test]
    fn picks_are_distinct_between_two_and_twenty_two() {
        assert!(valid_numbers(&[2, 22]));
        assert!(valid_numbers(&[22, 2]));
        for invalid in [[1, 22], [22, 1], [0, 2], [2, 23], [22, 22]] {
            assert!(!valid_numbers(&invalid));
        }
    }

    #[test]
    fn every_accepted_sample_produces_each_ordered_pair_exactly_156_times() {
        let mut counts = [[0_u16; 21]; 21];
        for sample in 0_u16..65_520 {
            let mut randomness = [0; 64];
            randomness[..2].copy_from_slice(&sample.to_le_bytes());
            let pair = winning_numbers(&randomness).unwrap();
            assert!(valid_numbers(&pair));
            counts[(pair[0] - 2) as usize][(pair[1] - 2) as usize] += 1;
        }
        for first in 0..21 {
            for second in 0..21 {
                assert_eq!(counts[first][second], if first == second { 0 } else { 156 });
            }
        }
    }

    #[test]
    fn rejected_samples_use_deterministic_vrf_expansion_without_replacing_the_request() {
        let mut randomness = [255; 64];
        let pair = winning_numbers(&randomness).unwrap();
        assert!(valid_numbers(&pair));
        assert_eq!(pair, winning_numbers(&randomness).unwrap());
        randomness[2..4].copy_from_slice(&419_u16.to_le_bytes());
        assert_eq!(winning_numbers(&randomness).unwrap(), [22, 21]);
    }

    #[test]
    fn a_request_requires_closed_sales_nonempty_open_round_and_no_refund_timeout() {
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
    fn request_seed_is_domain_program_round_and_nonce_bound() {
        let first = Pubkey::new_unique();
        let second = Pubkey::new_unique();
        let nonce = [7; 32];
        assert_eq!(request_seed(&first, &nonce), request_seed(&first, &nonce));
        assert_ne!(request_seed(&first, &nonce), request_seed(&second, &nonce));
        assert_ne!(request_seed(&first, &nonce), request_seed(&first, &[8; 32]));
    }

    #[test]
    fn oracle_data_requires_exact_discriminator_client_seed_and_fulfillment_layout() {
        let client = Pubkey::new_unique();
        let seed = [7; 32];
        let bytes = oracle_data(client, seed, true);
        assert_eq!(parse_oracle_data(&bytes, &client, &seed, Some(true)).unwrap(), Some([7; 64]));
        assert!(parse_oracle_data(&bytes, &Pubkey::new_unique(), &seed, Some(true)).is_err());
        assert!(parse_oracle_data(&bytes, &client, &[8; 32], Some(true)).is_err());
        assert!(parse_oracle_data(&bytes[..136], &client, &seed, Some(true)).is_err());
        assert!(parse_oracle_data(&bytes, &client, &seed, Some(false)).is_err());
        let mut forged = bytes;
        forged[0] ^= 1;
        assert!(parse_oracle_data(&forged, &client, &seed, Some(true)).is_err());
    }

    #[test]
    fn only_a_pending_oracle_can_be_refunded_after_timeout() {
        let client = Pubkey::new_unique();
        let seed = [7; 32];
        let mut pending = oracle_data(client, seed, false);
        assert_eq!(parse_oracle_data(&pending, &client, &seed, Some(false)).unwrap(), None);
        assert!(parse_oracle_data(&pending, &client, &seed, Some(true)).is_err());
        pending[73..77].copy_from_slice(&8_u32.to_le_bytes());
        assert!(parse_oracle_data(&pending, &client, &seed, Some(false)).is_err());
        assert!(!refund_due(100, 100 + REFUND_AFTER_SECONDS - 1));
        assert!(refund_due(100, 100 + REFUND_AFTER_SECONDS));
        assert!(!refund_due(0, i64::MAX));
    }

    #[test]
    fn reserve_backing_prevents_overbooking_and_is_independent_of_wallet_identity() {
        assert_eq!(reserve_for_purchase(700, 100, 200, 500, 0).unwrap(), 200);
        assert_eq!(reserve_for_purchase(700, 100, 200, 500, 100).unwrap(), 300);
        assert!(reserve_for_purchase(700, 99, 200, 500, 100).is_err());
        assert!(reserve_for_purchase(599, 1_000, 200, 500, 100).is_err());
        assert!(reserve_for_purchase(u64::MAX, 1, 1, 0, 0).is_err());
    }

    #[test]
    fn prize_snapshots_and_refund_flags_cannot_change_other_liabilities() {
        let mut padding = prize_snapshot(200).unwrap();
        assert_eq!(ticket_prize(&padding).unwrap(), 200);
        padding[9] = 1;
        assert_eq!(ticket_prize(&padding).unwrap(), 200);
        padding[10] = 1;
        assert!(ticket_prize(&padding).is_err());
        assert!(prize_snapshot(0).is_err());
        assert_eq!(payout_balances(1_100, 50, 200, 500, 400).unwrap(), (900, 250));
        assert_eq!(payout_balances(1_100, 50, 100, 500, 400).unwrap(), (1_000, 150));
        assert!(payout_balances(1_099, 50, 200, 500, 400).is_err());
        assert!(payout_balances(1_100, u64::MAX, 1, 500, 400).is_err());
    }

    #[test]
    fn settlements_and_refunds_bind_to_once_only_immutable_ticket_owner() {
        let owner = Pubkey::new_unique();
        let mut ticket = Ticket { user: owner, nonce: 1, draw_time: 100, paid_lamports: QUICK_COST, settled: false, bump: 255, numbers: [2, 22], padding: prize_snapshot(BASE_PRIZE).unwrap() };
        assert!(validate_ticket_owner(&ticket, owner).is_ok());
        assert!(validate_ticket_owner(&ticket, Pubkey::new_unique()).is_err());
        ticket.settled = true;
        assert!(validate_ticket_owner(&ticket, owner).is_err());
        ticket.settled = false;
        ticket.padding[9] = 1;
        assert!(validate_ticket_owner(&ticket, owner).is_err());
    }

    #[test]
    fn exact_six_daily_slots_preserve_current_terms() {
        let midnight = 20_000_i64 * 86_400 - 28_800;
        for hour in 0..24 {
            let time = midnight + hour * 3_600;
            assert_eq!(is_daily(time), hour % 4 == 2);
            assert!(!is_daily(time - 1));
            assert!(!is_daily(time + 1));
            assert_eq!(draw_cost(time, QUICK_COST), if hour % 4 == 2 { DAILY_COST } else { QUICK_COST });
            assert_eq!(draw_prize(time, BASE_PRIZE).unwrap(), if hour % 4 == 2 { 2 * BASE_PRIZE } else { BASE_PRIZE });
        }
    }

    #[test]
    fn receiverless_cleanup_releases_only_final_unsettled_losing_ticket_snapshots() {
        let mut round = draw(100);
        round.status = 2;
        round.numbers = [2, 22];
        let mut ticket = Ticket { user: Pubkey::new_unique(), nonce: 1, draw_time: 100, paid_lamports: QUICK_COST, settled: false, bump: 255, numbers: [22, 2], padding: prize_snapshot(BASE_PRIZE).unwrap() };
        assert_eq!(losing_ticket_prize(&ticket, &round, 100).unwrap(), BASE_PRIZE);
        assert!(losing_ticket_prize(&ticket, &round, 99).is_err());
        for status in [0, 1, 255] {
            round.status = status;
            assert!(losing_ticket_prize(&ticket, &round, 100).is_err());
        }
        round.status = 2;
        ticket.numbers = round.numbers;
        assert!(losing_ticket_prize(&ticket, &round, i64::MAX).is_err());
        ticket.numbers = [22, 2];
        ticket.settled = true;
        assert!(losing_ticket_prize(&ticket, &round, 100).is_err());
        ticket.settled = false;
        ticket.padding[9] = 1;
        assert!(losing_ticket_prize(&ticket, &round, 100).is_err());
        ticket.padding[9] = 0;
        round.draw_time = 101;
        assert!(losing_ticket_prize(&ticket, &round, 100).is_err());
    }

    #[test]
    fn draw_finalization_and_losing_cleanup_do_not_load_any_recipient_account() {
        let config = Pubkey::new_unique();
        let draw = Pubkey::new_unique();
        let oracle_request = Pubkey::new_unique();
        let finalize = crate::accounts::FinalizeDraw { config, draw, oracle_request }.to_account_metas(None);
        assert_eq!(finalize.len(), 3);
        assert!(!finalize[0].is_writable && finalize[1].is_writable && !finalize[2].is_writable);
        assert!(finalize.iter().all(|meta| !meta.is_signer));
        let vault = Pubkey::new_unique();
        let ticket = Pubkey::new_unique();
        let release = crate::accounts::ReleaseLosingTicket { config, vault, ticket, draw }.to_account_metas(None);
        assert_eq!(release.len(), 4);
        assert!(!release[0].is_writable && release[1].is_writable && release[2].is_writable && !release[3].is_writable);
        assert!(release.iter().all(|meta| !meta.is_signer));
    }
}
