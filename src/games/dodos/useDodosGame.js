import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { DodosClient } from "../../lib/onchain/DodosClient.js";
import {
  getNextDrawTime,
  getUpcomingDrawTimes,
  formatDrawTime,
  getSelectedDrawTime,
} from "../../lib/onchain/time.js";
import useNetworkStatus from "../../components/useNetworkStatus.js";
import { runDodosTransaction } from "./transaction.js";
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

export function useDodosGame() {
  const { connection } = useConnection();
  const networkStatus = useNetworkStatus();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { client, refreshGate } = useMemo(
    () => ({
      client: new DodosClient({
        connection,
        wallet: { publicKey, signTransaction, signAllTransactions },
      }),
      refreshGate: new RefreshGate(),
    }),
    [connection, publicKey, signTransaction, signAllTransactions],
  );
  const [data, setData] = useState({
    source: null,
    config: null,
    tickets: [],
    results: [],
  });
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [drawChoice, setDrawChoice] = useState(() => String(getNextDrawTime()));
  const [now, setNow] = useState(Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState(null);
  const [refreshUntil, setRefreshUntil] = useState(0);
  const loadedData = useRef(null);
  const refreshRetryTimer = useRef(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const refreshId = useRef(0);
  const activeClient = useRef(client);
  const canSign = Boolean(publicKey && signTransaction && signAllTransactions);
  const config = data.source === client ? data.config : null;
  const uatReady = Boolean(config?.uatEnabled);
  const walletAddress = publicKey?.toBase58();
  const authorized = Boolean(
    uatReady && [config.uatTester, config.uatAdmin].includes(walletAddress),
  );
  const quickDraw = drawChoice === "quick";
  const drawExpired =
    !quickDraw && Number(drawChoice) <= Math.floor(now / 1000);
  const dailyDraws = getUpcomingDrawTimes(now);
  if (!quickDraw && !dailyDraws.includes(Number(drawChoice)))
    dailyDraws.unshift(Number(drawChoice));

  function requireUatWallet() {
    if (!uatReady)
      throw new Error(
        "The UAT contract update is not configured yet. Wait for the on-chain setup before sending transactions.",
      );
    if (!authorized)
      throw new Error(
        "This fixed-result UAT is restricted to the approved test wallet. Connect your approved wallet to continue.",
      );
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
        const { recovered, config, tickets, results } = await refreshGate.run(
          async () => {
            const recovered = await client.recoverPendingPurchase();
            const config = await client.getConfig();
            const [tickets, results] = config
              ? await Promise.all([
                  client.getTickets(config),
                  client.getResults(),
                ])
              : [[], []];
            return { recovered, config, tickets, results };
          },
          { manual, freshAfterPending: critical },
        );
        if (
          mounted.current &&
          activeClient.current === client &&
          requestId === refreshId.current
        ) {
          const nextData = { source: client, config, tickets, results };
          loadedData.current = nextData;
          setData(nextData);
          setLoadFailed(false);
          setRefreshFailure(null);
          clearTimeout(refreshRetryTimer.current);
          if (recovered) {
            setMessage(
              "Your earlier purchase was recovered from the chain. No second purchase was sent.",
            );
            setSelectedNumbers([]);
          }
          setError(
            config
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
          const hasData =
            loadedData.current?.source === client &&
            Boolean(loadedData.current.config);
          const rateLimited =
            isRateLimitError(failure) ||
            (failure instanceof RefreshCooldownError && failure.rateLimited);
          if (!(failure instanceof RefreshCooldownError) || rateLimited) {
            setLoadFailed(!hasData);
            if (!hasData)
              setData({
                source: client,
                config: null,
                tickets: [],
                results: [],
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
    [client, refreshGate],
  );

  useEffect(() => {
    mounted.current = true;
    activeClient.current = client;
    setMessage("");
    setError("");
    setRefreshFailure(null);
    setRefreshUntil(0);
    const pendingPurchase = client.getPendingPurchase();
    if (pendingPurchase) setSelectedNumbers(pendingPurchase.numbers);
    refresh();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      activeClient.current = null;
      refreshId.current += 1;
      clearInterval(timer);
      clearTimeout(refreshRetryTimer.current);
    };
  }, [client, refresh]);

  async function runAction(action, requiresSignature = false) {
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
        await refresh({ critical: requiresSignature });
      }
    } catch (failure) {
      if (mounted.current && activeClient.current === client) {
        setError(failure.message || "The transaction failed.");
        if (client.getPendingPurchase()) await refresh();
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
    setSelectedNumbers(createQuickPick());
  }

  const refreshCooldown = Math.max(0, Math.ceil((refreshUntil - now) / 1000));
  const refreshError = refreshFailure
    ? `${refreshFailure.rateLimited ? "Temporarily rate-limited." : "Dodos is temporarily unavailable."} ${refreshFailure.hasData ? "Showing last loaded data." : "Dodos has not loaded yet."} ${refreshCooldown ? `Try again in ${refreshCooldown}s.` : "You can try Refresh again."}`
    : "";

  return {
    ...(data.source === client
      ? data
      : { config: null, tickets: [], results: [] }),
    connected: Boolean(publicKey),
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
      if (!busy.current) setDrawChoice(value);
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
      if (!busy.current) setSelectedNumbers([]);
    },
    purchase: () =>
      runAction(async () => {
        requireUatWallet();
        const drawTime = getSelectedDrawTime(drawChoice);
        const ticket = await client.buyTicket(selectedNumbers, { drawTime });
        if (mounted.current) setSelectedNumbers([]);
        return ticket.recovered
          ? "Your earlier purchase was recovered from the chain. No second purchase was sent."
          : `Ticket confirmed for ${formatDrawTime(ticket.drawTime)} UTC+8. It covers only this draw. View its blockchain history below.`;
      }, true),
    publish: (ticket) =>
      runAction(async () => {
        requireUatWallet();
        const signature = await client.publishResult(ticket.drawTime);
        return signature
          ? "Draw result recorded on-chain. View result to check your match."
          : "This draw result is already recorded on-chain. View result to check your match.";
      }, true),
    check: (ticket) =>
      runAction(async () => {
        const result = await client.checkTicket(ticket);
        if (result.status === "pending")
          return Math.floor(Date.now() / 1000) < ticket.drawTime
            ? "This draw has not started yet. View result is free and only reads the blockchain."
            : "The draw is due, but its result has not been recorded. Record draw result to create the on-chain record; your wallet pays the network fee and account rent.";
        if (ticket.settled)
          return `${result.status === "won" ? "Prize already claimed" : "Ticket already closed without a prize"}. Recorded result: ${result.numbers.map((number) => String(number).padStart(2, "0")).join(" → ")}.`;
        return result.status === "won"
          ? "Both numbers match in order. Claim prize sends the configured payout to your wallet. UAT prizes have no claim deadline."
          : `No match. Recorded result: ${result.numbers.map((number) => String(number).padStart(2, "0")).join(" → ")}. Close ticket is optional, pays a network fee, and releases its reserved prize capacity. No prize is paid.`;
      }),
    settle: (ticket) =>
      runAction(async () => {
        requireUatWallet();
        const result = await client.checkTicket(ticket);
        if (result.status === "pending")
          throw new Error(
            "Record this draw result before claiming a prize or closing the ticket.",
          );
        await client.settleTicket(ticket);
        return result.status === "won"
          ? "Prize paid to your wallet. View the ticket's blockchain history to verify the transfer."
          : "Ticket closed. No prize was paid; its reserved prize capacity is available again.";
      }, true),
  };
}
