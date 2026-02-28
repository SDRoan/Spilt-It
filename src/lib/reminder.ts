interface SettlementReminderInput {
  payerName: string;
  payeeName: string;
  amountLabel: string;
  groupName: string;
  settleLink: string;
}

export function buildSettlementReminderMessage(input: SettlementReminderInput): string {
  return `Hi ${input.payerName}, quick reminder from Split It: please pay ${input.payeeName} ${input.amountLabel} for "${input.groupName}". Mark it as paid here: ${input.settleLink}`;
}

export function buildWhatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function buildSmsShareUrl(message: string): string {
  return `sms:?&body=${encodeURIComponent(message)}`;
}

export function joinAbsoluteUrl(baseUrl: string, pathOrQuery: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedTarget = pathOrQuery.trim();

  if (normalizedTarget.startsWith("http://") || normalizedTarget.startsWith("https://")) {
    return normalizedTarget;
  }

  if (normalizedTarget.startsWith("?") || normalizedTarget.startsWith("#")) {
    return `${normalizedBase}/${normalizedTarget}`;
  }

  const normalizedPath = normalizedTarget.startsWith("/") ? normalizedTarget : `/${normalizedTarget}`;
  return `${normalizedBase}${normalizedPath}`;
}
