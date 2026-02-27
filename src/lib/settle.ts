export interface SuggestedSettlement {
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
}

interface BalanceBucket {
  memberId: string;
  amountCents: number;
}

export function suggestSettlements(balances: Record<string, number>): SuggestedSettlement[] {
  const debtors: BalanceBucket[] = [];
  const creditors: BalanceBucket[] = [];

  for (const [memberId, amountCents] of Object.entries(balances)) {
    if (amountCents < 0) {
      debtors.push({ memberId, amountCents });
    } else if (amountCents > 0) {
      creditors.push({ memberId, amountCents });
    }
  }

  debtors.sort((a, b) => a.amountCents - b.amountCents);
  creditors.sort((a, b) => b.amountCents - a.amountCents);

  const transfers: SuggestedSettlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];

    const debt = Math.abs(debtor.amountCents);
    const credit = creditor.amountCents;
    const settled = Math.min(debt, credit);

    if (settled > 0) {
      transfers.push({
        fromMemberId: debtor.memberId,
        toMemberId: creditor.memberId,
        amountCents: settled,
      });

      debtor.amountCents += settled;
      creditor.amountCents -= settled;
    }

    if (debtor.amountCents === 0) {
      debtorIndex += 1;
    }

    if (creditor.amountCents === 0) {
      creditorIndex += 1;
    }
  }

  return transfers;
}
