const MAX_U64 = (1n << 64n) - 1n;
export const DRAW_RISK_PAIRS = 420;

function unsigned(value) {
  const integer = BigInt(value.toString());
  if (integer < 0n || integer > MAX_U64)
    throw new RangeError("Draw liability exceeds the supported range.");
  return integer;
}

export function orderedPairIndex(numbers) {
  if (
    !Array.isArray(numbers) ||
    numbers.length !== 2 ||
    numbers.some((number) => !Number.isInteger(number) || number < 2 || number > 22) ||
    numbers[0] === numbers[1]
  )
    throw new TypeError("Choose two different numbers from 2 to 22.");
  const first = numbers[0] - 2;
  const second = numbers[1] - 2;
  return first * 20 + second - Number(second > first);
}

export function pooledLiability(counts, entry, prize, winningIndex = null) {
  if (!Array.isArray(counts) || counts.length !== DRAW_RISK_PAIRS)
    throw new Error("The draw's combination counts could not be verified.");
  const cost = unsigned(entry), payout = unsigned(prize);
  if (cost === 0n || payout < cost)
    throw new Error("The draw's price and prize could not be verified.");
  const values = counts.map(unsigned);
  const total = unsigned(values.reduce((sum, value) => sum + value, 0n));
  if (winningIndex !== null) {
    if (!Number.isInteger(winningIndex) || winningIndex < 0 || winningIndex >= DRAW_RISK_PAIRS)
      throw new RangeError("Invalid winning combination index.");
    return { totalCount: total, reservedLamports: unsigned(values[winningIndex] * payout) };
  }
  const largest = values.reduce((maximum, count) => count > maximum ? count : maximum, 0n);
  return { totalCount: total, reservedLamports: unsigned(total * cost + largest * (payout - cost)) };
}

export function pooledEntryQuote(counts, numbers, entry, prize) {
  const index = orderedPairIndex(numbers);
  const before = pooledLiability(counts, entry, prize);
  const next = [...counts];
  next[index] = unsigned(BigInt(next[index].toString()) + 1n);
  const after = pooledLiability(next, entry, prize);
  return {
    index,
    reserveIncreaseLamports: after.reservedLamports - before.reservedLamports,
    requiredBackingLamports: after.reservedLamports - before.reservedLamports - unsigned(entry),
    reservedBeforeLamports: before.reservedLamports,
    reservedAfterLamports: after.reservedLamports,
    totalCount: before.totalCount,
  };
}
