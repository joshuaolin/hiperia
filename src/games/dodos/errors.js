export function dodosErrorMessage(failure) {
  const message = failure?.message || "The transaction failed.";
  let source = failure;
  const seen = new Set();
  while (source && !seen.has(source)) {
    seen.add(source);
    if (source?.error?.errorCode?.code === "ClaimAwaitingFunds" ||
      source?.error?.errorCode?.number === 6034 ||
      /ClaimAwaitingFunds|Error Number: 6034\b|custom program error: 0x1792\b/.test(source.message ?? ""))
      return "Waiting for treasury funding. This prize remains unpaid and can be claimed after the operator tops up the prize vault. Refresh to check its funding; no replacement claim is sent automatically.";
    source = source.cause;
  }
  if (
    failure?.error?.errorCode?.code === "InsufficientVaultFunds" ||
    /InsufficientVaultFunds|Error Number: 6014\b|custom program error: 0x177e\b/.test(
      message,
    )
  )
    return "The prize vault cannot reserve another full prize yet. Multiple entries for the same draw are allowed, but each ticket needs its own prize backing. Existing winning prizes stay reserved until paid. Try again after more vault funds are available.";
  return message;
}
