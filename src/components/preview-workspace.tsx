"use client";

import { useEffect, useMemo, useState } from "react";

import { ExpenseForm } from "@/components/expense-form";
import { computeGroupBalances } from "@/lib/balances";
import { centsToAmountString, formatCurrencyFromCents, parseAmountToCents } from "@/lib/money";
import {
  PREVIEW_STORAGE_KEY,
  getDefaultPreviewGroup,
  type PreviewExpense,
  type PreviewGroup,
} from "@/lib/preview";
import { suggestSettlements } from "@/lib/settle";
import { computeExpenseSplit } from "@/lib/splits";
import type { ExpensePayload } from "@/types/app";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildSettleHref(fromMemberId: string, toMemberId: string, amountCents: number): string {
  const settleQuery = new URLSearchParams({
    settleFrom: fromMemberId,
    settleTo: toMemberId,
    settleAmount: centsToAmountString(amountCents),
    settleDate: todayDate(),
  });

  return `?${settleQuery.toString()}#record-payment`;
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PreviewGroup;
        if (parsed && Array.isArray(parsed.members) && Array.isArray(parsed.expenses) && Array.isArray(parsed.payments)) {
          setGroup(parsed);
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
  }, [group.members, paymentFrom, paymentTo]);

  useEffect(() => {
    if (!loaded || didApplySettleParams) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const settleFrom = searchParams.get("settleFrom")?.trim() ?? "";
    const settleTo = searchParams.get("settleTo")?.trim() ?? "";
    const settleAmount = searchParams.get("settleAmount")?.trim() ?? "";
    const settleDate = searchParams.get("settleDate")?.trim() ?? "";
    const hasSettleParams = Boolean(settleFrom || settleTo || settleAmount || settleDate);

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
      splits: computed.splitRows.map((split) => ({
        participantId: split.memberId,
        amountCents: split.amountCents,
        itemId:
          typeof split.itemIndex === "number" && payload.mode === "itemized"
            ? (itemIdsByIndex[split.itemIndex] ?? null)
            : null,
      })),
      createdAt: existingExpense?.createdAt ?? new Date().toISOString(),
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

  function handleResetData(): void {
    if (!window.confirm("Reset all local app data to defaults?")) {
      return;
    }

    const defaults = getDefaultPreviewGroup();
    setGroup(defaults);
    setShowExpenseForm(false);
    setEditingExpenseId(null);
    setPaymentFrom(defaults.members[0]?.userId ?? "");
    setPaymentTo(defaults.members[1]?.userId ?? defaults.members[0]?.userId ?? "");
    setPaymentAmount("");
    setPaymentDate(todayDate());
    setPaymentNote("");
    setReceiptExpenseId(null);
    setReceiptRecipientName("");
    setReceiptTitle("");
    setReceiptMessage("");
    setReceiptFooter("");
    setReceiptError(null);
    setReceiptStatus(null);
    window.localStorage.removeItem(PREVIEW_STORAGE_KEY);
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

        <button
          type="button"
          onClick={handleResetData}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Reset data
        </button>
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
                        </div>
                        <div className="text-right">
                          <p className="text-base font-semibold text-slate-900">
                            {formatCurrencyFromCents(expense.totalCents, group.currencyCode)}
                          </p>
                          <div className="mt-2 flex gap-2">
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
                {suggestions.map((suggestion, index) => (
                  <li
                    key={`${suggestion.fromMemberId}-${suggestion.toMemberId}-${index}`}
                    className="rounded-md border border-slate-200 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p>
                        <span className="font-medium">{memberNameById(group, suggestion.fromMemberId)}</span> pays{" "}
                        <span className="font-medium">{memberNameById(group, suggestion.toMemberId)}</span>{" "}
                        <span className="font-semibold text-slate-900">
                          {formatCurrencyFromCents(suggestion.amountCents, group.currencyCode)}
                        </span>
                      </p>
                      <a
                        href={buildSettleHref(suggestion.fromMemberId, suggestion.toMemberId, suggestion.amountCents)}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Settle now
                      </a>
                    </div>
                  </li>
                ))}
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
