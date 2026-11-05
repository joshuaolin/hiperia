import BN from "bn.js";
import { Buffer } from "buffer";
import {
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  DAILY_DRAW_HOURS,
  MAX_NUMBER,
  MIN_NUMBER,
  PICK_COUNT,
} from "./rules.js";
import { VRF_PROGRAM_ID, ORAO_PROGRAM_ID } from "./vrfProtocol.js";

const connections = new WeakMap();
const unsupported = () =>
  new Error(
    "The on-chain UAT rules could not be verified. The program must support the current UAT rules before purchases are enabled.",
  );

function positiveLamports(value) {
  if (
    !BN.isBN(value) ||
    value.lte(new BN(0)) ||
    value.gt(new BN(String(Number.MAX_SAFE_INTEGER)))
  )
    throw unsupported();
  return value.clone();
}

function decodeReturnData(program, response, length, type) {
  const value = response?.value;
  const data = value?.returnData?.data;
  if (
    value?.err !== null ||
    value.returnData?.programId !== program.programId.toBase58() ||
    !Array.isArray(data) ||
    data.length !== 2 ||
    data[1] !== "base64" ||
    typeof data[0] !== "string"
  )
    throw unsupported();
  const bytes = Buffer.from(data[0], "base64");
  if (bytes.length !== length || bytes.toString("base64") !== data[0])
    throw unsupported();
  let decoded;
  try {
    decoded = program.coder.types.decode(type, bytes);
  } catch {
    throw unsupported();
  }
  return decoded;
}

function decodeRules(program, response) {
  const decoded = decodeReturnData(program, response, 56, "uatRules");
  const winningNumbers = Array.from(decoded.winningNumbers ?? []);
  const dailyHours = Array.from(decoded.dailyHours ?? []);
  const vrf = program.programId.toBase58() === VRF_PROGRAM_ID;
  if (
    !Number.isSafeInteger(decoded.revision) ||
    !(vrf ? decoded.revision === 6 : [3, 4, 5].includes(decoded.revision)) ||
    decoded.minNumber !== MIN_NUMBER ||
    decoded.maxNumber !== MAX_NUMBER ||
    decoded.pickCount !== PICK_COUNT ||
    winningNumbers.length !== PICK_COUNT ||
    (vrf
      ? winningNumbers.some((number) => number !== 0)
      : winningNumbers[0] === winningNumbers[1] ||
        winningNumbers.some(
          (number) =>
            !Number.isInteger(number) ||
            number < MIN_NUMBER ||
            number > MAX_NUMBER,
        )) ||
    dailyHours.length !== DAILY_DRAW_HOURS.length ||
    dailyHours.some((hour, index) => hour !== DAILY_DRAW_HOURS[index]) ||
    decoded.scheduleIntervalSeconds !== 14_400 ||
    decoded.scheduleOffsetSeconds !== 7_200 ||
    decoded.buyAheadSeconds !== 86_400
  )
    throw unsupported();
  return Object.freeze({
    ...decoded,
    winningNumbers: Object.freeze(winningNumbers),
    dailyHours: Object.freeze(dailyHours),
    quickTicketCostLamports: positiveLamports(decoded.quickTicketCostLamports),
    dailyTicketCostLamports: positiveLamports(decoded.dailyTicketCostLamports),
    quickPayoutLamports: positiveLamports(decoded.quickPayoutLamports),
    dailyPayoutLamports: positiveLamports(decoded.dailyPayoutLamports),
  });
}

async function loadMetadata({
  connection,
  program,
  configAddress,
  payer,
  now = Date.now,
  fresh = false,
  method,
  decode,
}) {
  if (!connection || typeof connection.simulateTransaction !== "function")
    throw unsupported();
  let cache = connections.get(connection);
  if (!cache) {
    cache = new Map();
    connections.set(connection, cache);
  }
  const key = `${program.programId.toBase58()}:${configAddress.toBase58()}:${method}`;
  const previous = cache.get(key);
  if (previous?.promise) return previous.promise;
  if (
    !fresh &&
    previous &&
    Object.hasOwn(previous, "value") &&
    previous.until > now()
  )
    return previous.value;
  const entry = {};
  const promise = (async () => {
    const instruction = await program.methods[method]()
      .accountsStrict({ config: configAddress })
      .instruction();
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: SystemProgram.programId.toBase58(),
        instructions: [instruction],
      }).compileToV0Message(),
    );
    const response = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    });
    return decode(program, response);
  })();
  entry.promise = promise;
  cache.set(key, entry);
  try {
    const rules = await promise;
    entry.value = rules;
    entry.until = now() + 30_000;
    entry.promise = null;
    return rules;
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key);
    if (error?.message?.includes(method)) throw unsupported();
    throw error;
  }
}

export function loadChainRules(options) {
  return loadMetadata({ ...options, method: "getRules", decode: decodeRules });
}

function decodeReferralRules(program, response) {
  const instructionError = response?.value?.err?.InstructionError;
  if (
    Array.isArray(instructionError) &&
    instructionError.length === 2 &&
    instructionError[0] === 0 &&
    instructionError[1]?.Custom === 101
  )
    return null;
  const decoded = decodeReturnData(program, response, 34, "referralRules");
  if (decoded.revision !== 5 || decoded.campaignVersion !== 1)
    throw unsupported();
  const normalQuickTicketCostLamports = positiveLamports(
    decoded.normalQuickTicketCostLamports,
  );
  const normalDailyTicketCostLamports = positiveLamports(
    decoded.normalDailyTicketCostLamports,
  );
  const referredQuickTicketCostLamports = positiveLamports(
    decoded.referredQuickTicketCostLamports,
  );
  const referredDailyTicketCostLamports = positiveLamports(
    decoded.referredDailyTicketCostLamports,
  );
  if (
    !referredQuickTicketCostLamports.lt(normalQuickTicketCostLamports) ||
    !referredDailyTicketCostLamports.lt(normalDailyTicketCostLamports)
  )
    throw unsupported();
  return Object.freeze({
    ...decoded,
    normalQuickTicketCostLamports,
    normalDailyTicketCostLamports,
    referredQuickTicketCostLamports,
    referredDailyTicketCostLamports,
  });
}

export function loadReferralRules(options) {
  if (typeof options.program?.methods?.getReferralRules !== "function")
    return Promise.resolve(null);
  return loadMetadata({
    ...options,
    method: "getReferralRules",
    decode: decodeReferralRules,
  });
}

function decodeAccessRules(program, response) {
  const instructionError = response?.value?.err?.InstructionError;
  if (
    Array.isArray(instructionError) &&
    instructionError.length === 2 &&
    instructionError[0] === 0 &&
    instructionError[1]?.Custom === 101
  )
    return null;
  const decoded = decodeReturnData(program, response, 3, "accessRules");
  const bytes = Buffer.from(response.value.returnData.data[0], "base64");
  if (
    decoded.revision !== 1 ||
    ![0, 1].includes(bytes[1]) ||
    ![0, 1].includes(bytes[2]) ||
    typeof decoded.publicPlay !== "boolean" ||
    typeof decoded.publicResults !== "boolean"
  )
    throw unsupported();
  return Object.freeze({
    revision: decoded.revision,
    publicPlayEnabled: decoded.publicPlay,
    publicResultsEnabled: decoded.publicResults,
  });
}

export function loadAccessRules(options) {
  if (typeof options.program?.methods?.getAccessRules !== "function")
    return Promise.resolve(null);
  return loadMetadata({
    ...options,
    method: "getAccessRules",
    decode: decodeAccessRules,
  });
}

function decodeRandomnessRules(program, response) {
  const decoded = decodeReturnData(program, response, 39, "randomnessRules");
  if (
    program.programId.toBase58() !== VRF_PROGRAM_ID ||
    decoded.revision !== 1 ||
    decoded.oracleProgram?.toBase58() !== ORAO_PROGRAM_ID ||
    decoded.refundAfterSeconds !== 86_400 ||
    decoded.pendingRequestSpace !== 749
  )
    throw unsupported();
  return Object.freeze({
    ...decoded,
    oracleProgram: decoded.oracleProgram.toBase58(),
  });
}

export function loadRandomnessRules(options) {
  return loadMetadata({
    ...options,
    method: "getRandomnessRules",
    decode: decodeRandomnessRules,
  });
}

function decodeLiabilityRules(program, response) {
  const decoded = decodeReturnData(program, response, 7, "liabilityRules");
  const bytes = Buffer.from(response.value.returnData.data[0], "base64");
  if (
    program.programId.toBase58() !== VRF_PROGRAM_ID ||
    decoded.revision !== 1 ||
    decoded.dailyPooled !== true ||
    decoded.quickPooled !== false ||
    bytes[1] !== 1 || bytes[2] !== 0 ||
    decoded.pairCount !== 420 ||
    decoded.riskAccountSpace !== 3398
  )
    throw unsupported();
  return Object.freeze(decoded);
}

export function loadLiabilityRules(options) {
  return loadMetadata({ ...options, method: "getLiabilityRules", decode: decodeLiabilityRules });
}
