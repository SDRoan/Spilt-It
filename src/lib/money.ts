const AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

export function parseAmountToCents(input: string): number {
  const trimmed = input.trim();

  if (!AMOUNT_REGEX.test(trimmed)) {
    throw new Error("Enter a valid amount (up to 2 decimal places).");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const fractionPadded = `${fraction}00`.slice(0, 2);

  return Number.parseInt(whole, 10) * 100 + Number.parseInt(fractionPadded, 10);
}

export function centsToAmountString(cents: number): string {
  const abs = Math.abs(cents);
  const major = Math.floor(abs / 100);
  const minor = `${abs % 100}`.padStart(2, "0");
  const amount = `${major}.${minor}`;

  return cents < 0 ? `-${amount}` : amount;
}

export function formatCurrencyFromCents(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(cents / 100);
}
