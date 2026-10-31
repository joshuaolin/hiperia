import "../styles/dodos-guide.css";

function solAmount(value) {
  if (value == null || !Number.isFinite(Number(value)))
    return "Awaiting contract";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 9 }).format(Number(value))} SOL`;
}

export default function DodosGuide({
  quickPriceSol = null,
  dailyPriceSol = null,
  quickPayoutSol = null,
  dailyPayoutSol = null,
  uatReady = false,
  publicPlayEnabled = false,
  randomnessVerified = false,
  publicGame = false,
  rules = null,
  referralRules = null,
  referralDiscount = false,
}) {
  const minimum = rules?.minNumber;
  const maximum = rules?.maxNumber;
  const picks = rules?.pickCount;
  const numberCount =
    Number.isInteger(minimum) && Number.isInteger(maximum)
      ? maximum - minimum + 1
      : null;
  const orderedPairCount =
    numberCount && picks === 2 ? numberCount * (numberCount - 1) : null;
  const dailyHours = Array.isArray(rules?.dailyHours)
    ? rules.dailyHours
        .map((hour) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`)
        .join(" / ")
    : null;
  const intervalHours = rules?.scheduleIntervalSeconds
    ? rules.scheduleIntervalSeconds / 3600
    : null;
  const doubleDailyPrize =
    quickPayoutSol != null &&
    dailyPayoutSol != null &&
    Number(quickPayoutSol) > 0 &&
    Number(dailyPayoutSol) === Number(quickPayoutSol) * 2;
  const refundAfterSeconds = rules?.randomnessRules?.refundAfterSeconds;
  const refundHours =
    Number.isSafeInteger(refundAfterSeconds) && refundAfterSeconds > 0
      ? refundAfterSeconds / 3600
      : null;
  return (
    <section
      id="dodos-guide"
      className="panel dodos-guide"
      aria-labelledby="dodos-guide-title"
    >
      <div className="dodos-guide-heading">
        <p className="eyebrow">Game guide</p>
        <h2 id="dodos-guide-title">How to play Dodos</h2>
        <p>One ordered pair. One chosen draw.</p>
      </div>

      <table className="dodos-guide-facts">
        <caption>Game details</caption>
        <tbody>
          <tr>
            <th scope="row">Numbers</th>
            <td>
              {numberCount && picks ? (
                <>
                  Choose {picks} different numbers,{" "}
                  {String(minimum).padStart(2, "0")}–
                  {String(maximum).padStart(2, "0")}
                </>
              ) : (
                "Awaiting contract"
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">Winning match</th>
            <td>Both numbers in the exact order</td>
          </tr>
          <tr>
            <th scope="row">Quick draw</th>
            <td>
              {solAmount(quickPriceSol)} entry
              <small>{solAmount(quickPayoutSol)} exact-match prize</small>
            </td>
          </tr>
          <tr>
            <th scope="row">Daily draw</th>
            <td>
              {solAmount(dailyPriceSol)} entry
              <small>{solAmount(dailyPayoutSol)} exact-match prize</small>
              <small>
                {doubleDailyPrize
                  ? "Twice the quick draw prize"
                  : "Prize for the selected daily draw"}
              </small>
            </td>
          </tr>
          <tr>
            <th scope="row">Daily draws</th>
            <td>
              {dailyHours ?? "Awaiting contract"}
              <small>
                {intervalHours
                  ? `Every ${intervalHours} hours · UTC+8`
                  : "UTC+8"}
              </small>
            </td>
          </tr>
          <tr>
            <th scope="row">Ticket validity</th>
            <td>
              One selected date and time. Multiple entries are allowed while
              prize reserves are available.
            </td>
          </tr>
        </tbody>
      </table>
      {referralRules && (
        <p className="referral-note">
          Referral entry prices are read from the campaign on-chain: daily{" "}
          {solAmount(
            Number(referralRules.referredDailyTicketCostLamports?.toString()) /
              1e9,
          )}
          , quick{" "}
          {solAmount(
            Number(referralRules.referredQuickTicketCostLamports?.toString()) /
              1e9,
          )}
          .{" "}
          {referralDiscount
            ? "Your referral price is included above."
            : "Accept an inviter before your first campaign ticket to enable the referral price."}{" "}
          Removing benefits restores the normal entry price. Prizes are
          unchanged.
        </p>
      )}

      <ol className="dodos-guide-steps">
        <li>
          <span aria-hidden="true">01</span>
          <div>
            <h3>Pick your pair in order</h3>
            <p>
              Your first and second picks must both match the recorded result in
              the same order. Reversing the picks changes your selection.
            </p>
          </div>
        </li>
        <li>
          <span aria-hidden="true">02</span>
          <div>
            <h3>Choose a draw and buy</h3>
            <p>
              Select the exact date and time, or choose Quick draw for a test in
              about one minute. Review its entry price and prize, then approve
              before it starts. A 2 PM ticket cannot be reused for the 6 PM
              draw.
            </p>
          </div>
        </li>
        <li>
          <span aria-hidden="true">03</span>
          <div>
            <h3>
              {randomnessVerified
                ? "Reveal and complete the draw"
                : "Read the recorded result"}
            </h3>
            <p>
              {randomnessVerified ? (
                <>
                  After the draw starts, use{" "}
                  <strong>Review reveal costs</strong>, then{" "}
                  <strong>Reveal result</strong> to approve an oracle request.
                  The oracle supplies randomness. If it is ready, approve
                  <strong> Complete draw</strong> to record the numbers;
                  otherwise use Refresh and complete it later. The same
                  completion approval may also release losing tickets' reserved
                  funds. No wallet action starts automatically.
                </>
              ) : (
                <>
                  Recorded numbers appear on your tickets and in Draw results.
                  Use <strong>Refresh</strong> to read the latest on-chain
                  records for free. If a due draw has no record yet, use{" "}
                  <strong>Record draw result</strong> to save the contract’s
                  result.
                </>
              )}
            </p>
          </div>
        </li>
        <li>
          <span aria-hidden="true">04</span>
          <div>
            <h3>Find and claim your wins</h3>
            <p>
              Open <strong>Win</strong> in Your tickets, then use{" "}
              <strong>Claim prize</strong> or <strong>Claim all</strong> to
              receive your prizes. Large claims may need more than one wallet
              approval. Losing tickets appear in <strong>Done</strong>; no
              manual close is needed.
            </p>
          </div>
        </li>
      </ol>

      <details className="dodos-guide-details">
        <summary>Prizes, fees and blockchain history</summary>
        <div>
          <p>
            Each ticket keeps its purchase-time prize, shown in Your tickets.
            Older tickets may have a different prize.
          </p>
          <p>
            Each entry reserves its full prize. Daily and quick tickets use
            different prize amounts, so the same vault can back different
            numbers of entries. Settling losing tickets releases their reserved
            funds. A winning prize stays reserved until it is paid to its ticket
            owner.
            {randomnessVerified &&
              " Completing a draw can release a batch of losing reserves in the same approval. The operator can process remaining losses separately. A ticket appearing in Done does not by itself release its reserve."}
          </p>
          <p>
            Every purchase also pays a network fee and ticket account rent.
            Those costs are separate from the entry price.
            {randomnessVerified
              ? " The first entry in a draw also pays rent for its shared draw account. Revealing a draw pays the current oracle fee and request account rent from the requesting wallet. The cost review reads these amounts from Devnet before you approve. Completing the draw can need a second approval and network fee."
              : " A quick draw has its own result account, so recording each quick result also costs account rent."}
          </p>
          <p>
            {randomnessVerified
              ? "Both draw types use the same ordered-pair pool:"
              : "With a fair, unpredictable random result, both draw types would have"}{" "}
            {orderedPairCount
              ? `1 in ${orderedPairCount}`
              : "the contract's ordered-pair"}{" "}
            odds. The larger daily prize does not improve those odds or
            guarantee a win or profit.
            {!randomnessVerified && !publicGame &&
              " UAT uses a fixed test result, so those random-draw odds do not apply during testing."}
            {!randomnessVerified && publicGame &&
              " Wait for verified on-chain randomness rules before entering a draw."}
          </p>
          <p>
            {randomnessVerified
              ? "The contract accepts randomness from its configured ORAO program. It derives the ordered pair from the fulfilled request; the requesting wallet cannot select the result. The result links to that oracle account in blockchain history."
              : "Recording a result costs a network fee and result account rent, once per draw. The contract supplies the numbers; your wallet cannot choose the result."}
          </p>
          {randomnessVerified && (
            <p>
              {refundHours
                ? `If oracle fulfillment remains unavailable after the contract's ${refundHours}-hour timeout, an eligible ticket offers Refund entry.`
                : "When the contract's oracle timeout and refund conditions are met, an eligible ticket offers Refund entry."}{" "}
              A refund returns that ticket&apos;s actual entry payment; network
              fees and account rent are separate. A fulfilled or finalized draw
              cannot be refunded through this timeout path.
            </p>
          )}
          <p>
            Claiming a prize costs a network fee. Viewing results and opening
            ticket or draw history is free.
          </p>
          <p>
            History links open the matching accounts in Solana Explorer on the
            connected test network, where you can inspect their transactions.
          </p>
        </div>
      </details>

      <div className="dodos-guide-test">
        {uatReady ? (
          <>
            <h3>{randomnessVerified ? "Public Devnet" : "UAT test mode"}</h3>
            <p>
              {randomnessVerified
                ? "New draws use verified ORAO randomness. Legacy tickets keep their original program, recorded result and accepted prize. The result table contains published blockchain records and links to the relevant oracle request."
                : "Results are fixed, not random. Older records keep their original result; the result table shows only records read from the blockchain."}
            </p>
            <p>
              For a faster test, choose <strong>Quick draw</strong>. It starts
              about 60 seconds after you press Buy and pays{" "}
              {solAmount(quickPayoutSol)} for an exact match. Scheduled daily
              draws pay {solAmount(dailyPayoutSol)} for an exact match. Approve
              before your selected draw starts.
            </p>
            <p>
              Accepted winning prizes have no claim deadline.{" "}
              {publicPlayEnabled
                ? "All signing wallets can play on Devnet"
                : "Approved test wallets only"}
              ; all amounts are test SOL.
            </p>
          </>
        ) : (
          <p>
            The on-chain UAT configuration must be verified before purchases
            unlock. All amounts are test SOL.
          </p>
        )}
      </div>
    </section>
  );
}
