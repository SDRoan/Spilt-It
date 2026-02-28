"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ExpenseForm } from "@/components/expense-form";
import { computeGroupBalances } from "@/lib/balances";
import {
  buildExpenseBalanceDelta,
  buildWeeklyActionPlan,
  computeMonthlyShareSpend,
  computeResponsibilityScore,
  monthKeyFromDate,
} from "@/lib/financial-coach";
import { buildInstallmentPlan } from "@/lib/installments";
import { centsToAmountString, formatCurrencyFromCents, parseAmountToCents } from "@/lib/money";
import {
  PREVIEW_STORAGE_KEY,
  type FinancialCoachSettings,
  getDefaultPreviewGroup,
  type PreviewRecurringCadence,
  type PreviewRecurringRule,
  type PreviewExpense,
  type PreviewGroup,
} from "@/lib/preview";
import { suggestSettlements } from "@/lib/settle";
import { computeExpenseSplit } from "@/lib/splits";
import type { ExpensePayload } from "@/types/app";

const DEFAULT_COACH_SETTINGS: FinancialCoachSettings = {
  monthlyBudgetCents: 60000,
  maxDebtCents: 20000,
  weeklyPayCapCents: 5000,
};

const RECURRING_CADENCE_OPTIONS: Array<{ value: PreviewRecurringCadence; label: string }> = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toReadableDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseIsoDateParts(value: string): { year: number; month: number; day: number } {
  if (!isIsoDate(value)) {
    throw new Error("Date must be YYYY-MM-DD.");
  }

  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error("Date must be YYYY-MM-DD.");
  }

  return { year, month, day };
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDaysToIsoDate(dateValue: string, days: number): string {
  const parsed = parseIsoDateParts(dateValue);
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonthsToIsoDate(dateValue: string, months: number): string {
  const parsed = parseIsoDateParts(dateValue);
  const absoluteMonth = (parsed.month - 1) + months;
  const nextYear = parsed.year + Math.floor(absoluteMonth / 12);
  const nextMonthIndex = ((absoluteMonth % 12) + 12) % 12;
  const nextMonth = nextMonthIndex + 1;
  const nextDay = Math.min(parsed.day, daysInMonthUtc(nextYear, nextMonth));
  const date = new Date(Date.UTC(nextYear, nextMonthIndex, nextDay));
  return toIsoDate(date);
}

function advanceRecurringDate(dateValue: string, cadence: PreviewRecurringCadence): string {
  return cadence === "weekly"
    ? addDaysToIsoDate(dateValue, 7)
    : addMonthsToIsoDate(dateValue, 1);
}

function normalizePreviewExpense(expense: PreviewExpense): PreviewExpense {
  return {
    ...expense,
    recurrenceRuleId: typeof expense.recurrenceRuleId === "string" ? expense.recurrenceRuleId : null,
    recurrenceDate: typeof expense.recurrenceDate === "string" && isIsoDate(expense.recurrenceDate) ? expense.recurrenceDate : null,
  };
}

function normalizeRecurringRule(rule: PreviewRecurringRule): PreviewRecurringRule | null {
  if (!rule || !rule.id || !isIsoDate(rule.nextExpenseDate)) {
    return null;
  }

  if (rule.cadence !== "weekly" && rule.cadence !== "monthly") {
    return null;
  }

  const normalizedTemplate = normalizePreviewExpense(rule.templateExpense);

  return {
    id: rule.id,
    cadence: rule.cadence,
    nextExpenseDate: rule.nextExpenseDate,
    templateExpense: normalizedTemplate,
    active: rule.active !== false,
    createdAt: rule.createdAt || new Date().toISOString(),
  };
}

function cloneRecurringExpense(rule: PreviewRecurringRule, expenseDate: string): PreviewExpense {
  const itemIdMap = new Map<string, string>();
  const items = rule.templateExpense.items.map((item) => {
    const nextItemId = makeId("item");
    itemIdMap.set(item.id, nextItemId);
    return {
      id: nextItemId,
      name: item.name,
      amountCents: item.amountCents,
    };
  });

  return {
    ...rule.templateExpense,
    id: makeId("exp"),
    expenseDate,
    items,
    splits: rule.templateExpense.splits.map((split) => ({
      participantId: split.participantId,
      amountCents: split.amountCents,
      itemId: split.itemId ? (itemIdMap.get(split.itemId) ?? null) : null,
    })),
    createdAt: new Date().toISOString(),
    recurrenceRuleId: rule.id,
    recurrenceDate: expenseDate,
  };
}

function applyRecurringRules(group: PreviewGroup, asOfDate: string): PreviewGroup {
  if (group.recurringRules.length === 0) {
    return group;
  }

  let didMutate = false;
  let nextExpenses = [...group.expenses];

  const nextRules = group.recurringRules.map((rule) => {
    if (!rule.active) {
      return rule;
    }

    let nextDate = rule.nextExpenseDate;
    let guard = 0;

    while (nextDate <= asOfDate && guard < 400) {
      guard += 1;
      const alreadyExists = nextExpenses.some(
        (expense) => expense.recurrenceRuleId === rule.id && expense.recurrenceDate === nextDate,
      );

      if (!alreadyExists) {
        nextExpenses = [cloneRecurringExpense(rule, nextDate), ...nextExpenses];
        didMutate = true;
      }

      nextDate = advanceRecurringDate(nextDate, rule.cadence);
    }

    if (nextDate !== rule.nextExpenseDate) {
      didMutate = true;
      return {
        ...rule,
        nextExpenseDate: nextDate,
      };
    }

    return rule;
  });

  if (!didMutate) {
    return group;
  }

  return {
    ...group,
    expenses: nextExpenses,
    recurringRules: nextRules,
  };
}

function toMemberId(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function memberNameById(group: PreviewGroup, userId: string): string {
  return group.members.find((member) => member.userId === userId)?.displayName ?? "Unknown";
}

function getCoachSettingsForMember(group: PreviewGroup, memberId: string): FinancialCoachSettings {
  const raw = group.financialCoachByMember?.[memberId];

  return {
    monthlyBudgetCents:
      raw && Number.isInteger(raw.monthlyBudgetCents) && raw.monthlyBudgetCents > 0
        ? raw.monthlyBudgetCents
        : DEFAULT_COACH_SETTINGS.monthlyBudgetCents,
    maxDebtCents:
      raw && Number.isInteger(raw.maxDebtCents) && raw.maxDebtCents > 0
        ? raw.maxDebtCents
        : DEFAULT_COACH_SETTINGS.maxDebtCents,
    weeklyPayCapCents:
      raw && Number.isInteger(raw.weeklyPayCapCents) && raw.weeklyPayCapCents > 0
        ? raw.weeklyPayCapCents
        : DEFAULT_COACH_SETTINGS.weeklyPayCapCents,
  };
}

function splitTotals(expense: PreviewExpense): Record<string, number> {
  return expense.splits.reduce<Record<string, number>>((acc, split) => {
    acc[split.participantId] = (acc[split.participantId] ?? 0) + split.amountCents;
    return acc;
  }, {});
}

function previewExpenseToPayload(expense: PreviewExpense): ExpensePayload {
  const base = {
    description: expense.description,
    date: expense.expenseDate,
    paidBy: expense.paidBy,
    currencyCode: expense.currencyCode,
    notes: expense.notes ?? undefined,
  };

  if (expense.splitMode === "equal") {
    return {
      ...base,
      mode: "equal",
      totalCents: expense.totalCents,
      participants: Array.from(new Set(expense.splits.map((split) => split.participantId))),
    };
  }

  if (expense.splitMode === "exact") {
    return {
      ...base,
      mode: "exact",
      totalCents: expense.totalCents,
      allocations: Object.entries(splitTotals(expense)).map(([memberId, amountCents]) => ({
        memberId,
        amountCents,
      })),
    };
  }

  if (expense.splitMode === "percent") {
    return {
      ...base,
      mode: "percent",
      totalCents: expense.totalCents,
      allocations: Object.entries(splitTotals(expense)).map(([memberId, amountCents]) => ({
        memberId,
        percent: Number(((amountCents / expense.totalCents) * 100).toFixed(2)),
      })),
    };
  }

  if (expense.splitMode === "shares") {
    return {
      ...base,
      mode: "shares",
      totalCents: expense.totalCents,
      allocations: Object.entries(splitTotals(expense)).map(([memberId, amountCents]) => ({
        memberId,
        shares: Number((amountCents / 100).toFixed(2)),
      })),
    };
  }

  return {
    ...base,
    mode: "itemized",
    items: expense.items.map((item) => ({
      name: item.name,
      amountCents: item.amountCents,
      memberIds: Array.from(
        new Set(
          expense.splits
            .filter((split) => split.itemId === item.id)
            .map((split) => split.participantId),
        ),
      ),
    })),
  };
}

function parsePayloadFromForm(formData: FormData): ExpensePayload {
  const rawPayload = formData.get("payload");

  if (typeof rawPayload !== "string") {
    throw new Error("Missing expense payload.");
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(rawPayload);
  } catch {
    throw new Error("Expense payload is invalid.");
  }

  return payloadJson as ExpensePayload;
}

interface ReceiptDraft {
  recipientName: string;
  title: string;
  message: string;
  footer: string;
}

function sanitizeFileName(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    const words = paragraph.split(" ").filter((word) => word.length > 0);

    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const next = `${current} ${words[i]}`;
      if (context.measureText(next).width <= maxWidth) {
        current = next;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }

  return lines;
}

function buildDefaultReceiptMessage(
  group: PreviewGroup,
  expense: PreviewExpense,
  recipientName: string,
): string {
  const payerName = memberNameById(group, expense.paidBy);

  return [
    `Hi ${recipientName || "there"},`,
    "",
    `Here is your receipt for "${expense.description}".`,
    `Paid by: ${payerName}`,
    `Date: ${new Date(expense.expenseDate).toLocaleDateString("en-US", { dateStyle: "medium" })}`,
    `Total: ${formatCurrencyFromCents(expense.totalCents, expense.currencyCode)}`,
    "",
    "Thanks,",
    payerName,
  ].join("\n");
}

function buildReceiptCanvas(group: PreviewGroup, expense: PreviewExpense, draft: ReceiptDraft): HTMLCanvasElement {
  const totals = Object.entries(splitTotals(expense));
  const payerName = memberNameById(group, expense.paidBy);
  const wrappedMessageSeed = draft.message.trim().length > 0 ? draft.message.trim() : "Thank you.";

  const width = 1200;
  const sidePadding = 76;
  const contentWidth = width - sidePadding * 2;

  const tempCanvas = document.createElement("canvas");
  const tempContext = tempCanvas.getContext("2d");
  if (!tempContext) {
    throw new Error("Could not prepare receipt canvas.");
  }

  tempContext.font = "400 30px 'Avenir Next', 'Segoe UI', sans-serif";
  const wrappedMessage = wrapCanvasText(tempContext, wrappedMessageSeed, contentWidth);
  const wrappedNotes =
    expense.notes && expense.notes.trim().length > 0
      ? wrapCanvasText(tempContext, expense.notes.trim(), contentWidth)
      : [];

  const baseHeight = 760;
  const totalsHeight = totals.length * 56;
  const notesHeight = wrappedNotes.length > 0 ? wrappedNotes.length * 42 + 54 : 0;
  const messageHeight = wrappedMessage.length * 42 + 54;
  const itemBlockHeight = expense.items.length > 0 ? expense.items.length * 44 + 60 : 0;
  const height = baseHeight + totalsHeight + notesHeight + messageHeight + itemBlockHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not build receipt image.");
  }

  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#ffffff";
  context.fillRect(30, 30, width - 60, height - 60);

  let y = 76;

  context.fillStyle = "#0f172a";
  context.font = "700 52px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("Split It", sidePadding, y);
  y += 66;

  context.fillStyle = "#334155";
  context.font = "500 34px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(draft.title || "Payment Receipt", sidePadding, y);
  y += 58;

  context.font = "400 28px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillStyle = "#475569";
  context.fillText(
    `Recipient: ${draft.recipientName || "Not specified"}${" ".repeat(4)}Date: ${new Date().toLocaleDateString("en-US", { dateStyle: "medium" })}`,
    sidePadding,
    y,
  );
  y += 52;

  context.strokeStyle = "#cbd5e1";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(sidePadding, y);
  context.lineTo(width - sidePadding, y);
  context.stroke();
  y += 36;

  context.font = "600 34px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillStyle = "#0f172a";
  context.fillText(expense.description, sidePadding, y);
  y += 46;

  context.font = "400 28px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillStyle = "#334155";
  context.fillText(`Paid by: ${payerName}`, sidePadding, y);
  y += 38;
  context.fillText(
    `Expense date: ${new Date(expense.expenseDate).toLocaleDateString("en-US", { dateStyle: "medium" })}`,
    sidePadding,
    y,
  );
  y += 38;
  context.fillText(`Split mode: ${expense.splitMode}`, sidePadding, y);
  y += 56;

  context.font = "700 42px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillStyle = "#0f172a";
  context.fillText(`Total: ${formatCurrencyFromCents(expense.totalCents, expense.currencyCode)}`, sidePadding, y);
  y += 66;

  context.font = "600 30px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("Per-member breakdown", sidePadding, y);
  y += 46;

  context.font = "400 29px 'Avenir Next', 'Segoe UI', sans-serif";
  totals.forEach(([memberId, amountCents]) => {
    context.fillStyle = "#334155";
    context.fillText(memberNameById(group, memberId), sidePadding, y);
    context.fillStyle = "#0f172a";
    context.textAlign = "right";
    context.fillText(
      formatCurrencyFromCents(amountCents, expense.currencyCode),
      width - sidePadding,
      y,
    );
    context.textAlign = "left";
    y += 56;
  });

  if (expense.items.length > 0) {
    y += 16;
    context.fillStyle = "#0f172a";
    context.font = "600 30px 'Avenir Next', 'Segoe UI', sans-serif";
    context.fillText("Items", sidePadding, y);
    y += 44;

    context.font = "400 29px 'Avenir Next', 'Segoe UI', sans-serif";
    expense.items.forEach((item) => {
      context.fillStyle = "#334155";
      context.fillText(item.name, sidePadding, y);
      context.fillStyle = "#0f172a";
      context.textAlign = "right";
      context.fillText(
        formatCurrencyFromCents(item.amountCents, expense.currencyCode),
        width - sidePadding,
        y,
      );
      context.textAlign = "left";
      y += 44;
    });
  }

  y += 20;
  context.fillStyle = "#0f172a";
  context.font = "600 30px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("Message", sidePadding, y);
  y += 44;

  context.font = "400 30px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillStyle = "#334155";
  wrappedMessage.forEach((line) => {
    context.fillText(line, sidePadding, y);
    y += 42;
  });

  if (wrappedNotes.length > 0) {
    y += 14;
    context.fillStyle = "#0f172a";
    context.font = "600 30px 'Avenir Next', 'Segoe UI', sans-serif";
    context.fillText("Expense note", sidePadding, y);
    y += 44;

    context.font = "400 30px 'Avenir Next', 'Segoe UI', sans-serif";
    context.fillStyle = "#334155";
    wrappedNotes.forEach((line) => {
      context.fillText(line, sidePadding, y);
      y += 42;
    });
  }

  y += 20;
  context.strokeStyle = "#cbd5e1";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(sidePadding, y);
  context.lineTo(width - sidePadding, y);
  context.stroke();
  y += 46;

  context.fillStyle = "#475569";
  context.font = "400 26px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(
    draft.footer || "Generated by Split It",
    sidePadding,
    y,
  );

  return canvas;
}

export function PreviewWorkspace() {
  const [group, setGroup] = useState<PreviewGroup>(() => getDefaultPreviewGroup());
  const [loaded, setLoaded] = useState(false);

  const [newMemberName, setNewMemberName] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);

  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [receiptExpenseId, setReceiptExpenseId] = useState<string | null>(null);
  const [receiptRecipientName, setReceiptRecipientName] = useState("");
  const [receiptTitle, setReceiptTitle] = useState("");
  const [receiptMessage, setReceiptMessage] = useState("");
  const [receiptFooter, setReceiptFooter] = useState("");
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptStatus, setReceiptStatus] = useState<string | null>(null);
  const [isGeneratingReceipt, setIsGeneratingReceipt] = useState(false);

  const [paymentFrom, setPaymentFrom] = useState(group.members[0]?.userId ?? "");
  const [paymentTo, setPaymentTo] = useState(group.members[1]?.userId ?? group.members[0]?.userId ?? "");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayDate());
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [didApplySettleParams, setDidApplySettleParams] = useState(false);
  const [recurringSourceExpenseId, setRecurringSourceExpenseId] = useState("");
  const [recurringCadence, setRecurringCadence] = useState<PreviewRecurringCadence>("monthly");
  const [recurringStartDate, setRecurringStartDate] = useState(todayDate());
  const [recurringError, setRecurringError] = useState<string | null>(null);
  const [recurringStatus, setRecurringStatus] = useState<string | null>(null);
  const [showRecurringPanel, setShowRecurringPanel] = useState(false);

  const [coachMemberId, setCoachMemberId] = useState(group.members[0]?.userId ?? "");
  const [coachMonthlyBudget, setCoachMonthlyBudget] = useState(
    centsToAmountString(DEFAULT_COACH_SETTINGS.monthlyBudgetCents),
  );
  const [coachMaxDebt, setCoachMaxDebt] = useState(centsToAmountString(DEFAULT_COACH_SETTINGS.maxDebtCents));
  const [coachWeeklyPayCap, setCoachWeeklyPayCap] = useState(
    centsToAmountString(DEFAULT_COACH_SETTINGS.weeklyPayCapCents),
  );
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachStatus, setCoachStatus] = useState<string | null>(null);
  const [showFinancialCoachPanel, setShowFinancialCoachPanel] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PreviewGroup;
        if (parsed && Array.isArray(parsed.members) && Array.isArray(parsed.expenses) && Array.isArray(parsed.payments)) {
          const normalized: PreviewGroup = {
            ...parsed,
            expenses: parsed.expenses.map((expense) => normalizePreviewExpense(expense as PreviewExpense)),
            recurringRules: Array.isArray(parsed.recurringRules)
              ? (parsed.recurringRules
                  .map((rule) => normalizeRecurringRule(rule as PreviewRecurringRule))
                  .filter((rule): rule is PreviewRecurringRule => rule !== null))
              : [],
            financialCoachByMember: parsed.financialCoachByMember ?? {},
          };

          setGroup(applyRecurringRules(normalized, todayDate()));
        }
      }
    } catch {
      // If local storage payload is invalid, fall back to defaults.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(group));
  }, [group, loaded]);

  useEffect(() => {
    const memberIds = new Set(group.members.map((member) => member.userId));

    if (!memberIds.has(paymentFrom)) {
      setPaymentFrom(group.members[0]?.userId ?? "");
    }

    if (!memberIds.has(paymentTo) || paymentTo === paymentFrom) {
      const fallback = group.members.find((member) => member.userId !== paymentFrom)?.userId;
      setPaymentTo(fallback ?? group.members[0]?.userId ?? "");
    }

    if (!memberIds.has(coachMemberId)) {
      setCoachMemberId(group.members[0]?.userId ?? "");
    }
  }, [coachMemberId, group.members, paymentFrom, paymentTo]);

  useEffect(() => {
    if (!coachMemberId) {
      return;
    }

    const raw = group.financialCoachByMember?.[coachMemberId];
    const nextSettings: FinancialCoachSettings = {
      monthlyBudgetCents:
        raw && Number.isInteger(raw.monthlyBudgetCents) && raw.monthlyBudgetCents > 0
          ? raw.monthlyBudgetCents
          : DEFAULT_COACH_SETTINGS.monthlyBudgetCents,
      maxDebtCents:
        raw && Number.isInteger(raw.maxDebtCents) && raw.maxDebtCents > 0
          ? raw.maxDebtCents
          : DEFAULT_COACH_SETTINGS.maxDebtCents,
      weeklyPayCapCents:
        raw && Number.isInteger(raw.weeklyPayCapCents) && raw.weeklyPayCapCents > 0
          ? raw.weeklyPayCapCents
          : DEFAULT_COACH_SETTINGS.weeklyPayCapCents,
    };

    setCoachMonthlyBudget(centsToAmountString(nextSettings.monthlyBudgetCents));
    setCoachMaxDebt(centsToAmountString(nextSettings.maxDebtCents));
    setCoachWeeklyPayCap(centsToAmountString(nextSettings.weeklyPayCapCents));
  }, [coachMemberId, group.financialCoachByMember]);

  useEffect(() => {
    if (!loaded || didApplySettleParams) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const settleFrom = searchParams.get("settleFrom")?.trim() ?? "";
    const settleTo = searchParams.get("settleTo")?.trim() ?? "";
    const settleAmount = searchParams.get("settleAmount")?.trim() ?? "";
    const settleDate = searchParams.get("settleDate")?.trim() ?? "";
    const settleNote = searchParams.get("settleNote")?.trim() ?? "";
    const hasSettleParams = Boolean(settleFrom || settleTo || settleAmount || settleDate || settleNote);

    if (!hasSettleParams) {
      setDidApplySettleParams(true);
      return;
    }

    const memberIds = new Set(group.members.map((member) => member.userId));

    if (memberIds.has(settleFrom)) {
      setPaymentFrom(settleFrom);
    }

    if (memberIds.has(settleTo)) {
      setPaymentTo(settleTo);
    }

    if (settleAmount) {
      try {
        parseAmountToCents(settleAmount);
        setPaymentAmount(settleAmount);
      } catch {
        // Ignore invalid prefilled amount.
      }
    }

    if (settleDate && isIsoDate(settleDate)) {
      setPaymentDate(settleDate);
    }

    if (settleNote) {
      setPaymentNote(settleNote);
    }

    setPaymentError(null);
    setDidApplySettleParams(true);
  }, [didApplySettleParams, group.members, loaded]);

  useEffect(() => {
    if (receiptExpenseId && !group.expenses.some((expense) => expense.id === receiptExpenseId)) {
      setReceiptExpenseId(null);
      setReceiptError(null);
      setReceiptStatus(null);
    }
  }, [group.expenses, receiptExpenseId]);

  useEffect(() => {
    if (group.expenses.length === 0) {
      setRecurringSourceExpenseId("");
      setRecurringStartDate(todayDate());
      return;
    }

    const selected = group.expenses.find((expense) => expense.id === recurringSourceExpenseId);
    const source = selected ?? group.expenses[0];
    if (!source) {
      return;
    }

    if (!selected) {
      setRecurringSourceExpenseId(source.id);
    }

    setRecurringStartDate(advanceRecurringDate(source.expenseDate, recurringCadence));
  }, [group.expenses, recurringCadence, recurringSourceExpenseId]);

  const balances = useMemo(
    () =>
      computeGroupBalances(
        group.members.map((member) => member.userId),
        group.expenses.map((expense) => ({
          paidBy: expense.paidBy,
          totalCents: expense.totalCents,
          splits: expense.splits.map((split) => ({
            participantId: split.participantId,
            amountCents: split.amountCents,
          })),
        })),
        group.payments.map((payment) => ({
          fromMemberId: payment.fromMemberId,
          toMemberId: payment.toMemberId,
          amountCents: payment.amountCents,
        })),
      ),
    [group],
  );

  const suggestions = useMemo(() => suggestSettlements(balances), [balances]);

  const sortedExpenses = useMemo(
    () =>
      [...group.expenses].sort((a, b) => {
        if (a.expenseDate !== b.expenseDate) {
          return b.expenseDate.localeCompare(a.expenseDate);
        }

        return b.createdAt.localeCompare(a.createdAt);
      }),
    [group.expenses],
  );

  const sortedPayments = useMemo(
    () =>
      [...group.payments].sort((a, b) => {
        if (a.paymentDate !== b.paymentDate) {
          return b.paymentDate.localeCompare(a.paymentDate);
        }

        return b.createdAt.localeCompare(a.createdAt);
      }),
    [group.payments],
  );

  const editingExpense = editingExpenseId
    ? group.expenses.find((expense) => expense.id === editingExpenseId) ?? null
    : null;
  const receiptExpense = receiptExpenseId
    ? group.expenses.find((expense) => expense.id === receiptExpenseId) ?? null
    : null;

  const monthKey = monthKeyFromDate(todayDate());
  const selectedCoachSettings = coachMemberId
    ? getCoachSettingsForMember(group, coachMemberId)
    : DEFAULT_COACH_SETTINGS;
  const monthlyShareSpendCents = coachMemberId
    ? computeMonthlyShareSpend(group.expenses, coachMemberId, monthKey)
    : 0;
  const coachBalanceCents = coachMemberId ? (balances[coachMemberId] ?? 0) : 0;
  const owedCents = Math.max(0, -coachBalanceCents);
  const recentOutgoingPayments = coachMemberId
    ? group.payments.filter((payment) => {
        if (payment.fromMemberId !== coachMemberId) {
          return false;
        }

        const paymentDate = new Date(`${payment.paymentDate}T00:00:00Z`);
        const cutoff = new Date(`${todayDate()}T00:00:00Z`);
        cutoff.setUTCDate(cutoff.getUTCDate() - 30);
        return paymentDate >= cutoff;
      }).length
    : 0;
  const responsibilityScore = computeResponsibilityScore({
    owedCents,
    maxDebtCents: selectedCoachSettings.maxDebtCents,
    monthlyShareSpendCents,
    monthlyBudgetCents: selectedCoachSettings.monthlyBudgetCents,
    recentOutgoingPaymentsCount: recentOutgoingPayments,
  });
  const weeklyPlan = buildWeeklyActionPlan(owedCents, selectedCoachSettings.weeklyPayCapCents, todayDate());
  const monthlyUsagePercent =
    selectedCoachSettings.monthlyBudgetCents > 0
      ? Math.round((monthlyShareSpendCents / selectedCoachSettings.monthlyBudgetCents) * 100)
      : 0;
  const scoreToneClass =
    responsibilityScore >= 80
      ? "text-emerald-700"
      : responsibilityScore >= 60
        ? "text-amber-700"
        : "text-rose-700";

  function handleSaveCoachSettings(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setCoachError(null);
    setCoachStatus(null);

    try {
      if (!coachMemberId) {
        throw new Error("Select a member first.");
      }

      const monthlyBudgetCents = parseAmountToCents(coachMonthlyBudget);
      const maxDebtCents = parseAmountToCents(coachMaxDebt);
      const weeklyPayCapCents = parseAmountToCents(coachWeeklyPayCap);

      setGroup((current) => ({
        ...current,
        financialCoachByMember: {
          ...(current.financialCoachByMember ?? {}),
          [coachMemberId]: {
            monthlyBudgetCents,
            maxDebtCents,
            weeklyPayCapCents,
          },
        },
      }));

      setCoachStatus("Financial guardrails saved.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not save coach settings.";
      setCoachError(message);
    }
  }

  async function handleSaveExpense(formData: FormData): Promise<void> {
    const payload = parsePayloadFromForm(formData);

    const memberIds = new Set(group.members.map((member) => member.userId));

    if (!memberIds.has(payload.paidBy)) {
      throw new Error("Payer must be a member.");
    }

    if (payload.currencyCode !== group.currencyCode) {
      throw new Error(`Currency must stay ${group.currencyCode} for this group.`);
    }

    let computed;

    switch (payload.mode) {
      case "equal":
        payload.participants.forEach((memberId) => {
          if (!memberIds.has(memberId)) {
            throw new Error("One or more selected members are not in the group.");
          }
        });

        computed = computeExpenseSplit({
          mode: "equal",
          totalCents: payload.totalCents,
          participants: payload.participants,
        });
        break;

      case "exact":
        payload.allocations.forEach((entry) => {
          if (!memberIds.has(entry.memberId)) {
            throw new Error("One or more selected members are not in the group.");
          }
        });

        computed = computeExpenseSplit({
          mode: "exact",
          totalCents: payload.totalCents,
          exactAllocations: payload.allocations,
        });
        break;

      case "percent":
        payload.allocations.forEach((entry) => {
          if (!memberIds.has(entry.memberId)) {
            throw new Error("One or more selected members are not in the group.");
          }
        });

        computed = computeExpenseSplit({
          mode: "percent",
          totalCents: payload.totalCents,
          percentAllocations: payload.allocations,
        });
        break;

      case "shares":
        payload.allocations.forEach((entry) => {
          if (!memberIds.has(entry.memberId)) {
            throw new Error("One or more selected members are not in the group.");
          }
        });

        computed = computeExpenseSplit({
          mode: "shares",
          totalCents: payload.totalCents,
          shareAllocations: payload.allocations,
        });
        break;

      case "itemized":
        payload.items.forEach((item) => {
          item.memberIds.forEach((memberId) => {
            if (!memberIds.has(memberId)) {
              throw new Error("One or more selected members are not in the group.");
            }
          });
        });

        computed = computeExpenseSplit({
          mode: "itemized",
          itemizedItems: payload.items,
        });
        break;

      default:
        throw new Error("Unsupported split mode.");
    }

    const itemIdsByIndex: string[] = [];
    const items =
      payload.mode === "itemized"
        ? payload.items.map((item) => {
            const id = makeId("item");
            itemIdsByIndex.push(id);

            return {
              id,
              name: item.name,
              amountCents: item.amountCents,
            };
          })
        : [];

    const expenseId = editingExpenseId ?? makeId("exp");
    const existingExpense = group.expenses.find((expense) => expense.id === expenseId);

    const nextSplits = computed.splitRows.map((split) => ({
      participantId: split.memberId,
      amountCents: split.amountCents,
      itemId:
        typeof split.itemIndex === "number" && payload.mode === "itemized"
          ? (itemIdsByIndex[split.itemIndex] ?? null)
          : null,
    }));

    const newDelta = buildExpenseBalanceDelta(payload.paidBy, computed.totalCents, nextSplits);
    const oldDelta = existingExpense
      ? buildExpenseBalanceDelta(existingExpense.paidBy, existingExpense.totalCents, existingExpense.splits)
      : {};

    const guardViolations: string[] = [];

    for (const member of group.members) {
      if (!group.financialCoachByMember?.[member.userId]) {
        continue;
      }

      const settings = getCoachSettingsForMember(group, member.userId);
      const projectedBalance = (balances[member.userId] ?? 0) + (newDelta[member.userId] ?? 0) - (oldDelta[member.userId] ?? 0);
      const projectedDebt = Math.max(0, -projectedBalance);

      if (projectedDebt > settings.maxDebtCents) {
        guardViolations.push(
          `Budget guard: ${member.displayName} would owe ${formatCurrencyFromCents(projectedDebt, group.currencyCode)} (limit ${formatCurrencyFromCents(settings.maxDebtCents, group.currencyCode)}).`,
        );
      }

      const month = payload.date.slice(0, 7);
      const expensesWithoutEditing = group.expenses.filter((expense) => expense.id !== expenseId);
      const currentMonthShareSpend = computeMonthlyShareSpend(expensesWithoutEditing, member.userId, month);
      const nextMemberShare = nextSplits.reduce(
        (sum, split) => (split.participantId === member.userId ? sum + split.amountCents : sum),
        0,
      );
      const projectedMonthShareSpend = currentMonthShareSpend + nextMemberShare;

      if (projectedMonthShareSpend > settings.monthlyBudgetCents) {
        guardViolations.push(
          `Budget guard: ${member.displayName}'s monthly share would become ${formatCurrencyFromCents(projectedMonthShareSpend, group.currencyCode)} (budget ${formatCurrencyFromCents(settings.monthlyBudgetCents, group.currencyCode)}).`,
        );
      }
    }

    if (guardViolations.length > 0) {
      throw new Error(guardViolations[0]);
    }

    const nextExpense: PreviewExpense = {
      id: expenseId,
      description: payload.description,
      expenseDate: payload.date,
      paidBy: payload.paidBy,
      currencyCode: payload.currencyCode,
      totalCents: computed.totalCents,
      notes: payload.notes ?? null,
      splitMode: payload.mode,
      items,
      splits: nextSplits,
      createdAt: existingExpense?.createdAt ?? new Date().toISOString(),
      recurrenceRuleId: existingExpense?.recurrenceRuleId ?? null,
      recurrenceDate: existingExpense?.recurrenceDate ?? null,
    };

    setGroup((current) => {
      const hasExisting = current.expenses.some((expense) => expense.id === expenseId);

      return {
        ...current,
        expenses: hasExisting
          ? current.expenses.map((expense) => (expense.id === expenseId ? nextExpense : expense))
          : [nextExpense, ...current.expenses],
      };
    });

    setShowExpenseForm(false);
    setEditingExpenseId(null);
  }

  function startAddExpense(): void {
    if (group.members.length === 0) {
      setMemberError("Add at least one member before adding an expense.");
      return;
    }

    setEditingExpenseId(null);
    setShowExpenseForm(true);
  }

  function startEditExpense(expenseId: string): void {
    setEditingExpenseId(expenseId);
    setShowExpenseForm(true);
  }

  function handleDeleteExpense(expenseId: string): void {
    if (!window.confirm("Delete this expense?")) {
      return;
    }

    setGroup((current) => ({
      ...current,
      expenses: current.expenses.filter((expense) => expense.id !== expenseId),
    }));

    if (editingExpenseId === expenseId) {
      setEditingExpenseId(null);
      setShowExpenseForm(false);
    }
  }

  function startReceiptBuilder(expense: PreviewExpense): void {
    const defaultRecipientId =
      expense.splits.find((split) => split.participantId !== expense.paidBy)?.participantId ??
      group.members.find((member) => member.userId !== expense.paidBy)?.userId ??
      "";
    const defaultRecipientName = defaultRecipientId ? memberNameById(group, defaultRecipientId) : "";
    const payerName = memberNameById(group, expense.paidBy);

    setReceiptExpenseId(expense.id);
    setReceiptRecipientName(defaultRecipientName);
    setReceiptTitle(`Receipt - ${expense.description}`);
    setReceiptMessage(buildDefaultReceiptMessage(group, expense, defaultRecipientName));
    setReceiptFooter(`Issued by ${payerName} on ${new Date().toLocaleDateString("en-US", { dateStyle: "medium" })}`);
    setReceiptError(null);
    setReceiptStatus(null);
  }

  function closeReceiptBuilder(): void {
    setReceiptExpenseId(null);
    setReceiptError(null);
    setReceiptStatus(null);
  }

  async function downloadReceipt(format: "png" | "pdf"): Promise<void> {
    if (!receiptExpense) {
      setReceiptError("Choose an expense first.");
      return;
    }

    setReceiptError(null);
    setReceiptStatus(null);
    setIsGeneratingReceipt(true);

    try {
      const canvas = buildReceiptCanvas(group, receiptExpense, {
        recipientName: receiptRecipientName.trim(),
        title: receiptTitle.trim() || `Receipt - ${receiptExpense.description}`,
        message: receiptMessage.trim(),
        footer: receiptFooter.trim(),
      });

      const fileBase = sanitizeFileName(
        `${receiptExpense.description}-${receiptExpense.expenseDate}-${format}`,
      );

      if (format === "png") {
        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = `${fileBase || "receipt"}.png`;
        link.click();
        setReceiptStatus("PNG receipt downloaded.");
        return;
      }

      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? "landscape" : "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      });

      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`${fileBase || "receipt"}.pdf`);
      setReceiptStatus("PDF receipt downloaded.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to download receipt.";
      setReceiptError(message);
    } finally {
      setIsGeneratingReceipt(false);
    }
  }

  function handleAddMember(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setMemberError(null);

    const displayName = newMemberName.trim();

    if (displayName.length < 2) {
      setMemberError("Member name must be at least 2 characters.");
      return;
    }

    const memberIdBase = toMemberId(displayName);
    if (!memberIdBase) {
      setMemberError("Member name must contain letters or numbers.");
      return;
    }

    const memberId = `${memberIdBase}-${Math.random().toString(16).slice(2, 8)}`;

    setGroup((current) => ({
      ...current,
      members: [...current.members, { userId: memberId, displayName }],
    }));

    setNewMemberName("");
  }

  function handleAddPayment(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPaymentError(null);

    try {
      const amountCents = parseAmountToCents(paymentAmount);

      if (!paymentFrom || !paymentTo) {
        throw new Error("Choose both payer and receiver.");
      }

      if (paymentFrom === paymentTo) {
        throw new Error("Payer and receiver must be different.");
      }

      const memberIds = new Set(group.members.map((member) => member.userId));
      if (!memberIds.has(paymentFrom) || !memberIds.has(paymentTo)) {
        throw new Error("Payment members must exist in the group.");
      }

      setGroup((current) => ({
        ...current,
        payments: [
          {
            id: makeId("pay"),
            fromMemberId: paymentFrom,
            toMemberId: paymentTo,
            amountCents,
            paymentDate,
            note: paymentNote.trim() || null,
            createdAt: new Date().toISOString(),
          },
          ...current.payments,
        ],
      }));

      setPaymentAmount("");
      setPaymentNote("");
      setPaymentDate(todayDate());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to add payment.";
      setPaymentError(message);
    }
  }

  function prefillPaymentDraft(input: {
    fromMemberId: string;
    toMemberId: string;
    amountCents: number;
    paymentDate?: string;
    note?: string;
  }): void {
    const memberIds = new Set(group.members.map((member) => member.userId));
    if (!memberIds.has(input.fromMemberId) || !memberIds.has(input.toMemberId) || input.fromMemberId === input.toMemberId) {
      setPaymentError("Payment members must exist in the group.");
      return;
    }

    setPaymentFrom(input.fromMemberId);
    setPaymentTo(input.toMemberId);
    setPaymentAmount(centsToAmountString(input.amountCents));
    setPaymentDate(input.paymentDate && isIsoDate(input.paymentDate) ? input.paymentDate : todayDate());
    setPaymentNote(input.note?.trim() ?? "");
    setPaymentError(null);

    requestAnimationFrame(() => {
      document.getElementById("record-payment")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function prefillRecurringFromExpense(expenseId: string): void {
    const sourceExpense = group.expenses.find((expense) => expense.id === expenseId);
    if (!sourceExpense) {
      return;
    }

    setShowRecurringPanel(true);
    setRecurringCadence("monthly");
    setRecurringSourceExpenseId(sourceExpense.id);
    setRecurringStartDate(addMonthsToIsoDate(sourceExpense.expenseDate, 1));
    setRecurringError(null);
    setRecurringStatus(`Ready to repeat "${sourceExpense.description}" monthly.`);
  }

  function handleCreateRecurringRule(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setRecurringError(null);
    setRecurringStatus(null);

    try {
      const sourceExpense = group.expenses.find((expense) => expense.id === recurringSourceExpenseId);
      if (!sourceExpense) {
        throw new Error("Choose an expense template.");
      }

      if (!isIsoDate(recurringStartDate)) {
        throw new Error("Choose a valid next date.");
      }

      const rule: PreviewRecurringRule = {
        id: makeId("recur"),
        cadence: recurringCadence,
        nextExpenseDate: recurringStartDate,
        templateExpense: normalizePreviewExpense(sourceExpense),
        active: true,
        createdAt: new Date().toISOString(),
      };

      setGroup((current) =>
        applyRecurringRules(
          {
            ...current,
            recurringRules: [rule, ...current.recurringRules],
          },
          todayDate(),
        ),
      );

      setRecurringStatus("Recurring expense rule created.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not create recurring rule.";
      setRecurringError(message);
    }
  }

  function handleDeleteRecurringRule(ruleId: string): void {
    if (!window.confirm("Delete this recurring expense rule?")) {
      return;
    }

    setGroup((current) => ({
      ...current,
      recurringRules: current.recurringRules.filter((rule) => rule.id !== ruleId),
    }));
    setRecurringError(null);
    setRecurringStatus("Recurring expense rule deleted.");
  }

  if (!loaded) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-12">
        <p className="text-sm text-slate-600">Loading Split It...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="mt-1 font-display text-3xl font-bold text-slate-900">Split It</h1>
          <p className="text-sm text-slate-600">
            Group: {group.name}. Your changes persist locally in this browser.
          </p>
        </div>
        <Link
          href="/settings"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Settings
        </Link>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Members</h2>
              <span className="text-xs text-slate-500">{group.members.length} members</span>
            </div>

            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {group.members.map((member) => (
                <li key={member.userId} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-900">{member.displayName}</span>
                </li>
              ))}
            </ul>

            <form onSubmit={handleAddMember} className="mt-4 flex flex-wrap gap-2">
              <input
                value={newMemberName}
                onChange={(event) => setNewMemberName(event.target.value)}
                placeholder="Add member name"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Add member
              </button>
            </form>
            {memberError ? <p className="mt-2 text-sm text-rose-700">{memberError}</p> : null}
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Expenses</h2>
              <button
                type="button"
                onClick={startAddExpense}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={group.members.length === 0}
              >
                Add expense
              </button>
            </div>

            {group.members.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">Add members first, then create expenses.</p>
            ) : null}

            {showExpenseForm ? (
              <div className="mt-4 rounded-lg border border-slate-200 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-900">
                    {editingExpense ? "Edit expense" : "New expense"}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowExpenseForm(false);
                      setEditingExpenseId(null);
                    }}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    Cancel
                  </button>
                </div>

                <ExpenseForm
                  groupId={group.id}
                  currencyCode={group.currencyCode}
                  members={group.members}
                  submitAction={handleSaveExpense}
                  expenseId={editingExpense?.id}
                  defaultPayload={editingExpense ? previewExpenseToPayload(editingExpense) : undefined}
                  submitLabel={editingExpense ? "Update expense" : "Create expense"}
                />
              </div>
            ) : null}

            {receiptExpense ? (
              <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/40 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Receipt Generator</h3>
                    <p className="text-sm text-slate-600">
                      Expense: <span className="font-medium">{receiptExpense.description}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeReceiptBuilder}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    Close
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-sm text-slate-700">Recipient name</span>
                    <input
                      value={receiptRecipientName}
                      onChange={(event) => setReceiptRecipientName(event.target.value)}
                      placeholder="Dave"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-sm text-slate-700">Receipt title</span>
                    <input
                      value={receiptTitle}
                      onChange={(event) => setReceiptTitle(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <label className="mt-3 block space-y-1">
                  <span className="text-sm text-slate-700">Custom message</span>
                  <textarea
                    value={receiptMessage}
                    onChange={(event) => setReceiptMessage(event.target.value)}
                    rows={5}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="mt-3 block space-y-1">
                  <span className="text-sm text-slate-700">Footer note</span>
                  <input
                    value={receiptFooter}
                    onChange={(event) => setReceiptFooter(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                {receiptError ? <p className="mt-3 text-sm text-rose-700">{receiptError}</p> : null}
                {receiptStatus ? <p className="mt-3 text-sm text-emerald-700">{receiptStatus}</p> : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void downloadReceipt("png")}
                    disabled={isGeneratingReceipt}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    Download PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadReceipt("pdf")}
                    disabled={isGeneratingReceipt}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  >
                    Download PDF
                  </button>
                </div>
              </div>
            ) : null}

            {sortedExpenses.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No expenses yet. Add one to start splitting.</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {sortedExpenses.map((expense) => {
                  const totals = splitTotals(expense);

                  return (
                    <li key={expense.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-slate-900">{expense.description}</h3>
                          <p className="text-sm text-slate-600">
                            {new Date(expense.expenseDate).toLocaleDateString("en-US", { dateStyle: "medium" })} · Paid by{" "}
                            {memberNameById(group, expense.paidBy)}
                          </p>
                          <p className="text-sm text-slate-600">Mode: {expense.splitMode}</p>
                          {expense.recurrenceRuleId ? (
                            <p className="text-xs text-slate-500">
                              Auto-generated recurring expense
                              {expense.recurrenceDate ? ` · ${toReadableDate(expense.recurrenceDate)}` : ""}.
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="text-base font-semibold text-slate-900">
                            {formatCurrencyFromCents(expense.totalCents, group.currencyCode)}
                          </p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => prefillRecurringFromExpense(expense.id)}
                              className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700"
                            >
                              Repeat
                            </button>
                            <button
                              type="button"
                              onClick={() => startReceiptBuilder(expense)}
                              className="rounded-md border border-sky-300 px-2.5 py-1 text-xs font-medium text-sky-700"
                            >
                              Receipt
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditExpense(expense.id)}
                              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteExpense(expense.id)}
                              className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 rounded-md bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Per-member breakdown</p>
                        <ul className="mt-2 space-y-1 text-sm text-slate-700">
                          {Object.entries(totals).map(([memberId, amountCents]) => (
                            <li key={memberId} className="flex items-center justify-between gap-2">
                              <span>{memberNameById(group, memberId)}</span>
                              <span>{formatCurrencyFromCents(amountCents, group.currencyCode)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </div>

        <div className="space-y-6">
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Recurring expenses</h2>
              <button
                type="button"
                onClick={() => setShowRecurringPanel((current) => !current)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {showRecurringPanel ? "Hide" : "Show"}
              </button>
            </div>

            {showRecurringPanel ? (
              <>
                <p className="mt-2 text-sm text-slate-600">
                  Reuse an existing expense as a template and auto-create it on a weekly or monthly cadence.
                </p>

                {group.expenses.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-600">Add at least one expense before creating a recurring rule.</p>
                ) : (
                  <form onSubmit={handleCreateRecurringRule} className="mt-3 space-y-3">
                    <label className="block space-y-1">
                      <span className="text-sm text-slate-700">Template expense</span>
                      <select
                        value={recurringSourceExpenseId}
                        onChange={(event) => setRecurringSourceExpenseId(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        {sortedExpenses.map((expense) => (
                          <option key={expense.id} value={expense.id}>
                            {expense.description} · {toReadableDate(expense.expenseDate)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-1">
                        <span className="text-sm text-slate-700">Cadence</span>
                        <select
                          value={recurringCadence}
                          onChange={(event) => setRecurringCadence(event.target.value as PreviewRecurringCadence)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        >
                          {RECURRING_CADENCE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block space-y-1">
                        <span className="text-sm text-slate-700">Next expense date</span>
                        <input
                          type="date"
                          value={recurringStartDate}
                          onChange={(event) => setRecurringStartDate(event.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>

                    {recurringError ? <p className="text-sm text-rose-700">{recurringError}</p> : null}
                    {recurringStatus ? <p className="text-sm text-emerald-700">{recurringStatus}</p> : null}

                    <button
                      type="submit"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      Create recurring rule
                    </button>
                  </form>
                )}

                <div className="mt-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Active rules</h3>
                  {group.recurringRules.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-600">No recurring rules yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm">
                      {[...group.recurringRules]
                        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                        .map((rule) => (
                          <li key={rule.id} className="rounded-md border border-slate-200 px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-slate-900">{rule.templateExpense.description}</p>
                                <p className="text-slate-600">
                                  {rule.cadence === "weekly" ? "Weekly" : "Monthly"} · next {toReadableDate(rule.nextExpenseDate)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDeleteRecurringRule(rule.id)}
                                className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700"
                              >
                                Delete
                              </button>
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600">
                Hidden. Open this section when you want to manage recurring rules.
              </p>
            )}
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Financial coach</h2>
              <button
                type="button"
                onClick={() => setShowFinancialCoachPanel((current) => !current)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {showFinancialCoachPanel ? "Hide" : "Show"}
              </button>
            </div>

            {showFinancialCoachPanel ? (
              <>
                <p className="mt-2 text-sm text-slate-600">
                  Set personal limits to build disciplined spending and repayment habits.
                </p>

                {group.members.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-600">Add members to configure financial guardrails.</p>
                ) : (
                  <form onSubmit={handleSaveCoachSettings} className="mt-3 space-y-3">
                    <label className="space-y-1 block">
                      <span className="text-sm text-slate-700">Member</span>
                      <select
                        value={coachMemberId}
                        onChange={(event) => setCoachMemberId(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        {group.members.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.displayName}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1 block">
                      <span className="text-sm text-slate-700">Monthly spend budget ({group.currencyCode})</span>
                      <input
                        value={coachMonthlyBudget}
                        onChange={(event) => setCoachMonthlyBudget(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="0.00"
                      />
                    </label>

                    <label className="space-y-1 block">
                      <span className="text-sm text-slate-700">Max safe debt ({group.currencyCode})</span>
                      <input
                        value={coachMaxDebt}
                        onChange={(event) => setCoachMaxDebt(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="0.00"
                      />
                    </label>

                    <label className="space-y-1 block">
                      <span className="text-sm text-slate-700">Weekly pay cap ({group.currencyCode})</span>
                      <input
                        value={coachWeeklyPayCap}
                        onChange={(event) => setCoachWeeklyPayCap(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="0.00"
                      />
                    </label>

                    {coachError ? <p className="text-sm text-rose-700">{coachError}</p> : null}
                    {coachStatus ? <p className="text-sm text-emerald-700">{coachStatus}</p> : null}

                    <button
                      type="submit"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      Save guardrails
                    </button>
                  </form>
                )}

                {coachMemberId ? (
                  <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
                    <p className="text-slate-700">
                      This month spend:{" "}
                      <span className="font-semibold">
                        {formatCurrencyFromCents(monthlyShareSpendCents, group.currencyCode)}
                      </span>{" "}
                      ({monthlyUsagePercent}% of budget)
                    </p>
                    <p className="mt-1 text-slate-700">
                      Current owed:{" "}
                      <span className="font-semibold">{formatCurrencyFromCents(owedCents, group.currencyCode)}</span>{" "}
                      / safe debt{" "}
                      <span className="font-semibold">
                        {formatCurrencyFromCents(selectedCoachSettings.maxDebtCents, group.currencyCode)}
                      </span>
                    </p>
                    <p className={`mt-1 font-semibold ${scoreToneClass}`}>Responsibility score: {responsibilityScore}/100</p>
                    {owedCents > 0 ? (
                      <p className="mt-1 text-slate-700">
                        Weekly action: pay{" "}
                        <span className="font-semibold">
                          {formatCurrencyFromCents(weeklyPlan.recommendedPaymentCents, group.currencyCode)}
                        </span>{" "}
                        by {new Date(weeklyPlan.dueDate).toLocaleDateString("en-US", { dateStyle: "medium" })}. At this pace, clear debt in{" "}
                        <span className="font-semibold">{weeklyPlan.weeksToClear}</span> week
                        {weeklyPlan.weeksToClear === 1 ? "" : "s"}.
                      </p>
                    ) : (
                      <p className="mt-1 text-slate-700">
                        Weekly action: no debt right now. Keep spending under budget and keep your streak.
                      </p>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600">
                Hidden. Open this section when you want to configure or view financial coach details.
              </p>
            )}
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Balances</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {group.members.map((member) => {
                const balance = balances[member.userId] ?? 0;
                const signLabel = balance > 0 ? "is owed" : balance < 0 ? "owes" : "settled";

                return (
                  <li key={member.userId} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                    <span>{member.displayName}</span>
                    <span className={balance > 0 ? "text-emerald-700" : balance < 0 ? "text-rose-700" : "text-slate-600"}>
                      {signLabel} {formatCurrencyFromCents(Math.abs(balance), group.currencyCode)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Settle suggestions</h2>
            {suggestions.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">Everyone is settled.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {suggestions.map((suggestion, index) => {
                  const payerName = memberNameById(group, suggestion.fromMemberId);
                  const payeeName = memberNameById(group, suggestion.toMemberId);
                  const amountLabel = formatCurrencyFromCents(suggestion.amountCents, group.currencyCode);
                  const installmentPlans = [2, 3, 4].map((parts) => {
                    const plan = buildInstallmentPlan(suggestion.amountCents, parts, todayDate());
                    const first = plan[0];
                    if (!first) {
                      throw new Error("Invalid installment plan.");
                    }

                    const planSummary = plan
                      .map(
                        (entry) =>
                          `${entry.index}) ${formatCurrencyFromCents(entry.amountCents, group.currencyCode)} on ${toReadableDate(entry.dueDate)}`,
                      )
                      .join("; ");
                    const installmentNote = `Installment 1/${parts} of ${amountLabel} settlement`;

                    return {
                      parts,
                      planSummary,
                      firstInstallmentAmountCents: first.amountCents,
                      firstInstallmentDate: first.dueDate,
                      installmentNote,
                    };
                  });

                  return (
                    <li
                      key={`${suggestion.fromMemberId}-${suggestion.toMemberId}-${index}`}
                      className="rounded-md border border-slate-200 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p>
                          <span className="font-medium">{payerName}</span> pays{" "}
                          <span className="font-medium">{payeeName}</span>{" "}
                          <span className="font-semibold text-slate-900">{amountLabel}</span>
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            prefillPaymentDraft({
                              fromMemberId: suggestion.fromMemberId,
                              toMemberId: suggestion.toMemberId,
                              amountCents: suggestion.amountCents,
                            })
                          }
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Settle now
                        </button>
                      </div>

                      <div className="mt-2 rounded-md bg-slate-50 p-2">
                        <p className="text-xs font-medium text-slate-700">Need flexibility? Start a weekly payment plan:</p>
                        <ul className="mt-2 space-y-2">
                          {installmentPlans.map((option) => (
                            <li key={option.parts} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                              <p className="text-xs text-slate-600">{option.planSummary}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    prefillPaymentDraft({
                                      fromMemberId: suggestion.fromMemberId,
                                      toMemberId: suggestion.toMemberId,
                                      amountCents: option.firstInstallmentAmountCents,
                                      paymentDate: option.firstInstallmentDate,
                                      note: option.installmentNote,
                                    })
                                  }
                                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Start {option.parts}-part plan
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>

          <article id="record-payment" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Record payment</h2>
            {group.members.length < 2 ? (
              <p className="mt-3 text-sm text-slate-600">
                Add at least 2 members before recording payments.
              </p>
            ) : (
              <form onSubmit={handleAddPayment} className="mt-3 space-y-3">
                <label className="space-y-1 block">
                  <span className="text-sm text-slate-700">From</span>
                  <select
                    value={paymentFrom}
                    onChange={(event) => setPaymentFrom(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {group.members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-sm text-slate-700">To</span>
                  <select
                    value={paymentTo}
                    onChange={(event) => setPaymentTo(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {group.members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-sm text-slate-700">Amount ({group.currencyCode})</span>
                  <input
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="space-y-1 block">
                  <span className="text-sm text-slate-700">Date</span>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(event) => setPaymentDate(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="space-y-1 block">
                  <span className="text-sm text-slate-700">Note (optional)</span>
                  <input
                    value={paymentNote}
                    onChange={(event) => setPaymentNote(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                {paymentError ? <p className="text-sm text-rose-700">{paymentError}</p> : null}

                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Add payment
                </button>
              </form>
            )}
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Recorded payments</h2>
            {sortedPayments.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No payments recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {sortedPayments.map((payment) => (
                  <li key={payment.id} className="rounded-md border border-slate-200 px-3 py-2">
                    <span className="font-medium">{memberNameById(group, payment.fromMemberId)}</span> paid{" "}
                    <span className="font-medium">{memberNameById(group, payment.toMemberId)}</span>{" "}
                    <span className="font-semibold">{formatCurrencyFromCents(payment.amountCents, group.currencyCode)}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}
