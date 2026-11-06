const amounts = [
  "entryLamports",
  "prizeLamports",
  "reserveIncreaseLamports",
  "requiredBackingLamports",
  "freeLamports",
  "accountRentLamports",
  "riskRentLamports",
  "drawRentLamports",
  "ticketRentLamports",
];

export function purchaseQuoteKey(numbers, drawTime) {
  return Number.isSafeInteger(drawTime) &&
    drawTime > 0 &&
    Array.isArray(numbers) &&
    numbers.length === 2 &&
    numbers.every(
      (number) => Number.isInteger(number) && number >= 2 && number <= 22,
    ) &&
    numbers[0] !== numbers[1]
    ? `${drawTime}:${numbers.join(":")}`
    : null;
}

export function matchesPurchaseQuote(quote, numbers, drawTime, config) {
  if (quote?.bankroll === true) {
    if (config?.bankrollRules?.revision !== 1 || config.bankrollRules.ticketVersion !== 4 ||
      config.bankrollRules.prizeReservedAtPurchase !== false || config.bankrollRules.claimRequiresFunding !== true ||
      purchaseQuoteKey(quote.numbers, quote.drawTime) !== purchaseQuoteKey(numbers, drawTime) ||
      !purchaseQuoteKey(numbers, drawTime) || quote.ticketVersion !== 4 ||
      amounts.some((field) => !Number.isSafeInteger(quote[field]) || quote[field] < 0)) return false;
    try {
      return quote.entryLamports === Number((quote.quick ? config.quickTicketCostLamports : config.dailyTicketCostLamports).toString()) &&
        quote.prizeLamports === Number((quote.quick ? config.quickPayoutLamports : config.dailyPayoutLamports).toString()) &&
        quote.reserveIncreaseLamports === quote.entryLamports && quote.requiredBackingLamports === 0 &&
        quote.canPurchase === true && quote.ledgerRentLamports === quote.riskRentLamports &&
        quote.riskRentLamports + quote.drawRentLamports + quote.ticketRentLamports === quote.accountRentLamports;
    } catch { return false; }
  }
  if (
    !quote ||
    quote.pooled !== true ||
    config?.liabilityRules?.dailyPooled !== true ||
    purchaseQuoteKey(quote.numbers, quote.drawTime) !==
      purchaseQuoteKey(numbers, drawTime) ||
    !purchaseQuoteKey(numbers, drawTime) ||
    amounts.some(
      (field) => !Number.isSafeInteger(quote[field]) || quote[field] < 0,
    )
  )
    return false;
  try {
    return (
      BigInt(quote.entryLamports) === BigInt(config.dailyTicketCostLamports) &&
      BigInt(quote.prizeLamports) === BigInt(config.dailyPayoutLamports) &&
      quote.reserveIncreaseLamports - quote.entryLamports ===
        quote.requiredBackingLamports &&
      BigInt(quote.riskRentLamports) +
        BigInt(quote.drawRentLamports) +
        BigInt(quote.ticketRentLamports) ===
        BigInt(quote.accountRentLamports) &&
      quote.canPurchase === quote.freeLamports >= quote.requiredBackingLamports
    );
  } catch {
    return false;
  }
}
