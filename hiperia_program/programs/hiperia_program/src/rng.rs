use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

pub struct RngResult {
    pub digits: [u8; 2],
    pub airdrop_winner: Option<Pubkey>,
}

pub fn generate_random_digits(
    lottery_state_key: &Pubkey,
    clock: &Clock,
    ticket_count: u64,
) -> Result<RngResult> {
    // Hardcoded pseudo-random generation for devnet
    let mut hasher = Sha256::new();
    hasher.update(lottery_state_key.to_bytes());
    hasher.update(clock.slot.to_le_bytes());
    hasher.update(clock.unix_timestamp.to_le_bytes());
    let hash = hasher.finalize();

    // Generate two unique digits (1-31)
    let digit1 = (hash[0] % 31) + 1;
    let mut digit2 = (hash[1] % 31) + 1;
    if digit2 == digit1 {
        digit2 = ((digit2 + 1) % 31) + 1;
    }

    // Airdrop winner (simplified for devnet, use first ticket)
    let airdrop_winner = None; // Will be set in lib.rs from remaining_accounts[0]

    // For VRF integration (Switchboard/Chainlink):
    // 1. Replace with VrfAccountData (Switchboard) or Chainlink VRF account
    // 2. Fetch random value from VRF result
    // 3. Example for Switchboard:
    //    let vrf_data = ctx.accounts.vrf;
    //    let random = vrf_data.result;
    //    let digit1 = (random[0] % 31) + 1;
    //    let digit2 = (random[1] % 31) + 1;
    // 4. For airdrop winner, use random % ticket_count to select index

    Ok(RngResult {
        digits: [digit1, digit2],
        airdrop_winner,
    })
}