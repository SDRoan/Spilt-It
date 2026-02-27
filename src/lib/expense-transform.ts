import type { ExpenseView } from "@/lib/db";
import type { ExpensePayload } from "@/types/app";

function aggregateByParticipant(expense: ExpenseView): Array<{ memberId: string; amountCents: number }> {
  const totals = expense.splits.reduce<Record<string, number>>((acc, split) => {
    acc[split.participantId] = (acc[split.participantId] ?? 0) + split.amountCents;
    return acc;
  }, {});

  return Object.entries(totals).map(([memberId, amountCents]) => ({
    memberId,
    amountCents,
  }));
}

export function expenseToPayload(expense: ExpenseView): ExpensePayload {
  const base = {
    description: expense.description,
    date: expense.expenseDate,
    paidBy: expense.paidBy,
    currencyCode: expense.currencyCode,
    notes: expense.notes ?? undefined,
  };

  if (expense.splitMode === "equal") {
    const participants = Array.from(new Set(expense.splits.map((split) => split.participantId)));

    return {
      ...base,
      mode: "equal",
      totalCents: expense.totalCents,
      participants,
    };
  }

  if (expense.splitMode === "exact") {
    return {
      ...base,
      mode: "exact",
      totalCents: expense.totalCents,
      allocations: aggregateByParticipant(expense),
    };
  }

  if (expense.splitMode === "percent") {
    const allocations = aggregateByParticipant(expense).map((entry) => ({
      memberId: entry.memberId,
      percent: Number(((entry.amountCents / expense.totalCents) * 100).toFixed(2)),
    }));

    return {
      ...base,
      mode: "percent",
      totalCents: expense.totalCents,
      allocations,
    };
  }

  if (expense.splitMode === "shares") {
    const allocations = aggregateByParticipant(expense).map((entry) => ({
      memberId: entry.memberId,
      shares: Number((entry.amountCents / 100).toFixed(2)),
    }));

    return {
      ...base,
      mode: "shares",
      totalCents: expense.totalCents,
      allocations,
    };
  }

  const items = expense.items.map((item) => ({
    name: item.name,
    amountCents: item.amountCents,
    memberIds: Array.from(
      new Set(
        expense.splits
          .filter((split) => split.itemId === item.id)
          .map((split) => split.participantId),
      ),
    ),
  }));

  return {
    ...base,
    mode: "itemized",
    items,
  };
}
