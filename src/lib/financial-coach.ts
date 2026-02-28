export interface FinancialCoachSettings {
  monthlyBudgetCents: number;
  maxDebtCents: number;
  weeklyPayCapCents: number;
}

export interface ExpenseShareRow {
  participantId: string;
  amountCents: number;
}

export interface CoachExpenseRow {
  expenseDate: string;
  splits: ExpenseShareRow[];
}

export interface WeeklyActionPlan {
  recommendedPaymentCents: number;
  dueDate: string;
  weeksToClear: number;
}

function parseIsoDate(date: string): Date {
  const [year, month, day] = date.split("-").map((value) => Number.parseInt(value, 10));
  return new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1));
}

function nextFriday(fromDate: string): string {
  const date = parseIsoDate(fromDate);
  while (date.getUTCDay() !== 5) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

export function monthKeyFromDate(date: string): string {
  return date.slice(0, 7);
}

export function buildExpenseBalanceDelta(
  paidBy: string,
  totalCents: number,
  splits: ExpenseShareRow[],
): Record<string, number> {
  const delta: Record<string, number> = {};
  delta[paidBy] = (delta[paidBy] ?? 0) + totalCents;

  for (const split of splits) {
    delta[split.participantId] = (delta[split.participantId] ?? 0) - split.amountCents;
  }

  return delta;
}

export function computeMonthlyShareSpend(
  expenses: CoachExpenseRow[],
  memberId: string,
  monthKey: string,
): number {
  let total = 0;

  for (const expense of expenses) {
    if (!expense.expenseDate.startsWith(monthKey)) {
      continue;
    }

    for (const split of expense.splits) {
      if (split.participantId === memberId) {
        total += split.amountCents;
      }
    }
  }

  return total;
}

export function buildWeeklyActionPlan(
  owedCents: number,
  weeklyPayCapCents: number,
  referenceDate: string,
): WeeklyActionPlan {
  if (owedCents <= 0) {
    return {
      recommendedPaymentCents: 0,
      dueDate: nextFriday(referenceDate),
      weeksToClear: 0,
    };
  }

  const weeklyCap = Math.max(100, weeklyPayCapCents);
  const recommendedPaymentCents = Math.min(owedCents, weeklyCap);
  const weeksToClear = Math.ceil(owedCents / recommendedPaymentCents);

  return {
    recommendedPaymentCents,
    dueDate: nextFriday(referenceDate),
    weeksToClear,
  };
}

export function computeResponsibilityScore(input: {
  owedCents: number;
  maxDebtCents: number;
  monthlyShareSpendCents: number;
  monthlyBudgetCents: number;
  recentOutgoingPaymentsCount: number;
}): number {
  const { owedCents, maxDebtCents, monthlyShareSpendCents, monthlyBudgetCents, recentOutgoingPaymentsCount } = input;

  let budgetScore = 0;
  if (monthlyBudgetCents <= 0) {
    budgetScore = 35;
  } else {
    const utilization = monthlyShareSpendCents / monthlyBudgetCents;
    if (utilization <= 0.8) {
      budgetScore = 35;
    } else if (utilization <= 1) {
      budgetScore = 30;
    } else if (utilization <= 1.2) {
      budgetScore = 20;
    } else {
      budgetScore = 8;
    }
  }

  let debtScore = 0;
  if (owedCents <= 0) {
    debtScore = 40;
  } else if (maxDebtCents <= 0) {
    debtScore = 5;
  } else {
    const debtPressure = owedCents / maxDebtCents;
    if (debtPressure <= 0.5) {
      debtScore = 32;
    } else if (debtPressure <= 1) {
      debtScore = 22;
    } else if (debtPressure <= 1.5) {
      debtScore = 12;
    } else {
      debtScore = 4;
    }
  }

  let paymentScore = 0;
  if (owedCents <= 0) {
    paymentScore = 25;
  } else if (recentOutgoingPaymentsCount >= 3) {
    paymentScore = 25;
  } else if (recentOutgoingPaymentsCount === 2) {
    paymentScore = 18;
  } else if (recentOutgoingPaymentsCount === 1) {
    paymentScore = 10;
  } else {
    paymentScore = 3;
  }

  return Math.max(0, Math.min(100, budgetScore + debtScore + paymentScore));
}
