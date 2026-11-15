import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LemonClient } from "../../lib/onchain/LemonClient.js";
import {
  LEMON_PROGRAM_ID,
  validFruitNumbers,
} from "../../lib/onchain/lemonProtocol.js";
import useNetworkStatus from "../../components/useNetworkStatus.js";
import { DEVNET_GENESIS_HASH } from "../../lib/network.js";
import {
  RefreshCooldownError,
  RefreshGate,
  isRateLimitError,
} from "../../lib/refreshGate.js";
import {
  formatDrawTime,
  getNextDrawTime,
  getSelectedDrawTime,
  getUpcomingDrawTimes,
} from "../../lib/onchain/time.js";

const emptyData = (key = null) => ({
  key,
  source: null,
  config: null,
  configVerified: false,
  tickets: [],
  results: [],
  historyLoaded: false,
});

function amount(value) {
  const parsed = Number(value?.toString());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function selectionKey(numbers, drawTime) {
  return validFruitNumbers(numbers) &&
    Number.isSafeInteger(drawTime) &&
    drawTime > 0
    ? `${drawTime}:${numbers.join(":")}`
    : null;
}

function lemonErrorMessage(failure) {
  const seen = new Set();
  for (
    let source = failure;
    source && !seen.has(source);
    source = source.cause
  ) {
    seen.add(source);
    if (
      source?.error?.errorCode?.number === 6028 ||
      source?.error?.errorCode?.code === "ClaimAwaitingFunds" ||
      /ClaimAwaitingFunds|Error Number: 6028\b|custom program error: 0x178c\b/.test(
        source.message ?? "",
      )
    )
      return "Waiting for treasury funding. This winning ticket remains unpaid and can be claimed after the prize vault is topped up. Refresh and explicitly claim again; no replacement claim is sent automatically.";
  }
  if (
    failure?.code === 4001 ||
    /user rejected|user declined|request rejected/i.test(failure?.message ?? "")
  )
    return "Wallet approval was cancelled. Refresh to check any earlier confirmed progress; no transaction is resent automatically.";
  if (isRateLimitError(failure))
    return "The RPC is temporarily rate-limited. Refresh to check the recorded state; no transaction is resent automatically.";
  return failure?.message || "The Lemon action could not be completed.";
}

function ticketId(ticket) {
  return String(ticket?.id ?? ticket?.address ?? ticket?.publicKey ?? "");
}

export function useLemonGame() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const networkStatus = useNetworkStatus();
  const walletAddress = publicKey?.toBase58() ?? null;
  const { client, refreshGate } = useMemo(
    () => ({
      client: new LemonClient({
        connection,
        wallet: { publicKey, signTransaction, signAllTransactions },
      }),
      refreshGate: new RefreshGate(),
    }),
    [connection, publicKey, signTransaction, signAllTransactions],
  );
  const dataKey = `${LEMON_PROGRAM_ID}:${connection.rpcEndpoint}:${walletAddress ?? "readonly"}`;
  const [data, setData] = useState(emptyData);
  const [selectedNumbers, setSelectedNumbers] = useState([null, null, null]);
  const [quickDraw, setQuickDrawState] = useState(false);
  const [dailyDrawTime, setDailyDrawTime] = useState(getNextDrawTime);
  const [quickDrawTime, setQuickDrawTime] = useState(() =>
    getSelectedDrawTime("quick"),
  );
  const [now, setNow] = useState(Date.now);
  const [isLoading, setIsLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [refreshUntil, setRefreshUntil] = useState(0);
  const [purchaseQuoteState, setPurchaseQuoteState] = useState(null);
  const [purchaseQuoteAttempt, setPurchaseQuoteAttempt] = useState(0);
  const [revealQuoteState, setRevealQuoteState] = useState(null);
  const loadedData = useRef(null);
  const activeClient = useRef(null);
  const mounted = useRef(false);
  const busy = useMemo(() => ({ source: client, current: false }), [client]);
  const refreshId = useRef(0);
  const visibleData = data.key === dataKey ? data : emptyData(dataKey);
  const config = visibleData.config;
  const configVerified =
    visibleData.source === client && visibleData.configVerified;
  const networkAllowed =
    networkStatus.network?.genesisHash === DEVNET_GENESIS_HASH;
  const canSign = Boolean(publicKey && signTransaction && signAllTransactions);
  const ready = Boolean(
    configVerified &&
      config?.verified &&
      config?.randomnessVerified &&
      config?.sourceProgram === LEMON_PROGRAM_ID &&
      config?.uatEnabled &&
      config?.publicPlayEnabled,
  );
  const selectedDrawTime = quickDraw ? quickDrawTime : dailyDrawTime;
  const key = selectionKey(selectedNumbers, selectedDrawTime);
  const drawExpired = selectedDrawTime <= Math.floor(now / 1000);
  const canQuote = Boolean(
    ready &&
      canSign &&
      networkAllowed &&
      key &&
      !drawExpired &&
      actionStatus === "idle",
  );
  const quoteContextMatches =
    purchaseQuoteState?.source === client &&
    purchaseQuoteState.config === config &&
    purchaseQuoteState.dataKey === dataKey &&
    purchaseQuoteState.key === key;
  const purchaseQuote =
    canQuote && quoteContextMatches && purchaseQuoteState.validUntil > now
      ? purchaseQuoteState.quote
      : null;
  const revealQuote =
    revealQuoteState?.source === client && revealQuoteState.dataKey === dataKey
      ? revealQuoteState
      : null;

  const refresh = useCallback(
    async ({ manual = false, critical = false } = {}) => {
      const requestId = ++refreshId.current;
      if (mounted.current && activeClient.current === client)
        setIsLoading(true);
      const apply = (snapshot) => {
        const next = { ...snapshot, key: dataKey, source: client };
        loadedData.current = next;
        setData(next);
      };
      try {
        const snapshot = await refreshGate.run(
          async () => {
            const previous =
              loadedData.current?.key === dataKey
                ? loadedData.current
                : emptyData(dataKey);
            const reads = await Promise.allSettled([
              client.getConfig(),
              client.getResults(),
              walletAddress
                ? client.getTickets(previous.config)
                : Promise.resolve([]),
            ]);
            const next = {
              config:
                reads[0].status === "fulfilled"
                  ? reads[0].value
                  : previous.config,
              configVerified:
                reads[0].status === "fulfilled" && Boolean(reads[0].value),
              results:
                reads[1].status === "fulfilled"
                  ? reads[1].value
                  : previous.results,
              tickets:
                reads[2].status === "fulfilled"
                  ? reads[2].value
                  : previous.tickets,
              historyLoaded:
                reads[2].status === "fulfilled" || previous.historyLoaded,
            };
            const failures = reads
              .filter((read) => read.status === "rejected")
              .map((read) => read.reason);
            if (failures.length) {
              const failure = new Error(
                "Some Lemon reads are temporarily unavailable.",
                {
                  cause: failures.find(isRateLimitError) ?? failures[0],
                },
              );
              failure.snapshot = next;
              throw failure;
            }
            return next;
          },
          { manual, freshAfterPending: critical },
        );
        if (
          mounted.current &&
          activeClient.current === client &&
          requestId === refreshId.current
        ) {
          apply(snapshot);
          setRefreshError(
            snapshot.config
              ? ""
              : "Lemon is not initialized on this Devnet deployment. New entries are unavailable.",
          );
        }
        return snapshot;
      } catch (failure) {
        if (
          mounted.current &&
          activeClient.current === client &&
          requestId === refreshId.current
        ) {
          if (failure.snapshot) apply(failure.snapshot);
          if (failure instanceof RefreshCooldownError && !failure.rateLimited) {
            setRefreshError(
              "Wait for the refresh cooldown before trying again. Your last loaded data is preserved.",
            );
          } else {
            setRefreshError(
              `${isRateLimitError(failure) || failure.rateLimited ? "Lemon reads are temporarily rate-limited." : "Some Lemon data is temporarily unavailable."} Your last loaded history is preserved; try Refresh again shortly.`,
            );
          }
        }
        return null;
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
    [client, dataKey, refreshGate, walletAddress],
  );

  useEffect(() => {
    mounted.current = true;
    activeClient.current = client;
    setError("");
    setStatus("");
    setActionStatus("idle");
    setRefreshError("");
    setPurchaseQuoteState(null);
    setRevealQuoteState(null);
    if (loadedData.current?.key === dataKey)
      setData({ ...loadedData.current, source: client, configVerified: false });
    refresh();
    return () => {
      mounted.current = false;
      if (activeClient.current === client) activeClient.current = null;
    };
  }, [client, dataKey, refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!canQuote) return;
    let active = true;
    const context = { source: client, config, dataKey, key };
    setPurchaseQuoteState({
      ...context,
      loading: true,
      quote: null,
      validUntil: 0,
      error: "",
    });
    const timer = setTimeout(async () => {
      try {
        const quote = await client.getPurchaseQuote(selectedNumbers, {
          drawTime: selectedDrawTime,
          config,
        });
        const entry = amount(quote.entryLamports);
        const prize = amount(quote.prizeLamports);
        const rent = amount(quote.accountRentLamports);
        const total = amount(quote.totalLamports);
        if (
          selectionKey(quote.numbers, Number(quote.drawTime)) !== key ||
          quote.walletAddress !== walletAddress ||
          quote.sourceProgram !== LEMON_PROGRAM_ID ||
          quote.quick !== quickDraw ||
          !(quote.canPurchase === true || quote.isReady === true) ||
          !entry ||
          !prize ||
          rent === null ||
          total === null ||
          total !== entry + rent
        )
          throw new Error(
            "The entry and account rent quote could not be verified.",
          );
        const validUntil = Math.min(
          Date.now() + 30_000,
          Number(quote.validUntil),
        );
        if (!Number.isFinite(validUntil) || validUntil <= Date.now())
          throw new Error(
            "The entry quote expired. Refresh the quote before buying.",
          );
        if (active && mounted.current && activeClient.current === client) {
          setPurchaseQuoteState({
            ...context,
            loading: false,
            validUntil,
            error: "",
            quote,
          });
        }
      } catch (failure) {
        if (active && mounted.current && activeClient.current === client)
          setPurchaseQuoteState({
            ...context,
            loading: false,
            quote: null,
            validUntil: 0,
            error: lemonErrorMessage(failure),
          });
      }
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    canQuote,
    client,
    config,
    dataKey,
    key,
    selectedNumbers,
    selectedDrawTime,
    quickDraw,
    walletAddress,
    purchaseQuoteAttempt,
  ]);

  function assertActive() {
    if (!mounted.current || activeClient.current !== client)
      throw new Error(
        "The connected wallet changed. Refresh before continuing.",
      );
  }

  async function requireWallet() {
    assertActive();
    if (!canSign) throw new Error("Connect a wallet before continuing.");
    if ((await connection.getGenesisHash()) !== DEVNET_GENESIS_HASH)
      throw new Error(
        "Lemon is available only on Solana Devnet. Mainnet transactions are disabled.",
      );
    assertActive();
  }

  async function runAction(
    name,
    action,
    { signature = false, refreshAfter = false } = {},
  ) {
    if (busy.current) return null;
    busy.current = true;
    setActionStatus(name);
    setError("");
    setStatus("");
    try {
      assertActive();
      if (signature) await requireWallet();
      const result = await action();
      assertActive();
      if (refreshAfter) await refresh({ critical: true });
      return result;
    } catch (failure) {
      const message = lemonErrorMessage(failure);
      if (mounted.current && activeClient.current === client) {
        if (signature) await refresh({ critical: true });
        if (mounted.current && activeClient.current === client)
          setError(message);
      }
      return null;
    } finally {
      busy.current = false;
      if (mounted.current && activeClient.current === client)
        setActionStatus("idle");
    }
  }

  function setNumber(index, value) {
    if (busy.current || !Number.isInteger(index) || index < 0 || index > 2)
      return;
    const number = value === null || value === "" ? null : Number(value);
    if (
      number !== null &&
      (!Number.isInteger(number) || number < 0 || number > 9)
    )
      return;
    setPurchaseQuoteState(null);
    setSelectedNumbers((previous) =>
      previous.map((selected, position) =>
        position === index ? number : selected,
      ),
    );
  }

  function setQuickDraw(value) {
    if (busy.current) return;
    const next = Boolean(value);
    setPurchaseQuoteState(null);
    if (next) setQuickDrawTime(getSelectedDrawTime("quick"));
    else if (dailyDrawTime <= Math.floor(Date.now() / 1000))
      setDailyDrawTime(getNextDrawTime());
    setQuickDrawState(next);
  }

  function changeDrawTime(value) {
    if (busy.current) return;
    try {
      const timestamp = getSelectedDrawTime(String(value));
      setPurchaseQuoteState(null);
      setDailyDrawTime(timestamp);
      setQuickDrawState(false);
    } catch (failure) {
      setError(lemonErrorMessage(failure));
    }
  }

  const dailyDraws = getUpcomingDrawTimes(now);
  if (!dailyDraws.includes(dailyDrawTime)) dailyDraws.unshift(dailyDrawTime);

  return {
    walletAddress,
    canSign,
    network: networkStatus.network,
    networkAllowed,
    networkChecking: networkStatus.isLoading,
    isLoading: isLoading || data.key !== dataKey,
    config,
    configVerified,
    ready,
    authorized: ready && canSign && networkAllowed,
    selectedNumbers,
    setNumber,
    quickDraw,
    setQuickDraw,
    selectedDrawTime,
    setSelectedDrawTime: changeDrawTime,
    drawExpired,
    drawOptions: dailyDraws.map((timestamp) => ({
      timestamp,
      label: `${formatDrawTime(timestamp)} UTC+8`,
    })),
    dailyDraws,
    now,
    tickets: visibleData.tickets,
    drawResults: visibleData.results,
    results: visibleData.results,
    historyLoaded: visibleData.historyLoaded,
    purchaseQuote,
    purchaseQuoteLoading:
      canQuote && quoteContextMatches && Boolean(purchaseQuoteState.loading),
    purchaseQuoteError: quoteContextMatches ? purchaseQuoteState.error : "",
    refreshPurchaseQuote: () => {
      if (busy.current) return;
      if (quickDraw && quickDrawTime <= Math.floor(Date.now() / 1000))
        setQuickDrawTime(getSelectedDrawTime("quick"));
      setPurchaseQuoteState(null);
      setPurchaseQuoteAttempt((attempt) => attempt + 1);
    },
    actionStatus,
    pending: actionStatus !== "idle",
    busy: actionStatus !== "idle",
    status,
    message: status,
    error: error || refreshError,
    refreshCooldown: Math.max(0, Math.ceil((refreshUntil - now) / 1000)),
    refresh: () => refresh({ manual: true }),
    buyTicket: () =>
      runAction(
        "buying",
        async () => {
          if (!ready)
            throw new Error(
              "Wait for the verified on-chain Lemon rules before buying a ticket.",
            );
          getSelectedDrawTime(quickDraw ? "quick" : String(selectedDrawTime));
          if (
            !key ||
            !purchaseQuote ||
            purchaseQuote.validUntil <= Date.now() ||
            selectedDrawTime <= Math.floor(Date.now() / 1000) ||
            selectedDrawTime > Math.floor(Date.now() / 1000) + 86_400
          )
            throw new Error(
              "Review a fresh entry and account rent quote for these three fruits and this draw before buying.",
            );
          const ticket = await client.buyTicket([...selectedNumbers], {
            drawTime: selectedDrawTime,
            config,
            quote: purchaseQuote,
            assertActive,
          });
          assertActive();
          setPurchaseQuoteState(null);
          setSelectedNumbers([null, null, null]);
          if (quickDraw) setQuickDrawTime(getSelectedDrawTime("quick"));
          setStatus(
            ticket?.recovered
              ? "Your earlier Lemon purchase was recovered from the chain. No second purchase was sent."
              : "Lemon ticket confirmed on Devnet. It covers only the selected draw; view its blockchain history below.",
          );
          return ticket;
        },
        { signature: true, refreshAfter: true },
      ),
    revealQuote,
    reviewReveal: (ticket) =>
      runAction("reviewing", async () => {
        await requireWallet();
        if (!ticketId(ticket) || !Number.isSafeInteger(Number(ticket.drawTime)))
          throw new Error("Refresh this ticket before reviewing its reveal.");
        if (Number(ticket.drawTime) > Math.floor(Date.now() / 1000))
          throw new Error(
            "Wait until this draw's sales have closed before revealing its result.",
          );
        const quote = await client.quoteOracleRequest(Number(ticket.drawTime));
        assertActive();
        const feeLamports = amount(quote.feeLamports);
        const pendingRent = amount(quote.pendingRentLamports ?? 0);
        const clientRent = amount(quote.clientRentLamports ?? 0);
        const totalLamports = amount(quote.totalLamports);
        if (
          feeLamports === null ||
          pendingRent === null ||
          clientRent === null ||
          totalLamports === null ||
          totalLamports !== feeLamports + pendingRent + clientRent ||
          quote.drawTime !== Number(ticket.drawTime) ||
          quote.walletAddress !== walletAddress ||
          quote.sourceProgram !== LEMON_PROGRAM_ID ||
          typeof quote.requiresPayment !== "boolean" ||
          (quote.requiresPayment ? feeLamports === 0 : totalLamports !== 0)
        )
          throw new Error(
            "The oracle fee and account rent quote could not be verified.",
          );
        const reviewed = {
          ...quote,
          ticketId: ticketId(ticket),
          ticket,
          drawTime: Number(ticket.drawTime),
          source: client,
          dataKey,
          feeLamports,
          rentLamports: pendingRent + clientRent,
          totalLamports,
          quote,
          validUntil: Math.min(Date.now() + 30_000, Number(quote.validUntil)),
        };
        if (
          !Number.isFinite(reviewed.validUntil) ||
          reviewed.validUntil <= Date.now()
        )
          throw new Error(
            "The reveal quote expired. Review its current costs again.",
          );
        setRevealQuoteState(reviewed);
        setStatus(
          quote.requiresPayment === false
            ? "This draw already has an oracle request. Completing its result does not request new randomness or pay another oracle fee."
            : "Oracle costs loaded from Devnet. Review the fee and account rent before confirming the reveal.",
        );
        return reviewed;
      }),
    confirmReveal: () =>
      runAction(
        "revealing",
        async () => {
          if (!revealQuote || revealQuote.validUntil <= Date.now())
            throw new Error(
              "Review fresh reveal costs for this ticket before continuing.",
            );
          const result = await client.recordDraw(revealQuote.drawTime, {
            quote: revealQuote.quote,
            assertActive,
            onProgress: (progress) => {
              assertActive();
              setStatus(
                progress.phase === "request"
                  ? "Approve the reviewed oracle request in your wallet."
                  : progress.phase === "pending"
                    ? "The oracle request is recorded. Waiting for fulfillment; no replacement request is sent."
                    : "The oracle proof is ready. Approve draw completion to record the verified result.",
              );
            },
          });
          assertActive();
          setRevealQuoteState(null);
          setStatus(
            result?.pending || result?.phase === "pending"
              ? "The randomness request is on-chain and awaiting oracle fulfillment. Refresh to check its status; no replacement request is needed."
              : "The verified Lemon result is recorded on-chain. Check your tickets and the draw's blockchain history.",
          );
          return result;
        },
        { signature: true, refreshAfter: true },
      ),
    cancelReveal: () => {
      if (!busy.current) setRevealQuoteState(null);
    },
    revealDraw: (ticket) =>
      runAction(
        "revealing",
        async () => {
          if (
            !ticketId(ticket) ||
            !Number.isSafeInteger(Number(ticket.drawTime))
          )
            throw new Error("Refresh this ticket before completing its draw.");
          const quote = await client.quoteOracleRequest(
            Number(ticket.drawTime),
          );
          assertActive();
          if (quote.requiresPayment !== false)
            throw new Error(
              "Review this draw's oracle fee and account rent before requesting fresh randomness.",
            );
          const result = await client.recordDraw(Number(ticket.drawTime), {
            quote,
            assertActive,
          });
          assertActive();
          setStatus(
            result?.pending || result?.phase === "pending"
              ? "This draw is still awaiting the existing oracle request. No new request or oracle fee was sent."
              : "The verified Lemon result is recorded on-chain. View the draw's blockchain history.",
          );
          return result;
        },
        { signature: true, refreshAfter: true },
      ),
    claimTicket: (ticket) =>
      runAction(
        "claiming",
        async () => {
          if (
            ticket?.settled ||
            ticket?.refunded ||
            !(
              ticket?.result?.isPublished === true ||
              ticket?.draw?.status === "final"
            ) ||
            !validFruitNumbers(ticket?.numbers) ||
            !validFruitNumbers(ticket?.result?.numbers) ||
            ticket.numbers.some(
              (number, index) => number !== ticket.result.numbers[index],
            )
          )
            throw new Error(
              "Refresh this ticket to verify an unpaid winning result before claiming.",
            );
          const result = await client.settleTicket(ticket, { assertActive });
          assertActive();
          setStatus(
            "The winning prize was paid to the ticket's recorded owner. Verify the transfer in its blockchain history.",
          );
          return result;
        },
        { signature: true, refreshAfter: true },
      ),
    refundTicket: (ticket) =>
      runAction(
        "refunding",
        async () => {
          const result = await client.refundTicket(ticket, { assertActive });
          assertActive();
          setStatus(
            "The ticket's actual entry payment was refunded to its recorded owner. Network fees and account rent are separate.",
          );
          return result;
        },
        { signature: true, refreshAfter: true },
      ),
  };
}

export default useLemonGame;
