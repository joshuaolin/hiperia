use anchor_lang::prelude::*;

pub const MAX_TICKETS_PER_USER: u64 = 10;
pub const MAX_TOTAL_TICKETS: u64 = 1000;
pub const TICKET_PRICE: u64 = 1_000_000_000; // 1 SOL
pub const DRAW_TICKET_THRESHOLD: u64 = 10;