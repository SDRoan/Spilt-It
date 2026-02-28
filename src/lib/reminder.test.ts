import { describe, expect, it } from "vitest";

import {
  buildInstallmentReminderMessage,
  buildSettlementReminderMessage,
  buildSmsShareUrl,
  buildWhatsAppShareUrl,
  joinAbsoluteUrl,
} from "@/lib/reminder";

describe("reminder helpers", () => {
  it("builds a reminder message with settle link", () => {
    const message = buildSettlementReminderMessage({
      payerName: "Jordan",
      payeeName: "KT",
      amountLabel: "$10.00",
      groupName: "Trip",
      settleLink: "https://split-it.app/g/1?settle=true",
    });

    expect(message).toContain("Jordan");
    expect(message).toContain("KT");
    expect(message).toContain("$10.00");
    expect(message).toContain("Trip");
    expect(message).toContain("https://split-it.app/g/1?settle=true");
  });

  it("builds an installment reminder message with plan summary", () => {
    const message = buildInstallmentReminderMessage({
      payerName: "Jordan",
      payeeName: "KT",
      totalAmountLabel: "$10.00",
      groupName: "Trip",
      planSummary: "1) $5.00 on Feb 28, 2026; 2) $5.00 on Mar 7, 2026",
      firstSettleLink: "https://split-it.app/g/1?settle=installment",
    });

    expect(message).toContain("payment plan");
    expect(message).toContain("$10.00");
    expect(message).toContain("1) $5.00 on Feb 28, 2026");
    expect(message).toContain("https://split-it.app/g/1?settle=installment");
  });

  it("builds share URLs for WhatsApp and SMS", () => {
    const message = "Pay $10 now";
    expect(buildWhatsAppShareUrl(message)).toBe("https://wa.me/?text=Pay%20%2410%20now");
    expect(buildSmsShareUrl(message)).toBe("sms:?&body=Pay%20%2410%20now");
  });

  it("joins base URL with paths and query strings", () => {
    expect(joinAbsoluteUrl("https://split-it.app/", "/g/123")).toBe("https://split-it.app/g/123");
    expect(joinAbsoluteUrl("https://split-it.app", "?a=1")).toBe("https://split-it.app/?a=1");
  });
});
