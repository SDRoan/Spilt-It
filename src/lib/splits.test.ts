import { describe, expect, it } from "vitest";

import { computeExpenseSplit } from "@/lib/splits";

const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";
const C = "00000000-0000-0000-0000-000000000003";

describe("computeExpenseSplit", () => {
  it("computes equal split with remainder handling", () => {
    const result = computeExpenseSplit({
      mode: "equal",
      totalCents: 1000,
      participants: [A, B, C],
    });

    expect(result.totalCents).toBe(1000);
    expect(Object.values(result.participantTotals).reduce((sum, amount) => sum + amount, 0)).toBe(1000);
    expect(result.participantTotals[A]).toBe(334);
    expect(result.participantTotals[B]).toBe(333);
    expect(result.participantTotals[C]).toBe(333);
  });

  it("validates exact split sum", () => {
    expect(() =>
      computeExpenseSplit({
        mode: "exact",
        totalCents: 1000,
        exactAllocations: [
          { memberId: A, amountCents: 400 },
          { memberId: B, amountCents: 400 },
        ],
      }),
    ).toThrow(/add up/i);
  });

  it("computes percent split", () => {
    const result = computeExpenseSplit({
      mode: "percent",
      totalCents: 1000,
      percentAllocations: [
        { memberId: A, percent: 50 },
        { memberId: B, percent: 30 },
        { memberId: C, percent: 20 },
      ],
    });

    expect(result.participantTotals[A]).toBe(500);
    expect(result.participantTotals[B]).toBe(300);
    expect(result.participantTotals[C]).toBe(200);
  });

  it("computes share split", () => {
    const result = computeExpenseSplit({
      mode: "shares",
      totalCents: 900,
      shareAllocations: [
        { memberId: A, shares: 2 },
        { memberId: B, shares: 1 },
      ],
    });

    expect(result.participantTotals[A]).toBe(600);
    expect(result.participantTotals[B]).toBe(300);
  });

  it("computes itemized split from line items", () => {
    const result = computeExpenseSplit({
      mode: "itemized",
      itemizedItems: [
        { name: "Milk", amountCents: 300, memberIds: [A, B] },
        { name: "Eggs", amountCents: 300, memberIds: [B] },
      ],
    });

    expect(result.totalCents).toBe(600);
    expect(result.participantTotals[A]).toBe(150);
    expect(result.participantTotals[B]).toBe(450);
    expect(result.splitRows.every((row) => typeof row.itemIndex === "number")).toBe(true);
  });
});
