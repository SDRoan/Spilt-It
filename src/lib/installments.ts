export interface InstallmentEntry {
  index: number;
  amountCents: number;
  dueDate: string;
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map((value) => Number.parseInt(value, 10));
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildInstallmentPlan(
  totalCents: number,
  parts: number,
  startDate: string,
  intervalDays = 7,
): InstallmentEntry[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error("Installment total must be a positive integer amount in cents.");
  }

  if (!Number.isInteger(parts) || parts < 2) {
    throw new Error("Installment parts must be an integer >= 2.");
  }

  if (!Number.isInteger(intervalDays) || intervalDays < 1) {
    throw new Error("Installment interval days must be an integer >= 1.");
  }

  const baseAmount = Math.floor(totalCents / parts);
  const remainder = totalCents % parts;

  const entries: InstallmentEntry[] = [];
  for (let i = 0; i < parts; i += 1) {
    entries.push({
      index: i + 1,
      amountCents: baseAmount + (i < remainder ? 1 : 0),
      dueDate: addDays(startDate, i * intervalDays),
    });
  }

  return entries;
}
