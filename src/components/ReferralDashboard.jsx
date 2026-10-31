import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { explorerAccountUrl } from "../lib/explorer.js";
import "../styles/referrals.css";

function addressString(value) {
  if (!value) return null;
  return typeof value === "string" ? value : (value.toBase58?.() ?? null);
}

function sol(value) {
  if (value == null) return "Awaiting contract";
  const amount = Number(value.toString()) / 1e9;
  return Number.isFinite(amount) ? `${amount} SOL` : "Awaiting contract";
}

function proposedReferrer() {
  return new URLSearchParams(window.location.search).get("ref") ?? "";
}

export default function ReferralDashboard({ game }) {
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? null;
  const referral = game.referral;
  const profile = referral?.profile;
  const rules = referral?.rules;
  const owner = addressString(profile?.owner);
  const referrer = addressString(profile?.referrer);
  const shareCode = profile?.sharingEnabled ? owner : null;
  const [draft, setDraft] = useState(proposedReferrer);
  const [copyStatus, setCopyStatus] = useState("");
  const [inputError, setInputError] = useState("");
  const ready = Boolean(referral?.available && referral?.loaded && rules);
  const canSign =
    ready &&
    !referral?.error &&
    game.connected &&
    game.canSign &&
    game.networkAllowed &&
    game.authorized &&
    !game.pending;
  const profileUrl = explorerAccountUrl(profile?.address, game.network);
  const bindingLocked = Boolean(profile?.bindingLocked);
  const hasProposal = Boolean(proposedReferrer());
  const referralLink = shareCode
    ? `${window.location.origin}/?ref=${encodeURIComponent(shareCode)}#referrals`
    : null;

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied.`);
    } catch {
      setCopyStatus("Copy unavailable. Select the address to copy it.");
    }
  }

  function bind(event) {
    event.preventDefault();
    try {
      const address = new PublicKey(draft.trim()).toBase58();
      if (address === walletAddress)
        throw new Error("Use another wallet's referral code.");
      setInputError("");
      game.bindReferrer(address);
    } catch (error) {
      setInputError(
        error.message === "Use another wallet's referral code."
          ? error.message
          : "Enter a valid Solana wallet address as the referral code.",
      );
    }
  }

  return (
    <section
      id="referrals"
      className="panel referral-panel"
      aria-labelledby="referrals-title"
    >
      <div className="panel-heading">
        <h2 id="referrals-title">Wallet referrals</h2>
        <span className="onchain-tag">On-chain</span>
      </div>
      <p className="referral-intro">
        Share your wallet code. A referral counts as qualified after its first
        eligible paid ticket is completed and verified on-chain.
      </p>
      {ready && referral?.error && (
        <p className="referral-status" role="status">
          {referral.error}
        </p>
      )}

      {!game.connected ? (
        <div className="empty-state">
          <strong>Your referral profile lives on Solana</strong>
          Connect a wallet to view your code and counts. Opening a referral link
          never joins automatically.
        </div>
      ) : !ready ? (
        <div className="referral-status" role="status">
          {referral?.loading || !referral?.loaded
            ? "Loading the on-chain referral rules and profile…"
            : referral?.error
              ? referral.error
              : "Referrals are awaiting the on-chain campaign update. Existing tickets and prizes are unchanged."}
        </div>
      ) : (
        <>
          <div className="referral-code-block">
            <span className="field-label">Your referral code</span>
            <code>{shareCode ?? "Not enabled"}</code>
            <div className="referral-actions">
              {shareCode ? (
                <>
                  <button
                    className="button button-secondary"
                    onClick={() => copy(shareCode, "Referral code")}
                  >
                    Copy code
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => copy(referralLink, "Referral link")}
                  >
                    Copy link
                  </button>
                  <button
                    className="button button-ghost"
                    disabled={!canSign}
                    onClick={game.disableReferralSharing}
                  >
                    Turn sharing off
                  </button>
                </>
              ) : (
                <button
                  className="button button-secondary"
                  disabled={!canSign}
                  onClick={game.enableReferralSharing}
                >
                  Enable my code
                </button>
              )}
            </div>
          </div>

          <dl className="referral-counts">
            <div>
              <dt>Joined &amp; played</dt>
              <dd>{profile?.registeredCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Qualified players</dt>
              <dd>{profile?.qualifiedCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Your inviter</dt>
              <dd>{profile ? (referrer ? "1" : "0") : "—"}</dd>
            </div>
          </dl>
          {!profile && (
            <p className="referral-note">
              Enable your code or accept an inviter to create your on-chain
              profile. Counts are unavailable until it exists.
            </p>
          )}

          <div className="referral-attribution">
            <span className="field-label">Referred by</span>
            <code>{referrer ?? "No inviter recorded"}</code>
            <p className="referral-note">
              {bindingLocked
                ? "Your first campaign ticket has locked this attribution. You can turn your future discounts off or restore them; the recorded inviter and history stay unchanged."
                : "Review a code before approving. Your first campaign ticket locks your inviter, so choose before buying."}
            </p>
          </div>

          {!bindingLocked && (
            <form className="referral-form" onSubmit={bind}>
              <label className="field-label" htmlFor="referral-code-input">
                {referrer
                  ? "Change inviter before your first ticket"
                  : "Use a referral code"}
              </label>
              <input
                id="referral-code-input"
                value={draft}
                placeholder="Inviter's Solana wallet address"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={!canSign}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setInputError("");
                }}
                aria-invalid={Boolean(inputError)}
                aria-describedby={
                  inputError ? "referral-input-error" : "referral-proposal-note"
                }
              />
              <button
                className="button button-primary"
                type="submit"
                disabled={
                  !canSign || !draft.trim() || draft.trim() === referrer
                }
              >
                Review in wallet &amp; accept
              </button>
              {inputError && (
                <p
                  id="referral-input-error"
                  className="referral-error"
                  role="alert"
                >
                  {inputError}
                </p>
              )}
              <p id="referral-proposal-note" className="referral-note">
                {hasProposal
                  ? "The link suggested this code. Nothing is recorded until you approve the transaction."
                  : "Accepting records your inviter on-chain. Your wallet asks for approval; network fees and profile account rent may apply."}
              </p>
            </form>
          )}

          <div className="referral-benefits">
            <span className="field-label">Referral entry prices</span>
            <p>
              Daily {sol(rules?.referredDailyTicketCostLamports)}{" "}
              <span>
                instead of {sol(rules?.normalDailyTicketCostLamports)}
              </span>
            </p>
            <p>
              Quick {sol(rules?.referredQuickTicketCostLamports)}{" "}
              <span>
                instead of {sol(rules?.normalQuickTicketCostLamports)}
              </span>
            </p>
            <p className="referral-note">
              {referrer && profile?.benefitsEnabled
                ? "Your referral benefits are enabled. The purchase total shows your verified entry price."
                : "Accept an eligible inviter and enable benefits to receive the referral entry price."}{" "}
              Prizes stay the same; network fees and account rent are separate.
            </p>
            {referrer && (
              <button
                className="button button-secondary"
                disabled={!canSign}
                onClick={
                  profile?.benefitsEnabled
                    ? game.removeReferralBenefits
                    : game.restoreReferralBenefits
                }
              >
                {profile?.benefitsEnabled
                  ? "Remove my referral benefits"
                  : "Restore my referral benefits"}
              </button>
            )}
          </div>

          {profile?.canQualify && (
            <div className="referral-qualification">
              <p className="referral-note">
                Your first eligible ticket is complete. Verify it to update your
                inviter&apos;s qualified player count.
              </p>
              <button
                className="button button-secondary"
                disabled={!canSign}
                onClick={game.qualifyReferral}
              >
                Verify completed referral
              </button>
            </div>
          )}
          <p className="referral-note">
            Turning sharing off stops new joins. Removing benefits stops your
            future discount; neither action erases on-chain history or past
            contributions. Wallet approvals and network fees apply. No cash
            reward or airdrop is promised.
          </p>
          {profileUrl && (
            <a
              className="history-link"
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Referral profile on Solana ↗
            </a>
          )}
        </>
      )}
      {copyStatus && (
        <p className="referral-note" role="status">
          {copyStatus}
        </p>
      )}
    </section>
  );
}
