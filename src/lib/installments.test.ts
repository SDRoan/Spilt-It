import { describe, expect, it } from "vitest";

import { buildInstallmentPlan } from "@/lib/installments";

describe("buildInstallmentPlan", () => {
  it("splits total cents into parts and preserves sum", () => {
    const plan = buildInstallmentPlan(1001, 3, "2026-02-28");
    const amounts = plan.map((entry) => entry.amountCents);
    const total = amounts.reduce((sum, amount) => sum + amount, 0);

    expect(amounts).toEqual([334, 334, 333]);
    expect(total).toBe(1001);
  });

  it("builds weekly due dates by default", () => {
    const plan = buildInstallmentPlan(2000, 2, "2026-02-28");
    expect(plan[0]?.dueDate).toBe("2026-02-28");
    expect(plan[1]?.dueDate).toBe("2026-03-07");
  });

  it("throws on invalid input", () => {
    expect(() => buildInstallmentPlan(0, 2, "2026-02-28")).toThrow();
    expect(() => buildInstallmentPlan(1000, 1, "2026-02-28")).toThrow();
    expect(() => buildInstallmentPlan(1000, 2, "2026-02-28", 0)).toThrow();
  });
});
