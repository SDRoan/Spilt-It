export interface ExpenseBalanceRow {
  paidBy: string;
  totalCents: number;
  splits: Array<{
    participantId: string;
    amountCents: number;
  }>;
}

export interface PaymentBalanceRow {
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
}

export function computeGroupBalances(
  memberIds: string[],
  expenses: ExpenseBalanceRow[],
  payments: PaymentBalanceRow[],
): Record<string, number> {
  const balances: Record<string, number> = {};

  for (const memberId of memberIds) {
    balances[memberId] = 0;
  }

  for (const expense of expenses) {
    balances[expense.paidBy] = (balances[expense.paidBy] ?? 0) + expense.totalCents;

    for (const split of expense.splits) {
      balances[split.participantId] = (balances[split.participantId] ?? 0) - split.amountCents;
    }
  }

  for (const payment of payments) {
    balances[payment.fromMemberId] =
      (balances[payment.fromMemberId] ?? 0) - payment.amountCents;
    balances[payment.toMemberId] = (balances[payment.toMemberId] ?? 0) + payment.amountCents;
  }

  return balances;
}
