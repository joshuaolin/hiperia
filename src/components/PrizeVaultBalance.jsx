import { formatSol } from "./donation.js";

function amount(value) {
  if (value == null) return "Unavailable";
  try {
    return `${formatSol(BigInt(value.toString()))} SOL`;
  } catch {
    return "Unavailable";
  }
}

export default function PrizeVaultBalance({ capacity, bankroll = false }) {
  if (!capacity) return null;
  return (
    <div className="prize-vault-balance">
      <dl aria-label="On-chain prize vault balances">
        <div>
          <dt>Vault balance</dt>
          <dd>{amount(capacity.vaultLamports)}</dd>
        </div>
        <div>
          <dt>{bankroll ? "Protected prizes and entry refunds" : "Reserved for tickets"}</dt>
          <dd>{amount(capacity.reservedLamports)}</dd>
        </div>
        <div>
          <dt>{bankroll ? "Treasury available for new claims" : "Available backing"}</dt>
          <dd>{amount(capacity.freeLamports)}</dd>
        </div>
      </dl>
      <p className="draw-rules">
        {bankroll
          ? "Protected funds cover older accepted prizes and refundable new entry payments. New purchases add their entry without deducting a prize from the treasury. Winning payouts leave only on a confirmed claim, once per ticket. Vault balance includes account rent."
          : "Reserved prizes stay in this vault. Winning payouts leave only when claimed, once per ticket. Vault balance includes account rent."}
      </p>
    </div>
  );
}
