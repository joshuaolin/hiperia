import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { createDodosClient } from "../../lib/onchain/PublicDodosClient.js";
import {
  getNextDrawTime,
  getUpcomingDrawTimes,
  formatDrawTime,
  getSelectedDrawTime,
  isDailyDrawTime,
} from "../../lib/onchain/time.js";
import useNetworkStatus from "../../components/useNetworkStatus.js";
import { runDodosTransaction } from "./transaction.js";
import { dodosErrorMessage } from "./errors.js";
import {
  RefreshGate,
  RefreshCooldownError,
  isRateLimitError,
} from "../../lib/refreshGate.js";
import {
  MIN_NUMBER,
  MAX_NUMBER,
  PICK_COUNT,
  createQuickPick,
} from "../../lib/onchain/rules.js";
import {
  assertReviewedOracleQuote,
  gameSources,
  loadGameSnapshot,
} from "./gameSnapshot.js";
import {
  executeRevealDraws,
  getRevealDraws,
  revealDrawKey,
  reviewedQuoteFor,
} from "./revealDraws.js";
import { matchesPurchaseQuote, purchaseQuoteKey } from "./purchaseQuote.js";

export function useDodosGame() {
  const { connection } = useConnection();
  const networkStatus = useNetworkStatus();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { client, refreshGate, referralRefreshGate } = useMemo(
    () => ({
      client: createDodosClient({
        connection,
        wallet: { publicKey, signTransaction, signAllTransactions },
      }),
      refreshGate: new RefreshGate(),
      referralRefreshGate: new RefreshGate(),
    }),
    [connection, publicKey, signTransaction, signAllTransactions],
  );
  const [data, setData] = useState({
    source: null,
    config: null,
    configVerified: false,
    historyLoaded: false,
    tickets: [],
    results: [],
    referral: null,
  });
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [drawChoice, setDrawChoice] = useState(() => String(getNextDrawTime()));
  const [quickDrawTime, setQuickDrawTime] = useState(() => getSelectedDrawTime("quick"));
  const [now, setNow] = useState(Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState(null);
  const [refreshUntil, setRefreshUntil] = useState(0);
  const [oracleQuotes, setOracleQuotes] = useState({});
  const [purchaseQuoteState, setPurchaseQuoteState] = useState(null);
  const [purchaseQuoteAttempt, setPurchaseQuoteAttempt] = useState(0);
  const [purchaseQuoteRetryAt, setPurchaseQuoteRetryAt] = useState(0);
  const loadedData = useRef(null);
  const refreshRetryTimer = useRef(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const refreshId = useRef(0);
  const activeClient = useRef(client);
  const canSign = Boolean(publicKey && signTransaction && signAllTransactions);
  const config = data.source === client ? data.config : null;
  const uatReady = Boolean(config?.uatEnabled && data.configVerified);
  const walletAddress = publicKey?.toBase58();
  const programIds = gameSources(client).map((source) =>
    source.client.program.programId.toBase58(),
  );
  const dataKey = `${connection.rpcEndpoint}:${walletAddress ?? "readonly"}:${programIds.join(":")}`;
  const authorized = Boolean(
    uatReady &&
      walletAddress &&
      (config.publicPlayEnabled ||
        [config.uatTester, config.uatAdmin].includes(walletAddress)),
  );
  const quickDraw = drawChoice === "quick";
  const drawExpired =
    (quickDraw ? quickDrawTime : Number(drawChoice)) <= Math.floor(now / 1000);
  const dailyDraws = getUpcomingDrawTimes(now);
  if (!quickDraw && !dailyDraws.includes(Number(drawChoice)))
    dailyDraws.unshift(Number(drawChoice));
  const purchaseQuoteRequired = Boolean(client.primary);
  const selectedDrawTime = quickDraw ? quickDrawTime : Number(drawChoice);
  const selectedQuoteKey = purchaseQuoteKey(selectedNumbers, selectedDrawTime);
  const canQuotePurchase = Boolean(
    purchaseQuoteRequired &&
      config?.bankrollRules?.ticketVersion === 4 &&
      uatReady &&
      authorized &&
      canSign &&
      networkStatus.network?.allowed &&
      !drawExpired &&
      !isLoading &&
      !pending &&
      selectedQuoteKey &&
      typeof client.getPurchaseQuote === "function",
  );
  const quoteContextMatches = Boolean(
    purchaseQuoteState?.source === client &&
      purchaseQuoteState?.config === config &&
      purchaseQuoteState?.walletKey === dataKey &&
      purchaseQuoteState?.key === selectedQuoteKey,
  );
  const purchaseQuote =
    canQuotePurchase &&
    quoteContextMatches &&
    matchesPurchaseQuote(
      purchaseQuoteState.quote,
      selectedNumbers,
      selectedDrawTime,
      config,
    )
      ? purchaseQuoteState.quote
      : null;

  useEffect(() => {
    if (!canQuotePurchase) return;
    let active = true;
    const context = {
      source: client,
      config,
      walletKey: dataKey,
      key: selectedQuoteKey,
    };
    setPurchaseQuoteState({
      ...context,
      loading: true,
      quote: null,
      error: "",
    });
    const timer = setTimeout(async () => {
      setPurchaseQuoteRetryAt(Date.now() + 8000);
      try {
        const quote = await client.getPurchaseQuote(selectedNumbers, {
          drawTime: selectedDrawTime,
          config,
        });
        if (
          !matchesPurchaseQuote(
            quote,
            selectedNumbers,
            selectedDrawTime,
            config,
          )
        )
          throw new Error(
            "The current entry and account rent quote could not be verified.",
          );
        if (active && activeClient.current === client)
          setPurchaseQuoteState({
            ...context,
            loading: false,
            quote,
            error: "",
          });
      } catch {
        if (active && activeClient.current === client)
          setPurchaseQuoteState({
            ...context,
            loading: false,
            quote: null,
            error:
              "The entry quote is unavailable. Refresh the quote before buying; existing tickets and claims remain available.",
          });
      }
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    canQuotePurchase,
    client,
    config,
    dataKey,
    selectedQuoteKey,
    selectedNumbers,
    selectedDrawTime,
    purchaseQuoteAttempt,
  ]);

  function requireUatWallet() {
    if (!uatReady)
      throw new Error(
        "Wait for the verified on-chain game rules before sending a new entry or randomness request.",
      );
    if (!authorized)
      throw new Error(
        "This game is restricted to an approved test wallet. Connect an approved wallet to continue.",
      );
  }

  function assertActive() {
    if (!mounted.current || activeClient.current !== client)
      throw new Error(
        "The connected wallet changed. Refresh before continuing.",
      );
  }

  function requireTicketWallet() {
    assertActive();
    client.requireSigner();
  }

  const refresh = useCallback(
    async function refreshData({
      manual = false,
      critical = false,
      automaticRetry = false,
    } = {}) {
      const requestId = ++refreshId.current;
      setIsLoading(true);
      try {
        const snapshot = await refreshGate.run(
          () =>
            loadGameSnapshot(client, {
              previous:
                loadedData.current?.key === dataKey
                  ? { ...loadedData.current, source: client }
                  : null,
              loadReferral: (activeConfig, previous) =>
                referralRefreshGate
                  .run(() => client.referrals.load(activeConfig), {
                    freshAfterPending: critical,
                  })
                  .catch((failure) => ({
                    ...previous,
                    loaded: true,
                    error:
                      isRateLimitError(failure) ||
                      (failure instanceof RefreshCooldownError &&
                        failure.rateLimited)
                        ? "Referral data is temporarily rate-limited. Your last loaded data is preserved; try Refresh shortly."
                        : "Referral data is temporarily unavailable. Your last loaded data is preserved; try Refresh again.",
                  })),
            }),
          { manual, freshAfterPending: critical },
        );
        if (
          mounted.current &&
          activeClient.current === client &&
          requestId === refreshId.current
        ) {
          const nextData = {
            ...snapshot,
            key: dataKey,
          };
          loadedData.current = nextData;
          setData(nextData);
          setLoadFailed(false);
          setRefreshFailure(null);
          clearTimeout(refreshRetryTimer.current);
          if (snapshot.recovered) {
            setMessage(
              "Your earlier purchase was recovered from the chain. No second purchase was sent.",
            );
            setSelectedNumbers([]);
          }
          setError(
            snapshot.config
              ? client.getPendingPurchase()
                ? "The earlier purchase is not confirmed yet. Refresh or retry; the same ticket ID will be reused."
                : ""
              : "Dodos is not initialized on this network. Ticket purchases are unavailable.",
          );
        }
      } catch (failure) {
        if (
          mounted.current &&
          activeClient.current === client &&
          requestId === refreshId.current
        ) {
          if (failure.snapshot) {
            const partialData = { ...failure.snapshot, key: dataKey };
            loadedData.current = partialData;
            setData(partialData);
            if (partialData.recovered) {
              setMessage(
                "Your earlier purchase was recovered from the chain. No second purchase was sent.",
              );
              setSelectedNumbers([]);
            }
          }
          const hasData =
            loadedData.current?.key === dataKey &&
            Boolean(
              loadedData.current.config || loadedData.current.historyLoaded,
            );
          const rateLimited =
            isRateLimitError(failure) ||
            (failure instanceof RefreshCooldownError && failure.rateLimited);
          if (!(failure instanceof RefreshCooldownError) || rateLimited) {
            setLoadFailed(!hasData);
            if (!hasData)
              setData({
                source: client,
                config: null,
                configVerified: false,
                historyLoaded: false,
                tickets: [],
                results: [],
                referral: null,
              });
            setError("");
            setRefreshFailure({ rateLimited, hasData });
          }
          if (critical && !automaticRetry && refreshGate.retryAt > Date.now()) {
            clearTimeout(refreshRetryTimer.current);
            refreshRetryTimer.current = setTimeout(
              () => {
                if (mounted.current && activeClient.current === client)
                  refreshData({ automaticRetry: true });
              },
              refreshGate.retryAt - Date.now() + 50,
            );
          }
        }
      } finally {
        if (
          mounted.current &&
          activeClient.current === client &&
          requestId === refreshId.current
        ) {
          setRefreshUntil(refreshGate.nextManualRefreshAt);
          setIsLoading(false);
        }
      }
    },
    [client, dataKey, refreshGate, referralRefreshGate],
  );

  useEffect(() => {
    mounted.current = true;
    activeClient.current = client;
    setMessage("");
    setError("");
    setRefreshFailure(null);
    setRefreshUntil(0);
    setOracleQuotes({});
    if (loadedData.current?.key === dataKey)
      setData({ ...loadedData.current, source: client });
    const pendingPurchase = client.getPendingPurchase();
    if (pendingPurchase) {
      if (!isDailyDrawTime(pendingPurchase.drawTime)) setQuickDrawTime(pendingPurchase.drawTime);
      setSelectedNumbers(pendingPurchase.numbers);
      setDrawChoice(
        isDailyDrawTime(pendingPurchase.drawTime)
          ? String(pendingPurchase.drawTime)
          : "quick",
      );
    }
    refresh();
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      if (!busy.current) refresh();
    };
    const restorePage = (event) => {
      if (event.persisted) resume();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", restorePage);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      activeClient.current = null;
      refreshId.current += 1;
      clearInterval(timer);
      clearTimeout(refreshRetryTimer.current);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", restorePage);
    };
  }, [client, dataKey, refresh]);

  async function runAction(
    action,
    requiresSignature = false,
    { refreshAfter = true } = {},
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const text = requiresSignature
        ? await runDodosTransaction(connection, () => {
            if (activeClient.current !== client)
              throw new Error(
                "The connected wallet changed. Review your transaction and try again.",
              );
            return action();
          })
        : await action();
      if (mounted.current && activeClient.current === client) {
        setMessage(text);
        if (refreshAfter) await refresh({ critical: requiresSignature });
      }
    } catch (failure) {
      if (mounted.current && activeClient.current === client) {
        const actionError = dodosErrorMessage(failure);
        if (requiresSignature || client.getPendingPurchase())
          await refresh({ critical: requiresSignature });
        if (mounted.current && activeClient.current === client)
          setError(actionError);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function select(number) {
    if (
      busy.current ||
      !Number.isInteger(number) ||
      number < MIN_NUMBER ||
      number > MAX_NUMBER
    )
      return;
    setPurchaseQuoteState(null);
    setSelectedNumbers((values) =>
      values.includes(number)
        ? values.filter((value) => value !== number)
        : values.length < PICK_COUNT
          ? [...values, number]
          : values,
    );
  }

  function randomize() {
    if (busy.current) return;
    setPurchaseQuoteState(null);
    setSelectedNumbers(createQuickPick());
  }

  function runReferral(action, message) {
    return runAction(async () => {
      if (
        data.source !== client ||
        !data.referral?.available ||
        data.referral.error
      )
        throw new Error(
          "Wait for the on-chain referral campaign to load before continuing.",
        );
      await action();
      return message;
    }, true);
  }

  async function reviewDrawCosts(ticket) {
    requireUatWallet();
    if (!client.primary || client.clientFor(ticket) !== client.primary)
      throw new Error(
        "This ticket retains its original draw rules and does not use an oracle reveal.",
      );
    const quote = await client.getOracleQuote(ticket.drawTime);
    assertActive();
    const reviewed = {
      ...quote,
      drawTime: ticket.drawTime,
      sourceProgram: ticket.sourceProgram,
      source: client,
    };
    assertReviewedOracleQuote(reviewed, quote, ticket);
    setOracleQuotes((previous) => ({
      ...previous,
      [revealDrawKey(ticket)]: reviewed,
    }));
    return reviewed;
  }

  function forgetDrawQuote(ticket) {
    setOracleQuotes((previous) => {
      const next = { ...previous };
      delete next[revealDrawKey(ticket)];
      return next;
    });
  }

  async function recordTicketDraw(ticket, batchLabel = "") {
    requireTicketWallet();
    const oracleDraw = Boolean(
      client.primary && client.clientFor(ticket) === client.primary,
    );
    if (oracleDraw && ticket.draw?.status === "open") requireUatWallet();
    const result = await client.recordDraw(ticket.drawTime, {
      ticket,
      assertActive,
      onProgress: (progress) => {
        assertActive();
        if (progress.phase === "request") {
          try {
            const reviewed = reviewedQuoteFor(oracleQuotes, ticket);
            assertReviewedOracleQuote(
              reviewed?.source === client ? reviewed : null,
              progress.quote,
              ticket,
            );
          } catch (failure) {
            forgetDrawQuote(ticket);
            throw failure;
          }
          setMessage(
            `${batchLabel}Approve the randomness request. Your wallet funds the reviewed oracle fee and account rent once for this draw, including all its tickets.`,
          );
        } else if (progress.phase === "pending") {
          setMessage(
            `${batchLabel}Randomness was requested on-chain. Waiting for the oracle; no additional request is being sent.`,
          );
        } else if (progress.phase === "finalize") {
          setMessage(
            batchLabel +
              (progress.reclaimSkipped
                ? "Oracle randomness is ready. Approve draw completion to record the result. Request funding will remain available for separate reclamation to its original requester."
                : "Oracle randomness is ready. Approve draw completion to record the result. Any reclaimed request funding goes only to the original requester.") +
              (progress.plannedLosses
                ? ` This approval also processes up to ${progress.plannedLosses} losing ticket${progress.plannedLosses === 1 ? "" : "s"} to release reserved prizes.`
                : ""),
          );
        }
      },
    });
    assertActive();
    if (oracleDraw) forgetDrawQuote(ticket);
    return { ...result, oracleDraw };
  }

  const refreshCooldown = Math.max(0, Math.ceil((refreshUntil - now) / 1000));
  const refreshError = refreshFailure
    ? `${refreshFailure.rateLimited ? "Temporarily rate-limited." : "Dodos is temporarily unavailable."} ${refreshFailure.hasData ? "Showing last loaded data." : "Dodos has not loaded yet."} ${refreshCooldown ? `Try again in ${refreshCooldown}s.` : "You can try Refresh again."}`
    : "";

  return {
    ...(data.source === client
      ? data
      : {
          config: null,
          configVerified: false,
          historyLoaded: false,
          tickets: [],
          results: [],
        }),
    referral:
      data.source === client && data.referral
        ? data.referral
        : {
            available: false,
            loaded: false,
            profile: null,
            rules: null,
            discountEligible: false,
            error: null,
          },
    connected: Boolean(publicKey),
    publicGame: Boolean(client.primary && client.legacy),
    programIds,
    oracleQuotes: Object.fromEntries(
      Object.entries(oracleQuotes).filter(
        ([, quote]) => quote.source === client,
      ),
    ),
    purchaseQuote,
    purchaseQuoteRequired,
    selectedDrawTime,
    purchaseQuoteLoading:
      canQuotePurchase &&
      (!quoteContextMatches || purchaseQuoteState.loading === true),
    purchaseQuoteError:
      canQuotePurchase && quoteContextMatches ? purchaseQuoteState.error : "",
    purchaseQuoteCooldown: Math.max(
      0,
      Math.ceil((purchaseQuoteRetryAt - now) / 1000),
    ),
    refreshPurchaseQuote: () => {
      if (busy.current || Date.now() < purchaseQuoteRetryAt) return;
      if (quickDraw) setQuickDrawTime(getSelectedDrawTime("quick"));
      setPurchaseQuoteState(null);
      setPurchaseQuoteAttempt((attempt) => attempt + 1);
    },
    canSign,
    uatReady,
    authorized,
    network: networkStatus.network,
    networkAllowed: Boolean(networkStatus.network?.allowed),
    networkChecking: networkStatus.isLoading,
    selectedNumbers,
    quickDraw,
    drawChoice,
    dailyDraws,
    drawExpired,
    setDrawChoice: (value) => {
      if (!busy.current) {
        setPurchaseQuoteState(null);
        if (value === "quick") setQuickDrawTime(getSelectedDrawTime("quick"));
        setDrawChoice(value);
      }
    },
    now,
    isLoading: isLoading || data.source !== client,
    loadFailed,
    pending,
    pendingPurchase: client.getPendingPurchase(),
    message,
    error: error || refreshError,
    refreshWarning: Boolean(refreshFailure),
    refreshCooldown,
    refresh: () => refresh({ manual: true }),
    select,
    randomize,
    clearSelection: () => {
      if (!busy.current) {
        setPurchaseQuoteState(null);
        setSelectedNumbers([]);
      }
    },
    purchase: () =>
      runAction(async () => {
        requireUatWallet();
        const drawTime = client.primary ? selectedDrawTime : getSelectedDrawTime(drawChoice);
        if (
          purchaseQuoteRequired &&
          (!purchaseQuote || purchaseQuote.canPurchase !== true)
        )
          throw new Error(
            "Review the entry and account rent quote for this ordered pair and draw before buying.",
          );
        const ticket = await client.buyTicket(selectedNumbers, {
          drawTime,
          config,
          useReferrals: !config.publicPlayEnabled,
          assertActive,
        });
        if (mounted.current) { setSelectedNumbers([]); setQuickDrawTime(getSelectedDrawTime("quick")); }
        return ticket.recovered
          ? "Your earlier purchase was recovered from the chain. No second purchase was sent."
          : `Ticket confirmed for ${formatDrawTime(ticket.drawTime)} UTC+8. It covers only this draw. View its blockchain history below.`;
      }, true),
    reviewReveal: (ticket) =>
      runAction(
        async () => {
          await reviewDrawCosts(ticket);
          return "Reveal costs loaded from Devnet. Review the fee and rent before choosing Reveal result.";
        },
        false,
        { refreshAfter: false },
      ),
    reviewAllReveals: () =>
      runAction(
        async () => {
          const draws = getRevealDraws(
            data.source === client ? data.tickets : [],
            Math.floor(Date.now() / 1000),
          );
          let requests = 0;
          for (const draw of draws) {
            if (draw.status !== "open") continue;
            await reviewDrawCosts(draw.ticket);
            requests += 1;
          }
          return `${draws.length} unique draw${draws.length === 1 ? "" : "s"} checked. ${requests} new reveal${requests === 1 ? "" : "s"} quoted once per draw; shared daily tickets do not add another oracle charge. Review the total before continuing.`;
        },
        false,
        { refreshAfter: false },
      ),
    publishAll: () =>
      runAction(async () => {
        requireTicketWallet();
        const tickets = data.source === client ? data.tickets : [];
        const nowSeconds = Math.floor(Date.now() / 1000);
        const draws = getRevealDraws(tickets, nowSeconds);
        for (const draw of draws) {
          if (draw.status !== "open") continue;
          requireUatWallet();
          const quote = reviewedQuoteFor(oracleQuotes, draw.ticket);
          assertReviewedOracleQuote(
            quote?.source === client ? quote : null,
            quote,
            draw.ticket,
          );
        }
        let batchLabel = "";
        const progress = await executeRevealDraws(tickets, nowSeconds, {
          assertActive,
          onProgress: ({ index, total, draw }) => {
            batchLabel = `Draw ${index + 1} of ${total}, ${formatDrawTime(draw.ticket.drawTime)} UTC+8. `;
            setMessage(`${batchLabel}Checking its recorded oracle state.`);
          },
          recordDraw: (ticket) => recordTicketDraw(ticket, batchLabel),
        });
        const released = progress.results.reduce(
          (total, { result }) => total + (result.releasedLosses ?? 0),
          0,
        );
        return `${progress.completed} draw${progress.completed === 1 ? "" : "s"} completed; ${progress.pending} awaiting the oracle. All tickets in each shared daily draw use its single recorded result.${released ? ` ${released} losing ticket${released === 1 ? "" : "s"} processed; their prize reserves are available again.` : ""} Refresh to check ticket states. No new request is needed for pending draws.`;
      }, true),
    publish: (ticket) =>
      runAction(async () => {
        const result = await recordTicketDraw(ticket);
        if (result.oracleDraw) {
          if (result.pending || result.phase === "pending")
            return "The randomness request is recorded on-chain and is still awaiting oracle fulfillment. Refresh to check its status; no new request is needed.";
          return `The verified oracle result is recorded on-chain. View its numbers and oracle proof in ticket history.${result.releasedLosses ? ` ${result.releasedLosses} losing ticket${result.releasedLosses === 1 ? "" : "s"} processed; their prize reserves are available again.` : ""}${result.cleanupSkipped ? " Remaining losing reserves can be processed by the operator." : ""}${result.refreshWarning ? " Refresh to verify the latest ticket states." : ""}${result.reclaimSkipped ? " Unused request funding remains available for separate reclamation to its original requester." : ""}`;
        }
        return `${result.signature ? "Draw result recorded on-chain." : "This draw result is already recorded on-chain."}${result.settled ? ` ${result.settled} losing ticket${result.settled === 1 ? "" : "s"} processed; their prize reserves are available again.` : ""} The recorded numbers appear on your tickets below.`;
      }, true),
    settle: (ticket) =>
      runAction(async () => {
        requireTicketWallet();
        const result = await client.checkTicket(ticket);
        if (result.status === "pending")
          throw new Error("Record this draw result before claiming a prize.");
        assertActive();
        await client.settleTicket(ticket, { assertActive });
        return result.status === "won"
          ? "Prize paid to your wallet. View the ticket's blockchain history to verify the transfer."
          : "Ticket closed. No prize was paid; its reserved prize capacity is available again.";
      }, true),
    refund: (ticket) =>
      runAction(async () => {
        requireTicketWallet();
        if (typeof client.refundTicket !== "function")
          throw new Error("This ticket retains its original settlement rules.");
        await client.refundTicket(ticket, { assertActive });
        return "This ticket's entry payment was refunded to its recorded wallet owner. Network fees and account rent are separate.";
      }, true),
    claimAll: () =>
      runAction(async () => {
        requireTicketWallet();
        const result = await client.claimAll({
          tickets: data.source === client ? data.tickets : [],
          assertActive,
        });
        return result.settled
          ? `${result.settled} prize${result.settled === 1 ? "" : "s"} claimed. Payouts were sent to your wallet; see ticket history to verify.${result.waiting ? ` ${result.waiting} winning ticket${result.waiting === 1 ? " is" : "s are"} waiting for treasury funding and remain unpaid.` : ""}`
          : result.waiting ? `${result.waiting} winning ticket${result.waiting === 1 ? " is" : "s are"} waiting for treasury funding. Refresh after a refill; their prizes do not expire.`
            : "No unclaimed winning tickets were found among your loaded on-chain entries. Refresh to check for newer results.";
      }, true),
    enableReferralSharing: () =>
      runReferral(
        () => client.referrals.setSharing(true),
        "Referral sharing enabled on-chain. Your wallet address is your referral code.",
      ),
    disableReferralSharing: () =>
      runReferral(
        () => client.referrals.setSharing(false),
        "Referral sharing disabled on-chain. Existing player attribution and earned counts remain recorded.",
      ),
    bindReferrer: (address) =>
      runReferral(
        () => client.referrals.bind(address),
        "Referral code saved on-chain. Your discount applies to eligible new tickets; the referrer becomes permanent on your first paid campaign ticket.",
      ),
    removeReferralBenefits: () =>
      runReferral(
        () => client.referrals.removeBenefits(),
        "Referral discount disabled on-chain. New tickets use the normal price. A locked first referrer remains in campaign history.",
      ),
    restoreReferralBenefits: () =>
      runReferral(
        () => client.referrals.update({ benefitsEnabled: true }),
        "Referral discount restored on-chain for eligible new tickets.",
      ),
    qualifyReferral: () =>
      runReferral(
        () => client.referrals.qualify(),
        "Your first settled campaign ticket is qualified on-chain. The referrer's qualified-player count is up to date.",
      ),
    refreshReferral: () => refresh({ manual: true }),
  };
}
