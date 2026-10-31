import { isRateLimitError } from "../../lib/refreshGate.js";

export function gameSources(client) {
  return client.primary && client.legacy
    ? [
        { client: client.primary, legacy: false },
        { client: client.legacy, legacy: true },
      ]
    : [{ client }];
}

function sourceAddress(source) {
  return source.client.program.programId.toBase58();
}

function annotate(entries, source) {
  const sourceProgram = sourceAddress(source);
  return entries.map((entry) => ({
    ...entry,
    sourceProgram,
    ...(source.legacy === undefined
      ? {}
      : {
          legacy: source.legacy,
          randomnessMode: source.legacy ? "legacy-fixed" : "orao-vrf",
        }),
  }));
}

export class PartialGameReadError extends Error {
  constructor(snapshot, failures) {
    super("Some on-chain game data is temporarily unavailable.", {
      cause: failures.find(isRateLimitError) ?? failures[0],
    });
    this.snapshot = snapshot;
    this.failures = failures;
  }
}

export async function loadGameSnapshot(
  client,
  { previous = null, loadReferral = async () => null } = {},
) {
  const prior = previous?.source === client ? previous : null;
  const sources = gameSources(client);
  const failures = [];
  const initial = await Promise.allSettled([
    client.getConfig(),
    ...sources.map((source) => source.client.recoverPendingPurchase()),
  ]);
  const configuration = initial[0];
  const configVerified =
    configuration.status === "fulfilled" && Boolean(configuration.value);
  const config =
    configuration.status === "fulfilled"
      ? configuration.value
      : (prior?.config ?? null);
  for (const result of initial)
    if (result.status === "rejected") failures.push(result.reason);
  const recovered = initial
    .slice(1)
    .find((result) => result.status === "fulfilled" && result.value)?.value;
  const reads = await Promise.allSettled(
    sources.flatMap((source) => [
      (async () => {
        const activeConfig = source.legacy
          ? await source.client.program.account.config.fetchNullable(
              source.client.configAddress,
            )
          : config;
        return source.client.getTickets(activeConfig ?? {});
      })(),
      source.client.getResults(),
    ]),
  );
  const merged = { tickets: [], results: [] };
  let historyLoaded = Boolean(prior?.historyLoaded);
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    for (const [offset, field] of ["tickets", "results"].entries()) {
      const result = reads[index * 2 + offset];
      if (result.status === "fulfilled") {
        merged[field].push(...annotate(result.value, source));
        if (field === "tickets") historyLoaded = true;
      } else {
        failures.push(result.reason);
        merged[field].push(
          ...(prior?.[field] ?? []).filter(
            (entry) => entry.sourceProgram === sourceAddress(source),
          ),
        );
      }
    }
  }
  for (const entries of Object.values(merged))
    entries.sort((first, second) => second.drawTime - first.drawTime);
  const referral =
    configVerified && !config.publicPlayEnabled
      ? await loadReferral(config, prior?.referral)
      : config?.publicPlayEnabled
        ? null
        : (prior?.referral ?? null);
  const snapshot = {
    source: client,
    config,
    configVerified,
    historyLoaded,
    ...merged,
    referral,
    recovered: recovered ?? null,
  };
  if (failures.length) throw new PartialGameReadError(snapshot, failures);
  return snapshot;
}

const quoteAmounts = [
  "feeLamports",
  "pendingRentLamports",
  "clientRentLamports",
  "totalLamports",
];
const quoteAddresses = ["treasury", "networkAddress", "oracleProgram"];

export function sameOracleQuote(reviewed, fresh) {
  if (!reviewed || !fresh) return false;
  try {
    return (
      quoteAmounts.every(
        (field) =>
          reviewed[field] != null &&
          fresh[field] != null &&
          BigInt(reviewed[field].toString()) >= 0n &&
          BigInt(reviewed[field].toString()) ===
            BigInt(fresh[field].toString()),
      ) &&
      quoteAddresses.every(
        (field) =>
          typeof reviewed[field] === "string" &&
          reviewed[field].length > 0 &&
          reviewed[field] === fresh[field],
      )
    );
  } catch {
    return false;
  }
}

export function assertReviewedOracleQuote(reviewed, fresh, ticket) {
  if (
    reviewed?.drawTime !== ticket.drawTime ||
    reviewed?.sourceProgram !== ticket.sourceProgram ||
    !sameOracleQuote(reviewed, fresh)
  )
    throw new Error(
      "Reveal costs changed or have not been reviewed. Review the updated costs before approving a request. No request was sent.",
    );
}
