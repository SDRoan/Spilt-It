import { describe, expect, it } from "vitest";

import { computeGroupBalances } from "@/lib/balances";
import { suggestSettlements } from "@/lib/settle";

const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";
const C = "00000000-0000-0000-0000-000000000003";

describe("balances and settlements", () => {
  it("computes balances after expenses and payments", () => {
    const balances = computeGroupBalances(
      [A, B, C],
      [
        {
          paidBy: A,
          totalCents: 900,
          splits: [
            { participantId: A, amountCents: 300 },
            { participantId: B, amountCents: 300 },
            { participantId: C, amountCents: 300 },
          ],
        },
      ],
      [
        {
          fromMemberId: B,
          toMemberId: A,
          amountCents: 100,
        },
      ],
    );

    expect(balances[A]).toBe(700);
    expect(balances[B]).toBe(-400);
    expect(balances[C]).toBe(-300);
  });

  it("suggests minimal greedy settlements", () => {
    const suggestions = suggestSettlements({
      [A]: 700,
      [B]: -400,
      [C]: -300,
    });

    expect(suggestions).toEqual([
      { fromMemberId: B, toMemberId: A, amountCents: 400 },
      { fromMemberId: C, toMemberId: A, amountCents: 300 },
    ]);
  });
});
