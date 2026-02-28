import { describe, expect, it } from "vitest";

import {
  buildExpenseBalanceDelta,
  buildWeeklyActionPlan,
  computeMonthlyShareSpend,
  computeResponsibilityScore,
  monthKeyFromDate,
} from "@/lib/financial-coach";

describe("financial coach helpers", () => {
  it("builds balance delta from expense payer and splits", () => {
    const delta = buildExpenseBalanceDelta("A", 3000, [
      { participantId: "A", amountCents: 1500 },
      { participantId: "B", amountCents: 1500 },
    ]);

    expect(delta.A).toBe(1500);
    expect(delta.B).toBe(-1500);
  });

  it("computes monthly share spend per member", () => {
    const spend = computeMonthlyShareSpend(
      [
        {
          expenseDate: "2026-02-10",
          splits: [
            { participantId: "A", amountCents: 500 },
            { participantId: "B", amountCents: 500 },
          ],
        },
        {
          expenseDate: "2026-03-02",
          splits: [{ participantId: "A", amountCents: 900 }],
        },
      ],
      "A",
      "2026-02",
    );

    expect(spend).toBe(500);
  });

  it("creates weekly action plan for owed balances", () => {
    const plan = buildWeeklyActionPlan(2400, 1000, "2026-02-28");
    expect(plan.recommendedPaymentCents).toBe(1000);
    expect(plan.weeksToClear).toBe(3);
    expect(plan.dueDate).toBe("2026-03-06");
  });

  it("scores higher when debt is low and payments are active", () => {
    const high = computeResponsibilityScore({
      owedCents: 500,
      maxDebtCents: 5000,
      monthlyShareSpendCents: 8000,
      monthlyBudgetCents: 20000,
      recentOutgoingPaymentsCount: 3,
    });

    const low = computeResponsibilityScore({
      owedCents: 9000,
      maxDebtCents: 5000,
      monthlyShareSpendCents: 30000,
      monthlyBudgetCents: 15000,
      recentOutgoingPaymentsCount: 0,
    });

    expect(high).toBeGreaterThan(low);
  });

  it("returns month key from date", () => {
    expect(monthKeyFromDate("2026-02-28")).toBe("2026-02");
  });
});
