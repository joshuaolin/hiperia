import "../styles/dodos-guide.css";
import {
  MIN_NUMBER,
  MAX_NUMBER,
  ORDERED_PAIR_COUNT,
} from "../lib/onchain/rules.js";

function solAmount(value) {
  if (value == null || !Number.isFinite(Number(value)))
    return "Awaiting contract";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 9 }).format(Number(value))} SOL`;
}

export default function DodosGuide({
  priceSol = null,
  quickPayoutSol = null,
  dailyPayoutSol = null,
  uatReady = false,
}) {
  const doubleDailyPrize =
    quickPayoutSol != null &&
    dailyPayoutSol != null &&
    Number(quickPayoutSol) > 0 &&
    Number(dailyPayoutSol) === Number(quickPayoutSol) * 2;
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
              Choose 2 different numbers, {String(MIN_NUMBER).padStart(2, "0")}–
              {String(MAX_NUMBER).padStart(2, "0")}
            </td>
          </tr>
          <tr>
            <th scope="row">Winning match</th>
            <td>Both numbers in the exact order</td>
          </tr>
          <tr>
            <th scope="row">Ticket price</th>
            <td>
              {solAmount(priceSol)}
              <small>Plus network fee and account rent</small>
            </td>
          </tr>
          <tr>
            <th scope="row">Quick draw prize</th>
            <td>{solAmount(quickPayoutSol)}</td>
          </tr>
          <tr>
            <th scope="row">Daily draw prize</th>
            <td>
              {solAmount(dailyPayoutSol)}
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
              2 PM and 4 PM<small>Philippine time · UTC+8</small>
            </td>
          </tr>
          <tr>
            <th scope="row">Ticket validity</th>
            <td>One selected date and time</td>
          </tr>
        </tbody>
      </table>

      <ol className="dodos-guide-steps">
        <li>
          <span aria-hidden="true">01</span>
          <div>
            <h3>Pick your pair in order</h3>
            <p>
              Your first and second picks must both match.{" "}
              <strong>06 → 07</strong> is different from{" "}
              <strong>07 → 06</strong>.
            </p>
          </div>
        </li>
        <li>
          <span aria-hidden="true">02</span>
          <div>
            <h3>Choose a draw and buy</h3>
            <p>
              Select the exact date and time. Approve before it starts. A 2 PM
              ticket cannot be reused for the 4 PM draw.
            </p>
          </div>
        </li>
        <li>
          <span aria-hidden="true">03</span>
          <div>
            <h3>View the draw result</h3>
            <p>
              <strong>View result</strong> is free. If the due draw has no
              record yet, use <strong>Record draw result</strong> to save the
              contract’s result.
            </p>
          </div>
        </li>
        <li>
          <span aria-hidden="true">04</span>
          <div>
            <h3>Claim a win or close a loss</h3>
            <p>
              <strong>Claim prize</strong> sends a winning payout to your
              wallet. <strong>Close ticket</strong> is optional for a loss; it
              pays no prize and releases reserved prize capacity.
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
            With a fair, unpredictable random result, both draw types would have
            1 in {ORDERED_PAIR_COUNT} odds. The larger daily prize does not
            improve those odds or guarantee a win or profit. UAT uses a fixed
            test result, so those random-draw odds do not apply during testing.
          </p>
          <p>
            Recording a result costs a network fee and result account rent, once
            per draw. The contract supplies the numbers; your wallet cannot
            choose the result.
          </p>
          <p>
            Claiming or closing a ticket costs a network fee. Viewing results
            and opening ticket or draw history is free.
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
            <h3>UAT test mode</h3>
            <p>
              The frontend target is <strong>06 → 07</strong>, but the live
              program still records <strong>06 → 09</strong> until an on-chain
              upgrade. Results are fixed, not random. Older records keep their
              original result.
            </p>
            <p>
              For a faster test, choose <strong>UAT test draw</strong>. It
              starts about 60 seconds after you press Buy and pays{" "}
              {solAmount(quickPayoutSol)} for an exact match. Daily draws at 2
              PM and 4 PM pay {solAmount(dailyPayoutSol)} for an exact match.
              Approve before your selected draw starts.
            </p>
            <p>
              UAT prizes have no claim deadline. Approved test wallets only; all
              amounts are test SOL.
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
