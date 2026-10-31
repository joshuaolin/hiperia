use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("HDodgjBzz7Fo2irAU1ahf5X2arwr773ZcHXD3iSb7nmQ");

const BUY_AHEAD_LIMIT_HOURS: i64 = 24;

const MIN_NUMBER: u8 = 2;
const MAX_NUMBER: u8 = 22;
const NUM_PICKS: usize = 2;
const UAT_RESULT: [u8; NUM_PICKS] = [2, 22];
const UAT_BASE_PAYOUT_LAMPORTS: u64 = 1_000_000_000;
const DAILY_COST_LAMPORTS: u64 = 6_250_000;
const REFERRED_DAILY_COST_LAMPORTS: u64 = 6_200_000;
const REFERRED_QUICK_COST_LAMPORTS: u64 = 7_100_000;
const DAILY_INTERVAL_SECONDS: i64 = 4 * 3_600;
const DAILY_OFFSET_SECONDS: i64 = 2 * 3_600;
const DAILY_HOURS: [u8; 6] = [2, 6, 10, 14, 18, 22];
const UAT_ADMIN: Pubkey = Pubkey::new_from_array([
    28, 43, 82, 159, 210, 138, 77, 138, 204, 1, 163, 32, 151, 71, 49, 247, 221, 252, 123, 74, 21,
    62, 203, 193, 151, 138, 173, 173, 138, 5, 57, 119,
]);
const UAT_TESTER: Pubkey = Pubkey::new_from_array([
    233, 93, 154, 194, 139, 137, 214, 1, 230, 33, 115, 24, 166, 159, 18, 147, 48, 83, 225, 90, 31,
    236, 198, 50, 239, 205, 146, 120, 150, 136, 138, 107,
]);

const CONFIG_SEED: &[u8] = b"config";
const VAULT_SEED: &[u8] = b"vault";
const TICKET_SEED: &[u8] = b"ticket";
const RESULT_SEED: &[u8] = b"result";
const REFERRAL_SEED: &[u8] = b"referral";
const REFERRAL_CAMPAIGN: &[u8] = b"v1";
const REFERRAL_VERSION: u8 = 1;

#[program]
pub mod hiperia_program {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        ticket_cost_lamports: u64,
        payout_lamports: u64,
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.payer.key(), UAT_ADMIN, ErrorCode::Unauthorized);
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.is_initialized, ErrorCode::AlreadyInitialized);
        require!(ticket_cost_lamports > 0, ErrorCode::InvalidTicketCost);
        require_eq!(
            payout_lamports,
            UAT_BASE_PAYOUT_LAMPORTS,
            ErrorCode::InvalidPayout
        );

        cfg.is_initialized = true;
        cfg.ticket_cost_lamports = ticket_cost_lamports;
        cfg.payout_lamports = payout_lamports;
        cfg.bump = ctx.bumps.config;
        cfg.padding = UAT_TESTER.to_bytes();

        ctx.accounts.vault.bump = ctx.bumps.vault;
        ctx.accounts.vault.padding = [0; 32];

        emit!(Initialized {
            ticket_cost_lamports,
            payout_lamports
        });

        Ok(())
    }

    pub fn configure_uat(ctx: Context<ConfigureUat>, tester: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), UAT_ADMIN, ErrorCode::Unauthorized);
        require!(tester != Pubkey::default(), ErrorCode::InvalidUatTester);
        ctx.accounts.config.padding = tester.to_bytes();
        Ok(())
    }

    pub fn get_rules(ctx: Context<GetRules>) -> Result<UatRules> {
        uat_rules(
            ctx.accounts.config.ticket_cost_lamports,
            ctx.accounts.config.payout_lamports,
        )
    }

    pub fn get_referral_rules(ctx: Context<GetRules>) -> Result<ReferralRules> {
        referral_rules(ctx.accounts.config.ticket_cost_lamports)
    }

    pub fn buy_ticket(
        ctx: Context<BuyTicket>,
        ticket_nonce: u64,
        draw_time: i64,
        numbers: [u8; NUM_PICKS],
    ) -> Result<()> {
        record_ticket_purchase(
            &ctx.accounts.config,
            &mut ctx.accounts.vault,
            &mut ctx.accounts.ticket,
            &ctx.accounts.user,
            &ctx.accounts.system_program,
            ctx.bumps.ticket,
            ticket_nonce,
            draw_time,
            numbers,
            None,
        )
    }

    pub fn register_referral(ctx: Context<RegisterReferral>, sharing_enabled: bool) -> Result<()> {
        let profile = &mut ctx.accounts.profile;
        profile.version = REFERRAL_VERSION;
        profile.bump = ctx.bumps.profile;
        profile.owner = ctx.accounts.owner.key();
        profile.referrer = Pubkey::default();
        profile.sharing_enabled = sharing_enabled;
        profile.benefits_enabled = false;
        profile.binding_locked = false;
        profile.qualified = false;
        profile.first_ticket = Pubkey::default();
        profile.registered_count = 0;
        profile.qualified_count = 0;
        emit!(ReferralUpdated {
            owner: profile.owner,
            referrer: profile.referrer,
            sharing_enabled,
            benefits_enabled: false,
            binding_locked: false,
        });
        Ok(())
    }

    pub fn update_referral(
        ctx: Context<UpdateReferral>,
        sharing_enabled: bool,
        referrer: Pubkey,
        benefits_enabled: bool,
    ) -> Result<()> {
        let profile = &ctx.accounts.profile;
        validate_referral_binding(profile, referrer)?;
        require!(
            !benefits_enabled || referrer != Pubkey::default(),
            ErrorCode::InvalidReferrer
        );
        validate_referrer_account(
            ctx.accounts.referrer_profile.as_ref(),
            referrer,
            profile.referrer != referrer,
        )?;
        let profile = &mut ctx.accounts.profile;
        profile.sharing_enabled = sharing_enabled;
        profile.referrer = referrer;
        profile.benefits_enabled = benefits_enabled;
        emit!(ReferralUpdated {
            owner: profile.owner,
            referrer,
            sharing_enabled,
            benefits_enabled,
            binding_locked: profile.binding_locked,
        });
        Ok(())
    }

    pub fn buy_ticket_referred(
        ctx: Context<BuyTicketReferred>,
        ticket_nonce: u64,
        draw_time: i64,
        numbers: [u8; NUM_PICKS],
    ) -> Result<()> {
        validate_referral_profile(&ctx.accounts.profile)?;
        require_keys_eq!(
            ctx.accounts.profile.owner,
            ctx.accounts.user.key(),
            ErrorCode::InvalidReferralProfile
        );
        validate_referrer_account(
            ctx.accounts.referrer_profile.as_ref(),
            ctx.accounts.profile.referrer,
            false,
        )?;
        let ticket_cost = referral_ticket_cost(
            draw_time,
            ctx.accounts.config.ticket_cost_lamports,
            &ctx.accounts.profile,
        )?;
        record_ticket_purchase(
            &ctx.accounts.config,
            &mut ctx.accounts.vault,
            &mut ctx.accounts.ticket,
            &ctx.accounts.user,
            &ctx.accounts.system_program,
            ctx.bumps.ticket,
            ticket_nonce,
            draw_time,
            numbers,
            Some(ticket_cost),
        )?;
        if !ctx.accounts.profile.binding_locked {
            if let Some(referrer) = ctx.accounts.referrer_profile.as_mut() {
                referrer.registered_count = increment_referral_count(referrer.registered_count)?;
            }
            let profile = &mut ctx.accounts.profile;
            profile.first_ticket = ctx.accounts.ticket.key();
            profile.binding_locked = true;
            emit!(ReferralJoined {
                owner: profile.owner,
                referrer: profile.referrer,
                ticket: profile.first_ticket,
            });
        }
        Ok(())
    }

    pub fn qualify_referral(ctx: Context<QualifyReferral>) -> Result<()> {
        validate_referral_qualification(
            &ctx.accounts.profile,
            &ctx.accounts.ticket,
            ctx.accounts.ticket.key(),
        )?;
        validate_referrer_account(
            ctx.accounts.referrer_profile.as_ref(),
            ctx.accounts.profile.referrer,
            false,
        )?;
        if ctx.accounts.profile.qualified {
            return Ok(());
        }
        if let Some(referrer) = ctx.accounts.referrer_profile.as_mut() {
            referrer.qualified_count = increment_referral_count(referrer.qualified_count)?;
            require!(
                referrer.qualified_count <= referrer.registered_count,
                ErrorCode::InvalidReferralProfile
            );
        }
        let profile = &mut ctx.accounts.profile;
        profile.qualified = true;
        emit!(ReferralQualified {
            owner: profile.owner,
            referrer: profile.referrer,
            ticket: profile.first_ticket,
        });
        Ok(())
    }

    pub fn publish_result(ctx: Context<PublishResult>, draw_time: i64) -> Result<()> {
        require!(
            authorized_uat_wallet(ctx.accounts.payer.key(), &ctx.accounts.config.padding),
            ErrorCode::UnauthorizedUatWallet
        );
        let clock = Clock::get()?;
        require!(draw_time > 0, ErrorCode::BadDrawTime);
        require!(clock.unix_timestamp >= draw_time, ErrorCode::TooEarly);

        let metadata = result_snapshot(
            draw_time,
            ctx.accounts.config.ticket_cost_lamports,
            ctx.accounts.config.payout_lamports,
        )?;

        let r = &mut ctx.accounts.result;
        require!(!r.is_published, ErrorCode::AlreadyPublished);

        r.draw_time = draw_time;
        r.numbers = UAT_RESULT;
        r.is_published = true;
        r.bump = ctx.bumps.result;
        r.padding = metadata;

        emit!(ResultPublished {
            draw_time,
            numbers: r.numbers,
        });

        Ok(())
    }

    pub fn settle_ticket(ctx: Context<SettleTicket>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let t = &mut ctx.accounts.ticket;

        let r = &ctx.accounts.result;
        validate_settlement(
            t.user,
            ctx.accounts.user.key(),
            t.settled,
            now,
            t.draw_time,
            r.is_published,
            r.draw_time,
        )?;

        let is_winner = t.numbers == r.numbers;
        let prize = ticket_prize(&t.padding, ctx.accounts.config.payout_lamports)?;
        let vault_info = ctx.accounts.vault.to_account_info();
        let user_info = ctx.accounts.user.to_account_info();
        let rent_minimum = Rent::get()?.minimum_balance(vault_info.data_len());
        let reserved = reserved_liability(&ctx.accounts.vault.padding)?;
        validate_reserve_coverage(vault_info.lamports(), rent_minimum, reserved)?;
        let reserved_after = release_ticket_reserve(reserved, prize, &t.padding)?;
        let payout = if is_winner { prize } else { 0 };
        let (vault_after, user_after) = payout_balances(
            vault_info.lamports(),
            user_info.lamports(),
            payout,
            rent_minimum,
            reserved_after,
        )?;
        if is_winner {
            **vault_info.try_borrow_mut_lamports()? = vault_after;
            **user_info.try_borrow_mut_lamports()? = user_after;
        }
        ctx.accounts.vault.padding[..8].copy_from_slice(&reserved_after.to_le_bytes());

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

fn record_ticket_purchase<'info>(
    cfg: &Account<'info, Config>,
    vault: &mut Account<'info, Vault>,
    ticket: &mut Account<'info, Ticket>,
    user: &Signer<'info>,
    system_program: &Program<'info, System>,
    ticket_bump: u8,
    ticket_nonce: u64,
    draw_time: i64,
    numbers: [u8; NUM_PICKS],
    ticket_cost_override: Option<u64>,
) -> Result<()> {
    require!(cfg.is_initialized, ErrorCode::Uninitialized);
    require!(
        authorized_uat_wallet(user.key(), &cfg.padding),
        ErrorCode::UnauthorizedUatWallet
    );
    require!(valid_numbers(&numbers), ErrorCode::InvalidNumbers);
    let now = Clock::get()?.unix_timestamp;
    require!(
        draw_time > now && draw_time <= now.saturating_add(60 * 60 * BUY_AHEAD_LIMIT_HOURS),
        ErrorCode::BadDrawTime
    );
    let vault_info = vault.to_account_info();
    let rent_minimum = Rent::get()?.minimum_balance(vault_info.data_len());
    let reserved = reserved_liability(&vault.padding)?;
    let ticket_cost = ticket_cost_override.unwrap_or_else(|| draw_cost(draw_time, cfg.ticket_cost_lamports));
    require!(ticket_cost > 0, ErrorCode::InvalidTicketCost);
    let prize = draw_prize(draw_time, cfg.payout_lamports)?;
    let reserved_after = reserve_for_purchase(
        vault_info.lamports(),
        ticket_cost,
        prize,
        rent_minimum,
        reserved,
    )?;
    let prize_padding = prize_snapshot(prize)?;
    transfer(
        CpiContext::new(
            system_program.to_account_info(),
            Transfer {
                from: user.to_account_info(),
                to: vault.to_account_info(),
            },
        ),
        ticket_cost,
    )?;
    vault.padding[..8].copy_from_slice(&reserved_after.to_le_bytes());
    ticket.user = user.key();
    ticket.nonce = ticket_nonce;
    ticket.draw_time = draw_time;
    ticket.paid_lamports = ticket_cost;
    ticket.settled = false;
    ticket.bump = ticket_bump;
    ticket.numbers = numbers;
    ticket.padding = prize_padding;
    emit!(TicketPurchased {
        user: ticket.user,
        nonce: ticket.nonce,
        draw_time: ticket.draw_time,
        numbers: ticket.numbers,
        paid_lamports: ticket.paid_lamports,
    });
    Ok(())
}

fn validate_referral_profile(profile: &ReferralProfile) -> Result<()> {
    require!(
        profile.version == REFERRAL_VERSION
            && profile.owner != Pubkey::default()
            && profile.owner != profile.referrer
            && (!profile.benefits_enabled || profile.referrer != Pubkey::default())
            && profile.binding_locked == (profile.first_ticket != Pubkey::default())
            && (!profile.qualified || profile.binding_locked)
            && profile.qualified_count <= profile.registered_count,
        ErrorCode::InvalidReferralProfile
    );
    Ok(())
}

fn validate_referral_binding(profile: &ReferralProfile, referrer: Pubkey) -> Result<()> {
    validate_referral_profile(profile)?;
    require!(profile.owner != referrer, ErrorCode::SelfReferral);
    require!(
        !profile.binding_locked || profile.referrer == referrer,
        ErrorCode::ReferralBindingLocked
    );
    Ok(())
}

fn validate_referrer_account(
    profile: Option<&Account<ReferralProfile>>,
    expected: Pubkey,
    require_sharing: bool,
) -> Result<()> {
    if expected == Pubkey::default() {
        require!(profile.is_none(), ErrorCode::InvalidReferrer);
        return Ok(());
    }
    let profile = profile.ok_or_else(|| error!(ErrorCode::InvalidReferrer))?;
    validate_referral_profile(profile)?;
    let (address, bump) = Pubkey::find_program_address(
        &[REFERRAL_SEED, REFERRAL_CAMPAIGN, expected.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(profile.key(), address, ErrorCode::InvalidReferrer);
    require_keys_eq!(profile.owner, expected, ErrorCode::InvalidReferrer);
    require!(profile.bump == bump, ErrorCode::InvalidReferrer);
    require!(
        !require_sharing || profile.sharing_enabled,
        ErrorCode::ReferralSharingDisabled
    );
    Ok(())
}

fn validate_referral_qualification(
    profile: &ReferralProfile,
    ticket: &Ticket,
    ticket_address: Pubkey,
) -> Result<()> {
    validate_referral_profile(profile)?;
    require!(profile.binding_locked, ErrorCode::ReferralNotEligible);
    require_keys_eq!(profile.first_ticket, ticket_address, ErrorCode::ReferralNotEligible);
    require_keys_eq!(profile.owner, ticket.user, ErrorCode::ReferralNotEligible);
    require!(
        ticket.settled && ticket.paid_lamports > 0 && ticket.draw_time > 0,
        ErrorCode::ReferralNotEligible
    );
    require!(ticket.padding[0] == 2, ErrorCode::ReferralNotEligible);
    ticket_prize(&ticket.padding, 0)?;
    Ok(())
}

fn increment_referral_count(count: u64) -> Result<u64> {
    count.checked_add(1).ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
}

fn referral_rules(quick_cost: u64) -> Result<ReferralRules> {
    require!(quick_cost > REFERRED_QUICK_COST_LAMPORTS, ErrorCode::InvalidTicketCost);
    Ok(ReferralRules {
        revision: 5,
        campaign_version: REFERRAL_VERSION,
        normal_quick_ticket_cost_lamports: quick_cost,
        normal_daily_ticket_cost_lamports: DAILY_COST_LAMPORTS,
        referred_quick_ticket_cost_lamports: REFERRED_QUICK_COST_LAMPORTS,
        referred_daily_ticket_cost_lamports: REFERRED_DAILY_COST_LAMPORTS,
    })
}

fn referral_ticket_cost(draw_time: i64, quick_cost: u64, profile: &ReferralProfile) -> Result<u64> {
    validate_referral_profile(profile)?;
    if profile.referrer == Pubkey::default() || !profile.benefits_enabled {
        return Ok(draw_cost(draw_time, quick_cost));
    }
    let rules = referral_rules(quick_cost)?;
    Ok(if is_daily_draw(draw_time) {
        rules.referred_daily_ticket_cost_lamports
    } else {
        rules.referred_quick_ticket_cost_lamports
    })
}

fn authorized_uat_wallet(user: Pubkey, tester_bytes: &[u8; 32]) -> bool {
    let tester = Pubkey::new_from_array(*tester_bytes);
    tester != Pubkey::default() && (user == UAT_ADMIN || user == tester)
}

fn is_daily_draw(draw_time: i64) -> bool {
    draw_time.rem_euclid(DAILY_INTERVAL_SECONDS) == DAILY_OFFSET_SECONDS
}

fn draw_cost(draw_time: i64, quick_cost: u64) -> u64 {
    if is_daily_draw(draw_time) {
        DAILY_COST_LAMPORTS
    } else {
        quick_cost
    }
}

fn draw_prize(draw_time: i64, base_payout: u64) -> Result<u64> {
    if is_daily_draw(draw_time) {
        base_payout
            .checked_mul(2)
            .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))
    } else {
        Ok(base_payout)
    }
}

fn uat_rules(quick_cost: u64, base_payout: u64) -> Result<UatRules> {
    Ok(UatRules {
        revision: 4,
        min_number: MIN_NUMBER,
        max_number: MAX_NUMBER,
        pick_count: NUM_PICKS as u8,
        winning_numbers: UAT_RESULT,
        quick_ticket_cost_lamports: quick_cost,
        daily_ticket_cost_lamports: DAILY_COST_LAMPORTS,
        quick_payout_lamports: base_payout,
        daily_payout_lamports: draw_prize(DAILY_OFFSET_SECONDS, base_payout)?,
        daily_hours: DAILY_HOURS,
        schedule_interval_seconds: DAILY_INTERVAL_SECONDS as u32,
        schedule_offset_seconds: DAILY_OFFSET_SECONDS as u32,
        buy_ahead_seconds: (BUY_AHEAD_LIMIT_HOURS * 3_600) as u32,
    })
}

fn result_snapshot(draw_time: i64, quick_cost: u64, base_payout: u64) -> Result<[u8; 32]> {
    let mut padding = [0; 32];
    padding[0] = 1;
    padding[1] = u8::from(is_daily_draw(draw_time));
    padding[2..10].copy_from_slice(&draw_prize(draw_time, base_payout)?.to_le_bytes());
    padding[10..18].copy_from_slice(&draw_cost(draw_time, quick_cost).to_le_bytes());
    Ok(padding)
}

fn prize_snapshot(prize: u64) -> Result<[u8; 32]> {
    require!(prize > 0, ErrorCode::InvalidTicketReserve);
    let mut padding = [0; 32];
    padding[0] = 2;
    padding[1..9].copy_from_slice(&prize.to_le_bytes());
    Ok(padding)
}

fn ticket_prize(padding: &[u8; 32], base_payout: u64) -> Result<u64> {
    match padding[0] {
        0 | 1 => {
            require!(
                padding[1..].iter().all(|byte| *byte == 0),
                ErrorCode::InvalidTicketReserve
            );
            require!(base_payout > 0, ErrorCode::InvalidTicketReserve);
            Ok(base_payout)
        }
        2 => {
            require!(
                padding[9..].iter().all(|byte| *byte == 0),
                ErrorCode::InvalidTicketReserve
            );
            let mut bytes = [0; 8];
            bytes.copy_from_slice(&padding[1..9]);
            let prize = u64::from_le_bytes(bytes);
            require!(prize > 0, ErrorCode::InvalidTicketReserve);
            Ok(prize)
        }
        _ => err!(ErrorCode::InvalidTicketReserve),
    }
}

fn reserved_liability(padding: &[u8; 32]) -> Result<u64> {
    require!(
        padding[8..].iter().all(|byte| *byte == 0),
        ErrorCode::InvalidVaultReserve
    );
    let mut bytes = [0; 8];
    bytes.copy_from_slice(&padding[..8]);
    Ok(u64::from_le_bytes(bytes))
}

fn validate_reserve_coverage(vault_balance: u64, rent_minimum: u64, reserved: u64) -> Result<()> {
    let required = rent_minimum
        .checked_add(reserved)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(vault_balance >= required, ErrorCode::InvalidVaultReserve);
    Ok(())
}

fn reserve_for_purchase(
    vault_balance: u64,
    ticket_cost: u64,
    payout: u64,
    rent_minimum: u64,
    reserved: u64,
) -> Result<u64> {
    validate_reserve_coverage(vault_balance, rent_minimum, reserved)?;
    let reserved_after = reserved
        .checked_add(payout)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    let required = rent_minimum
        .checked_add(reserved_after)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    let available = vault_balance
        .checked_add(ticket_cost)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(available >= required, ErrorCode::InsufficientVaultFunds);
    Ok(reserved_after)
}

fn release_ticket_reserve(reserved: u64, payout: u64, padding: &[u8; 32]) -> Result<u64> {
    let prize = ticket_prize(padding, payout)?;
    match padding[0] {
        0 => Ok(reserved),
        1 | 2 => reserved
            .checked_sub(prize)
            .ok_or_else(|| error!(ErrorCode::InvalidVaultReserve)),
        _ => err!(ErrorCode::InvalidTicketReserve),
    }
}

fn payout_balances(
    vault_balance: u64,
    user_balance: u64,
    payout: u64,
    rent_minimum: u64,
    reserved_after: u64,
) -> Result<(u64, u64)> {
    let vault_after = vault_balance
        .checked_sub(payout)
        .ok_or_else(|| error!(ErrorCode::InsufficientVaultFunds))?;
    let required = rent_minimum
        .checked_add(reserved_after)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    require!(vault_after >= required, ErrorCode::InsufficientVaultFunds);
    let user_after = user_balance
        .checked_add(payout)
        .ok_or_else(|| error!(ErrorCode::ArithmeticOverflow))?;
    Ok((vault_after, user_after))
}

fn settlement_allowed(current_time: i64, draw_time: i64) -> bool {
    draw_time > 0 && current_time >= draw_time
}

fn validate_settlement(
    ticket_owner: Pubkey,
    recipient: Pubkey,
    settled: bool,
    current_time: i64,
    draw_time: i64,
    result_published: bool,
    result_draw_time: i64,
) -> Result<()> {
    require_keys_eq!(ticket_owner, recipient, ErrorCode::Unauthorized);
    require!(!settled, ErrorCode::AlreadySettled);
    require!(settlement_allowed(current_time, draw_time), ErrorCode::TooEarly);
    require!(result_published, ErrorCode::ResultNotPublished);
    require_eq!(result_draw_time, draw_time, ErrorCode::MismatchedDraw);
    Ok(())
}

fn valid_numbers(nums: &[u8; NUM_PICKS]) -> bool {
    let a = nums[0];
    let b = nums[1];
    a >= MIN_NUMBER && a <= MAX_NUMBER && b >= MIN_NUMBER && b <= MAX_NUMBER && a != b
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
pub struct ConfigureUat<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::Uninitialized
    )]
    pub config: Account<'info, Config>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct GetRules<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::Uninitialized
    )]
    pub config: Account<'info, Config>,
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
pub struct RegisterReferral<'info> {
    #[account(
        init,
        payer = owner,
        space = ReferralProfile::SPACE,
        seeds = [REFERRAL_SEED, REFERRAL_CAMPAIGN, owner.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, ReferralProfile>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateReferral<'info> {
    #[account(
        mut,
        seeds = [REFERRAL_SEED, REFERRAL_CAMPAIGN, owner.key().as_ref()],
        bump = profile.bump,
        constraint = profile.owner == owner.key() @ ErrorCode::InvalidReferralProfile
    )]
    pub profile: Account<'info, ReferralProfile>,

    pub owner: Signer<'info>,

    pub referrer_profile: Option<Account<'info, ReferralProfile>>,
}

#[derive(Accounts)]
#[instruction(ticket_nonce: u64, draw_time: i64, numbers: [u8; 2])]
pub struct BuyTicketReferred<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.is_initialized @ ErrorCode::Uninitialized
    )]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = user,
        space = Ticket::SPACE,
        seeds = [TICKET_SEED, user.key().as_ref(), &ticket_nonce.to_le_bytes()],
        bump
    )]
    pub ticket: Account<'info, Ticket>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,

    #[account(
        mut,
        seeds = [REFERRAL_SEED, REFERRAL_CAMPAIGN, user.key().as_ref()],
        bump = profile.bump,
        constraint = profile.owner == user.key() @ ErrorCode::InvalidReferralProfile
    )]
    pub profile: Account<'info, ReferralProfile>,

    #[account(mut)]
    pub referrer_profile: Option<Account<'info, ReferralProfile>>,
}

#[derive(Accounts)]
pub struct QualifyReferral<'info> {
    #[account(
        mut,
        seeds = [REFERRAL_SEED, REFERRAL_CAMPAIGN, profile.owner.as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, ReferralProfile>,

    #[account(
        seeds = [TICKET_SEED, ticket.user.as_ref(), &ticket.nonce.to_le_bytes()],
        bump = ticket.bump
    )]
    pub ticket: Account<'info, Ticket>,

    #[account(mut)]
    pub referrer_profile: Option<Account<'info, ReferralProfile>>,
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
    pub user: SystemAccount<'info>,

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
impl Config {
    pub const SPACE: usize = 8 + 1 + 1 + 8 + 8 + 32;
}

#[account]
pub struct Vault {
    pub bump: u8,
    pub padding: [u8; 32],
}
impl Vault {
    pub const SPACE: usize = 8 + 1 + 32;
}

#[account]
pub struct Ticket {
    pub user: Pubkey,
    pub nonce: u64,
    pub draw_time: i64,
    pub paid_lamports: u64,
    pub settled: bool,
    pub bump: u8,
    pub numbers: [u8; NUM_PICKS],
    pub padding: [u8; 32],
}
impl Ticket {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 1 + 1 + NUM_PICKS + 32;
}

#[account]
pub struct ResultAccount {
    pub draw_time: i64,
    pub numbers: [u8; NUM_PICKS],
    pub is_published: bool,
    pub bump: u8,
    pub padding: [u8; 32],
}
impl ResultAccount {
    pub const SPACE: usize = 8 + 8 + NUM_PICKS + 1 + 1 + 32;
}

#[account]
pub struct ReferralProfile {
    pub version: u8,
    pub bump: u8,
    pub owner: Pubkey,
    pub referrer: Pubkey,
    pub sharing_enabled: bool,
    pub benefits_enabled: bool,
    pub binding_locked: bool,
    pub qualified: bool,
    pub first_ticket: Pubkey,
    pub registered_count: u64,
    pub qualified_count: u64,
}

impl ReferralProfile {
    pub const SPACE: usize = 8 + 1 + 1 + 32 + 32 + 1 + 1 + 1 + 1 + 32 + 8 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ReferralRules {
    pub revision: u8,
    pub campaign_version: u8,
    pub normal_quick_ticket_cost_lamports: u64,
    pub normal_daily_ticket_cost_lamports: u64,
    pub referred_quick_ticket_cost_lamports: u64,
    pub referred_daily_ticket_cost_lamports: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct UatRules {
    pub revision: u8,
    pub min_number: u8,
    pub max_number: u8,
    pub pick_count: u8,
    pub winning_numbers: [u8; NUM_PICKS],
    pub quick_ticket_cost_lamports: u64,
    pub daily_ticket_cost_lamports: u64,
    pub quick_payout_lamports: u64,
    pub daily_payout_lamports: u64,
    pub daily_hours: [u8; 6],
    pub schedule_interval_seconds: u32,
    pub schedule_offset_seconds: u32,
    pub buy_ahead_seconds: u32,
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

#[event]
pub struct ReferralUpdated {
    pub owner: Pubkey,
    pub referrer: Pubkey,
    pub sharing_enabled: bool,
    pub benefits_enabled: bool,
    pub binding_locked: bool,
}

#[event]
pub struct ReferralJoined {
    pub owner: Pubkey,
    pub referrer: Pubkey,
    pub ticket: Pubkey,
}

#[event]
pub struct ReferralQualified {
    pub owner: Pubkey,
    pub referrer: Pubkey,
    pub ticket: Pubkey,
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
    #[msg("The vault cannot pay this prize while preserving its rent reserve")]
    InsufficientVaultFunds,
    #[msg("The account balance would overflow")]
    ArithmeticOverflow,
    #[msg("This UAT program only accepts the configured tester or UAT administrator")]
    UnauthorizedUatWallet,
    #[msg("The UAT tester must be a nonzero wallet address")]
    InvalidUatTester,
    #[msg("The vault liability reserve is invalid or underfunded")]
    InvalidVaultReserve,
    #[msg("The ticket liability reserve marker is invalid")]
    InvalidTicketReserve,
    #[msg("The referral campaign profile is invalid")]
    InvalidReferralProfile,
    #[msg("A wallet cannot refer itself")]
    SelfReferral,
    #[msg("The referrer is permanent after the first paid campaign ticket")]
    ReferralBindingLocked,
    #[msg("The referrer does not match its campaign profile")]
    InvalidReferrer,
    #[msg("The referrer is not accepting new bindings")]
    ReferralSharingDisabled,
    #[msg("This campaign player has already qualified")]
    ReferralAlreadyQualified,
    #[msg("The first campaign ticket must be paid and settled before qualification")]
    ReferralNotEligible,
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payout_preserves_rent_and_moves_only_the_prize() {
        assert_eq!(payout_balances(1_000, 100, 200, 500, 0).unwrap(), (800, 300));
        assert_eq!(payout_balances(700, 100, 200, 500, 0).unwrap(), (500, 300));
    }

    #[test]
    fn payout_rejects_underfunding_and_overflow() {
        assert!(payout_balances(699, 100, 200, 500, 0).is_err());
        assert!(payout_balances(199, 100, 200, 0, 0).is_err());
        assert!(payout_balances(1_000, u64::MAX, 1, 500, 0).is_err());
    }

    #[test]
    fn picks_are_distinct_and_in_range() {
        assert!(valid_numbers(&[2, 22]));
        assert!(valid_numbers(&[22, 2]));
        assert!(!valid_numbers(&[1, 22]));
        assert!(!valid_numbers(&[22, 1]));
        assert!(!valid_numbers(&[0, 2]));
        assert!(!valid_numbers(&[2, 23]));
        assert!(!valid_numbers(&[22, 22]));
    }

    #[test]
    fn uat_claims_require_the_draw_without_a_claim_expiry() {
        assert!(!settlement_allowed(99, 100));
        assert!(settlement_allowed(100, 100));
        assert!(settlement_allowed(401, 100));
        assert!(settlement_allowed(i64::MAX, 100));
        assert!(!settlement_allowed(100, 0));
        assert_eq!(UAT_RESULT, [2, 22]);
        assert!(valid_numbers(&UAT_RESULT));
    }

    #[test]
    fn permissionless_settlement_is_bound_to_the_immutable_owner_and_result() {
        let owner = Pubkey::new_unique();
        let attacker = Pubkey::new_unique();
        assert!(validate_settlement(owner, owner, false, 100, 100, true, 100).is_ok());
        assert!(validate_settlement(owner, owner, false, i64::MAX, 100, true, 100).is_ok());
        assert!(validate_settlement(owner, attacker, false, 100, 100, true, 100).is_err());
        assert!(validate_settlement(owner, owner, true, 100, 100, true, 100).is_err());
        assert!(validate_settlement(owner, owner, false, 99, 100, true, 100).is_err());
        assert!(validate_settlement(owner, owner, false, 100, 100, false, 100).is_err());
        assert!(validate_settlement(owner, owner, false, 100, 100, true, 101).is_err());
    }

    #[test]
    fn third_party_settlement_frees_only_the_ticket_reserve_and_pays_only_its_owner() {
        let owner = Pubkey::new_unique();
        let prize = prize_snapshot(200).unwrap();
        assert!(validate_settlement(owner, owner, false, 100, 100, true, 100).is_ok());
        let remaining = release_ticket_reserve(600, 999, &prize).unwrap();
        assert_eq!(remaining, 400);
        assert_eq!(payout_balances(1_100, 50, 0, 500, remaining).unwrap(), (1_100, 50));
        assert_eq!(payout_balances(1_100, 50, 200, 500, remaining).unwrap(), (900, 250));
        assert!(payout_balances(1_099, 50, 200, 500, remaining).is_err());
    }

    #[test]
    fn only_the_configured_uat_wallet_and_administrator_are_authorized() {
        let tester = UAT_TESTER.to_bytes();
        assert!(authorized_uat_wallet(UAT_TESTER, &tester));
        assert!(authorized_uat_wallet(UAT_ADMIN, &tester));
        assert!(!authorized_uat_wallet(Pubkey::default(), &tester));
        assert!(!authorized_uat_wallet(Pubkey::new_unique(), &tester));
        assert!(!authorized_uat_wallet(UAT_ADMIN, &[0; 32]));
    }

    #[test]
    fn purchases_reserve_every_prize_before_accepting_payment() {
        assert_eq!(reserve_for_purchase(700, 100, 200, 500, 0).unwrap(), 200);
        assert_eq!(reserve_for_purchase(700, 100, 200, 500, 100).unwrap(), 300);
        assert!(reserve_for_purchase(700, 99, 200, 500, 100).is_err());
        assert!(reserve_for_purchase(599, 1_000, 200, 500, 100).is_err());
        assert!(reserve_for_purchase(u64::MAX, 1, 1, 0, 0).is_err());
        assert!(reserve_for_purchase(u64::MAX, 0, 1, 0, u64::MAX).is_err());
    }

    #[test]
    fn daily_terms_apply_only_at_exact_four_hour_slots_including_midnight_rollover() {
        let day = 20_000_i64 * 86_400;
        for hour in [2, 6, 10, 14, 18, 22] {
            let second = hour * 3_600;
            assert_eq!(draw_prize(day + second, 1_000).unwrap(), 2_000);
            assert_eq!(draw_cost(day + second, 7_200_000), DAILY_COST_LAMPORTS);
            assert_eq!(draw_prize(day + second - 1, 1_000).unwrap(), 1_000);
            assert_eq!(draw_cost(day + second - 1, 7_200_000), 7_200_000);
            assert_eq!(draw_prize(day + second + 1, 1_000).unwrap(), 1_000);
            assert_eq!(draw_cost(day + second + 1, 7_200_000), 7_200_000);
        }
        assert_eq!(draw_prize(day, 1_000).unwrap(), 1_000);
        assert_eq!(draw_cost(day, 7_200_000), 7_200_000);
        assert_eq!(draw_prize(day + 86_400 + 2 * 3_600, 1_000).unwrap(), 2_000);
        assert_eq!(draw_prize(day + 86_400 - 2 * 3_600, 1_000).unwrap(), 2_000);
        assert!(draw_prize(day + 6 * 3_600, u64::MAX).is_err());
    }

    #[test]
    fn daily_rules_cover_every_manila_slot_without_allowing_adjacent_seconds() {
        let manila_midnight = 20_000_i64 * 86_400 - 8 * 3_600;
        for local_hour in 0..24 {
            let timestamp = manila_midnight + local_hour * 3_600;
            let expected_daily = local_hour % 4 == 2;
            assert_eq!(is_daily_draw(timestamp), expected_daily);
            assert!(!is_daily_draw(timestamp - 1));
            assert!(!is_daily_draw(timestamp + 1));
        }
    }

    #[test]
    fn ordered_distinct_outcomes_and_daily_economics_are_consistent() {
        let outcomes = (MIN_NUMBER..=MAX_NUMBER)
            .flat_map(|a| (MIN_NUMBER..=MAX_NUMBER).map(move |b| [a, b]))
            .filter(valid_numbers)
            .count() as u64;
        assert_eq!(outcomes, 420);
        let cycle_income = outcomes.checked_mul(DAILY_COST_LAMPORTS).unwrap();
        let prize = draw_prize(DAILY_OFFSET_SECONDS, UAT_BASE_PAYOUT_LAMPORTS).unwrap();
        assert!(cycle_income > prize);
        assert_eq!(prize / DAILY_COST_LAMPORTS, 320);
        assert_eq!(cycle_income - prize, 625_000_000);
    }

    #[test]
    fn readonly_rules_describe_the_same_terms_as_purchases_and_publication() {
        let rules = uat_rules(7_200_000, UAT_BASE_PAYOUT_LAMPORTS).unwrap();
        assert_eq!(rules.revision, 4);
        assert_eq!(rules.min_number, 2);
        assert_eq!(rules.max_number, 22);
        assert_eq!(rules.pick_count, 2);
        assert_eq!(rules.winning_numbers, [2, 22]);
        assert_eq!(rules.quick_ticket_cost_lamports, 7_200_000);
        assert_eq!(rules.daily_ticket_cost_lamports, 6_250_000);
        assert_eq!(rules.quick_payout_lamports, 1_000_000_000);
        assert_eq!(rules.daily_payout_lamports, 2_000_000_000);
        assert_eq!(rules.daily_hours, [2, 6, 10, 14, 18, 22]);
        assert_eq!(rules.schedule_interval_seconds, 14_400);
        assert_eq!(rules.schedule_offset_seconds, 7_200);
        assert_eq!(rules.buy_ahead_seconds, 86_400);
        assert!(uat_rules(7_200_000, u64::MAX).is_err());
    }

    #[test]
    fn published_results_snapshot_their_actual_draw_mode_price_and_prize() {
        let daily = result_snapshot(DAILY_OFFSET_SECONDS, 7_200_000, 1_000_000_000).unwrap();
        let quick = result_snapshot(DAILY_OFFSET_SECONDS + 1, 7_200_000, 1_000_000_000).unwrap();
        assert_eq!(daily[0], 1);
        assert_eq!(quick[0], 1);
        assert_eq!(daily[1], 1);
        assert_eq!(quick[1], 0);
        assert_eq!(&daily[2..10], &2_000_000_000_u64.to_le_bytes());
        assert_eq!(&quick[2..10], &1_000_000_000_u64.to_le_bytes());
        assert_eq!(&daily[10..18], &6_250_000_u64.to_le_bytes());
        assert_eq!(&quick[10..18], &7_200_000_u64.to_le_bytes());
        assert!(daily[18..].iter().all(|byte| *byte == 0));
        assert!(quick[18..].iter().all(|byte| *byte == 0));
        assert!(result_snapshot(DAILY_OFFSET_SECONDS, 7_200_000, u64::MAX).is_err());
    }

    #[test]
    fn ticket_snapshots_keep_the_original_prize_when_the_base_changes() {
        let quick = prize_snapshot(1_000).unwrap();
        let daily = prize_snapshot(2_000).unwrap();
        assert_eq!(quick[0], 2);
        assert_eq!(daily[0], 2);
        assert_eq!(ticket_prize(&quick, 9_000).unwrap(), 1_000);
        assert_eq!(ticket_prize(&daily, 9_000).unwrap(), 2_000);
        assert_eq!(release_ticket_reserve(3_000, 9_000, &quick).unwrap(), 2_000);
        assert_eq!(release_ticket_reserve(3_000, 9_000, &daily).unwrap(), 1_000);
        assert!(prize_snapshot(0).is_err());
    }

    #[test]
    fn legacy_daily_tickets_keep_the_base_prize_and_original_reserve() {
        let legacy_unreserved = [0; 32];
        let mut legacy_reserved = [0; 32];
        legacy_reserved[0] = 1;
        assert_eq!(draw_prize(6 * 3_600, 1_000).unwrap(), 2_000);
        assert_eq!(ticket_prize(&legacy_unreserved, 1_000).unwrap(), 1_000);
        assert_eq!(ticket_prize(&legacy_reserved, 1_000).unwrap(), 1_000);
        assert_eq!(
            release_ticket_reserve(3_000, 1_000, &legacy_unreserved).unwrap(),
            3_000
        );
        assert_eq!(
            release_ticket_reserve(3_000, 1_000, &legacy_reserved).unwrap(),
            2_000
        );
    }

    #[test]
    fn daily_reserves_reject_overselling_and_release_each_ticket_prize() {
        let quick = prize_snapshot(500).unwrap();
        let daily = prize_snapshot(1_000).unwrap();
        assert_eq!(
            reserve_for_purchase(1_500, 100, 1_000, 500, 0).unwrap(),
            1_000
        );
        assert!(reserve_for_purchase(1_600, 100, 1_000, 500, 1_000).is_err());
        let after_quick = release_ticket_reserve(1_500, 500, &quick).unwrap();
        assert_eq!(after_quick, 1_000);
        assert_eq!(
            payout_balances(2_500, 0, 500, 500, after_quick).unwrap(),
            (2_000, 500)
        );
        let after_daily = release_ticket_reserve(after_quick, 500, &daily).unwrap();
        assert_eq!(after_daily, 0);
        assert_eq!(
            payout_balances(2_000, 0, 1_000, 500, after_daily).unwrap(),
            (1_000, 1_000)
        );
        assert!(release_ticket_reserve(999, 500, &daily).is_err());
    }

    #[test]
    fn settlement_releases_new_tickets_without_spending_other_reserves() {
        let mut ticket_padding = [0; 32];
        ticket_padding[0] = 1;
        let remaining = release_ticket_reserve(400, 200, &ticket_padding).unwrap();
        assert_eq!(remaining, 200);
        assert_eq!(
            payout_balances(900, 100, 200, 500, remaining).unwrap(),
            (700, 300)
        );
        assert_eq!(
            payout_balances(900, 100, 0, 500, remaining).unwrap(),
            (900, 100)
        );
        assert!(payout_balances(899, 100, 200, 500, remaining).is_err());
        assert!(release_ticket_reserve(199, 200, &ticket_padding).is_err());
    }

    #[test]
    fn legacy_tickets_do_not_release_reserves_and_cannot_spend_them() {
        assert_eq!(release_ticket_reserve(200, 200, &[0; 32]).unwrap(), 200);
        assert!(payout_balances(700, 100, 200, 500, 200).is_err());
        assert_eq!(
            payout_balances(900, 100, 200, 500, 200).unwrap(),
            (700, 300)
        );
    }

    #[test]
    fn corrupted_reserve_data_is_rejected() {
        let mut vault_padding = [0; 32];
        vault_padding[..8].copy_from_slice(&123_u64.to_le_bytes());
        assert_eq!(reserved_liability(&vault_padding).unwrap(), 123);
        vault_padding[8] = 1;
        assert!(reserved_liability(&vault_padding).is_err());
        let mut ticket_padding = [0; 32];
        ticket_padding[0] = 2;
        assert!(release_ticket_reserve(100, 100, &ticket_padding).is_err());
        ticket_padding[0] = 3;
        assert!(ticket_prize(&ticket_padding, 100).is_err());
        ticket_padding[0] = 0;
        ticket_padding[1] = 1;
        assert!(release_ticket_reserve(100, 100, &ticket_padding).is_err());
        let mut snapshot = prize_snapshot(100).unwrap();
        snapshot[9] = 1;
        assert!(ticket_prize(&snapshot, 100).is_err());
    }

    fn referral_profile(owner: Pubkey) -> ReferralProfile {
        ReferralProfile {
            version: REFERRAL_VERSION,
            bump: 255,
            owner,
            referrer: Pubkey::default(),
            sharing_enabled: true,
            benefits_enabled: false,
            binding_locked: false,
            qualified: false,
            first_ticket: Pubkey::default(),
            registered_count: 0,
            qualified_count: 0,
        }
    }

    #[test]
    fn referral_bindings_allow_edits_before_purchase_and_preserve_locked_history() {
        let owner = Pubkey::new_unique();
        let inviter = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let mut profile = referral_profile(owner);
        assert!(validate_referral_binding(&profile, inviter).is_ok());
        assert!(validate_referral_binding(&profile, Pubkey::default()).is_ok());
        assert!(validate_referral_binding(&profile, owner).is_err());
        profile.referrer = inviter;
        profile.binding_locked = true;
        profile.first_ticket = Pubkey::new_unique();
        assert!(validate_referral_binding(&profile, inviter).is_ok());
        assert!(validate_referral_binding(&profile, other).is_err());
        assert!(validate_referral_binding(&profile, Pubkey::default()).is_err());
        profile.sharing_enabled = false;
        profile.benefits_enabled = false;
        assert!(validate_referral_binding(&profile, inviter).is_ok());
    }

    #[test]
    fn referral_pricing_requires_an_active_bound_benefit_and_never_changes_prizes() {
        let mut profile = referral_profile(Pubkey::new_unique());
        let quick = DAILY_OFFSET_SECONDS + 1;
        let daily = DAILY_OFFSET_SECONDS;
        assert_eq!(referral_ticket_cost(quick, 7_200_000, &profile).unwrap(), 7_200_000);
        assert_eq!(referral_ticket_cost(daily, 7_200_000, &profile).unwrap(), 6_250_000);
        profile.referrer = Pubkey::new_unique();
        assert_eq!(referral_ticket_cost(quick, 7_200_000, &profile).unwrap(), 7_200_000);
        profile.benefits_enabled = true;
        assert_eq!(referral_ticket_cost(quick, 7_200_000, &profile).unwrap(), 7_100_000);
        assert_eq!(referral_ticket_cost(daily, 7_200_000, &profile).unwrap(), 6_200_000);
        profile.sharing_enabled = false;
        assert_eq!(referral_ticket_cost(quick, 7_200_000, &profile).unwrap(), 7_100_000);
        assert_eq!(draw_prize(daily, 1_000_000_000).unwrap(), 2_000_000_000);
        assert_eq!(draw_prize(quick, 1_000_000_000).unwrap(), 1_000_000_000);
        assert!(reserve_for_purchase(1_000_000_500, 7_100_000, 1_000_000_000, 500, 1_000_000_000).is_err());
        assert!(referral_rules(7_100_000).is_err());
        assert!(referral_rules(7_000_000).is_err());
    }

    #[test]
    fn referral_metadata_and_serialized_sizes_are_explicit() {
        let rules = referral_rules(7_200_000).unwrap();
        assert_eq!(rules.revision, 5);
        assert_eq!(rules.campaign_version, 1);
        assert_eq!(rules.normal_quick_ticket_cost_lamports, 7_200_000);
        assert_eq!(rules.normal_daily_ticket_cost_lamports, 6_250_000);
        assert_eq!(rules.referred_quick_ticket_cost_lamports, 7_100_000);
        assert_eq!(rules.referred_daily_ticket_cost_lamports, 6_200_000);
        assert_eq!(rules.try_to_vec().unwrap().len(), 34);
        assert_eq!(uat_rules(7_200_000, 1_000_000_000).unwrap().try_to_vec().unwrap().len(), 56);
        assert_eq!(referral_profile(Pubkey::new_unique()).try_to_vec().unwrap().len() + 8, ReferralProfile::SPACE);
        assert_eq!(ReferralProfile::SPACE, 126);
    }

    #[test]
    fn referral_qualification_requires_the_immutable_first_paid_settled_ticket() {
        let owner = Pubkey::new_unique();
        let address = Pubkey::new_unique();
        let mut profile = referral_profile(owner);
        let mut ticket = Ticket {
            user: owner,
            nonce: 1,
            draw_time: 100,
            paid_lamports: 7_100_000,
            settled: true,
            bump: 255,
            numbers: [22, 2],
            padding: prize_snapshot(1_000_000_000).unwrap(),
        };
        assert!(validate_referral_qualification(&profile, &ticket, address).is_err());
        profile.binding_locked = true;
        profile.first_ticket = address;
        assert!(validate_referral_qualification(&profile, &ticket, address).is_ok());
        ticket.numbers = [2, 22];
        assert!(validate_referral_qualification(&profile, &ticket, address).is_ok());
        assert!(validate_referral_qualification(&profile, &ticket, Pubkey::new_unique()).is_err());
        ticket.settled = false;
        assert!(validate_referral_qualification(&profile, &ticket, address).is_err());
        ticket.settled = true;
        ticket.paid_lamports = 0;
        assert!(validate_referral_qualification(&profile, &ticket, address).is_err());
        ticket.paid_lamports = 7_100_000;
        ticket.user = Pubkey::new_unique();
        assert!(validate_referral_qualification(&profile, &ticket, address).is_err());
        ticket.user = owner;
        profile.qualified = true;
        assert!(validate_referral_qualification(&profile, &ticket, address).is_ok());
    }

    #[test]
    fn referral_counts_do_not_wrap_and_corrupt_profile_states_are_rejected() {
        assert_eq!(increment_referral_count(0).unwrap(), 1);
        assert_eq!(increment_referral_count(41).unwrap(), 42);
        assert!(increment_referral_count(u64::MAX).is_err());
        let mut profile = referral_profile(Pubkey::new_unique());
        profile.qualified = true;
        assert!(validate_referral_profile(&profile).is_err());
        profile.qualified = false;
        profile.benefits_enabled = true;
        assert!(validate_referral_profile(&profile).is_err());
        profile.benefits_enabled = false;
        profile.qualified_count = 1;
        assert!(validate_referral_profile(&profile).is_err());
        profile.qualified_count = 0;
        profile.binding_locked = true;
        assert!(validate_referral_profile(&profile).is_err());
        profile.first_ticket = Pubkey::new_unique();
        assert!(validate_referral_profile(&profile).is_ok());
        profile.version = 2;
        assert!(validate_referral_profile(&profile).is_err());
    }
}
