use anchor_lang::prelude::*;
use crate::{PurchaseTracker, Ticket};

pub fn get_next_draw_time(current_time: i64) -> i64 {
    // Set draw time to 1 day from now (adjust for PCSO-style daily/weekly draws)
    current_time + 86_400 // 24 hours in seconds
}

pub fn find_winners_with_limit(
    purchase_tracker: &PurchaseTracker,
    winning_numbers: [u8; 2],
    limit: usize,
) -> Result<Vec<(Pubkey, bool)>> {
    let mut winners = Vec::new();
    for ticket in purchase_tracker.tickets.iter().take(limit) {
        let tn = ticket.numbers;
        let wn = winning_numbers;
        if (tn[0] == wn[0] && tn[1] == wn[1]) || (tn[0] == wn[1] && tn[1] == wn[0]) {
            let is_exact = tn[0] == wn[0] && tn[1] == wn[1];
            winners.push((ticket.owner, is_exact));
        }
    }
    Ok(winners)
}

pub fn select_airdrop_winner_with_random(
    purchase_tracker: &PurchaseTracker,
    aux_random: u64,
) -> Result<Pubkey> {
    if purchase_tracker.tickets.is_empty() {
        return Err(error!(ErrorCode::NoTicketsForAirdrop));
    }
    let index = (aux_random % purchase_tracker.tickets.len() as u64) as usize;
    Ok(purchase_tracker.tickets[index].owner)
}