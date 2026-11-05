import test from "node:test";
import assert from "node:assert/strict";
import { matchesPurchaseQuote, purchaseQuoteKey } from "./purchaseQuote.js";

const config = {
  liabilityRules: { dailyPooled: true },
  dailyTicketCostLamports: "6250000",
  dailyPayoutLamports: "2000000000",
};
const drawTime = 1_800_000_000;
const quote = {
  pooled: true,
  numbers: [2, 22],
  drawTime,
  entryLamports: 6_250_000,
  prizeLamports: 2_000_000_000,
  reserveIncreaseLamports: 6_250_000,
  requiredBackingLamports: 0,
  freeLamports: 30_000,
  canPurchase: true,
  riskRentLamports: 23_000_001,
  drawRentLamports: 1_000_002,
  ticketRentLamports: 1_000_003,
  accountRentLamports: 25_000_006,
};

test("daily purchase quotes bind the exact ordered pair and selected draw", () => {
  assert.equal(matchesPurchaseQuote(quote, [2, 22], drawTime, config), true);
  for (const [numbers, time] of [
    [[22, 2], drawTime],
    [[3, 22], drawTime],
    [[2, 22], drawTime + 14_400],
    [[2, 2], drawTime],
    [[1, 22], drawTime],
    [[2], drawTime],
    [[2, 22], NaN],
  ]) {
    assert.equal(matchesPurchaseQuote(quote, numbers, time, config), false);
  }
  assert.notEqual(
    purchaseQuoteKey([2, 22], drawTime),
    purchaseQuoteKey([22, 2], drawTime),
  );
});

test("daily pooled quotes allow a diversified pair without a full new prize reserve", () => {
  assert.ok(quote.freeLamports < quote.prizeLamports);
  assert.equal(matchesPurchaseQuote(quote, [2, 22], drawTime, config), true);
  const limited = {
    ...quote,
    reserveIncreaseLamports: quote.prizeLamports,
    requiredBackingLamports: quote.prizeLamports - quote.entryLamports,
    canPurchase: false,
  };
  assert.equal(matchesPurchaseQuote(limited, [2, 22], drawTime, config), true);
});

test("metadata failures, stale prices and malformed rents never enable daily entry", () => {
  for (const invalidConfig of [
    null,
    { ...config, liabilityRules: null },
    { ...config, dailyTicketCostLamports: "6250001" },
    { ...config, dailyPayoutLamports: "2000000001" },
  ]) {
    assert.equal(
      matchesPurchaseQuote(quote, [2, 22], drawTime, invalidConfig),
      false,
    );
  }
  for (const invalid of [
    { accountRentLamports: quote.accountRentLamports + 1 },
    { ticketRentLamports: -1 },
    { riskRentLamports: NaN },
    { reserveIncreaseLamports: quote.reserveIncreaseLamports + 1 },
    { canPurchase: false },
    { pooled: false },
  ]) {
    assert.equal(
      matchesPurchaseQuote({ ...quote, ...invalid }, [2, 22], drawTime, config),
      false,
    );
  }
});
