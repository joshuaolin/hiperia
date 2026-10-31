export function dodosErrorMessage(failure) {
  const message = failure?.message || "The transaction failed.";
  if (
    failure?.error?.errorCode?.code === "InsufficientVaultFunds" ||
    /InsufficientVaultFunds|Error Number: 6014\b|custom program error: 0x177e\b/.test(
      message,
    )
  )
    return "The prize vault cannot reserve another full prize yet. Multiple entries for the same draw are allowed, but each ticket needs its own prize backing. Existing winning prizes stay reserved until paid. Try again after more vault funds are available.";
  return message;
}
