/**
 * How a security deposit is named wherever it is shown.
 *
 * A deposit worked out from a price nobody has verified (the server's
 * knownBookMRP() is null, so the book was valued at the generic catalogue
 * estimate) is still charged — founder's decision, 24 Sep: disclose, don't
 * block — but it is never presented as a firm number. The server marks
 * those deposits `estimated`; every screen reads its wording from here so
 * the disclosure cannot be present on one screen and missing on another.
 */
export const DEPOSIT_ESTIMATE_NOTE = 'price not verified by the owner';

export const depositTitle = (estimated?: boolean, base = 'Security deposit') =>
  estimated ? `Estimated deposit (${DEPOSIT_ESTIMATE_NOTE})` : base;

/** "Estimated deposit (price not verified by the owner): ₹150" / "Security deposit: ₹150". */
export const depositLine = (amount: number | string, estimated?: boolean, base = 'Security deposit') =>
  `${depositTitle(estimated, base)}: ₹${amount}`;

export const DEPOSIT_ESTIMATE_EXPLAINER =
  "This book's price hasn't been verified, so the deposit is worked out from SwapSutra's standard estimate. It may change if the owner adds the printed MRP.";
