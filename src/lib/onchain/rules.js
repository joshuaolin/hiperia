export const MIN_NUMBER = 2;
export const MAX_NUMBER = 22;
export const PICK_COUNT = 2;
export const QUICK_PAYOUT_MULTIPLIER = 1;
export const DAILY_PAYOUT_MULTIPLIER = 2;
export const DAILY_DRAW_HOURS = Object.freeze([2, 6, 10, 14, 18, 22]);
export const FIXED_UAT_NUMBERS = Object.freeze([2, 22]);
export const NUMBER_OPTIONS = Object.freeze(
  Array.from(
    { length: MAX_NUMBER - MIN_NUMBER + 1 },
    (_, index) => MIN_NUMBER + index,
  ),
);
export const ORDERED_PAIR_COUNT =
  NUMBER_OPTIONS.length * (NUMBER_OPTIONS.length - 1);

export function createQuickPick(random = Math.random) {
  const index = (length) => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new RangeError(
        "Quick-pick samples must be between zero and one, excluding one.",
      );
    return Math.floor(value * length);
  };
  const first = index(NUMBER_OPTIONS.length);
  let second = index(NUMBER_OPTIONS.length - 1);
  if (second >= first) second += 1;
  return [NUMBER_OPTIONS[first], NUMBER_OPTIONS[second]];
}
