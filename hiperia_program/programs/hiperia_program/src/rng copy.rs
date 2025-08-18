// switchboard_v2 = "0.2"

use switchboard_v2::VrfAccountData;
pub fn generate_random_digits(
    lottery_state_key: &Pubkey,
    clock: &Clock,
    ticket_count: u64,
    vrf: &Account<VrfAccountData>,
) -> Result<RngResult> {
    let random = vrf.result;
    let digit1 = (random[0] % 31) + 1;
    let mut digit2 = (random[1] % 31) + 1;
    if digit2 == digit1 { digit2 = ((digit2 + 1) % 31) + 1; }
    let airdrop_index = (u64::from_le_bytes(random[2..10].try_into().unwrap()) % ticket_count) as usize;
    Ok(RngResult {
        digits: [digit1, digit2],
        airdrop_winner: None, // Set in lib.rs using airdrop_index
    })
}