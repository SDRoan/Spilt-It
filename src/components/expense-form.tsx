"use client";

import { useMemo, useState } from "react";

import { parseAmountToCents } from "@/lib/money";
import type { SplitMode } from "@/lib/splits";
import type { ExpensePayload } from "@/types/app";

import { SubmitButton } from "@/components/submit-button";

interface MemberOption {
  userId: string;
  displayName: string;
}

interface ItemState {
  id: string;
  name: string;
  amount: string;
  memberIds: string[];
}

interface ExpenseFormProps {
  groupId: string;
  currencyCode: string;
  members: MemberOption[];
  submitAction: (formData: FormData) => Promise<void>;
  expenseId?: string;
  defaultPayload?: ExpensePayload;
  submitLabel?: string;
}

const SPLIT_MODES: Array<{ value: SplitMode; label: string }> = [
  { value: "equal", label: "Equal" },
  { value: "exact", label: "Exact amounts" },
  { value: "percent", label: "Percentages" },
  { value: "shares", label: "Shares / Weights" },
  { value: "itemized", label: "Itemized" },
];

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function centsToInputAmount(value: number): string {
  return (value / 100).toFixed(2);
}

function makeItemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createBlankItem(memberIds: string[]): ItemState {
  return {
    id: makeItemId(),
    name: "",
    amount: "",
    memberIds,
  };
}

function getDefaultMode(payload?: ExpensePayload): SplitMode {
  return payload?.mode ?? "equal";
}

function buildMemberAmountMap(
  members: MemberOption[],
  getter?: (memberId: string) => string,
): Record<string, string> {
  return members.reduce<Record<string, string>>((acc, member) => {
    acc[member.userId] = getter ? getter(member.userId) : "";
    return acc;
  }, {});
}

export function ExpenseForm({
  groupId,
  currencyCode,
  members,
  submitAction,
  expenseId,
  defaultPayload,
  submitLabel = "Save expense",
}: ExpenseFormProps) {
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState(defaultPayload?.description ?? "");
  const [date, setDate] = useState(defaultPayload?.date ?? todayDate());
  const [paidBy, setPaidBy] = useState(defaultPayload?.paidBy ?? members[0]?.userId ?? "");
  const [notes, setNotes] = useState(defaultPayload?.notes ?? "");
  const [mode, setMode] = useState<SplitMode>(getDefaultMode(defaultPayload));

  const [totalAmount, setTotalAmount] = useState(() => {
    if (!defaultPayload || defaultPayload.mode === "itemized") {
      return "";
    }

    return centsToInputAmount(defaultPayload.totalCents);
  });

  const [equalParticipants, setEqualParticipants] = useState<string[]>(() => {
    if (defaultPayload?.mode === "equal") {
      return defaultPayload.participants;
    }

    return members.map((member) => member.userId);
  });

  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>(() => {
    if (defaultPayload?.mode === "exact") {
      return buildMemberAmountMap(members, (memberId) => {
        const found = defaultPayload.allocations.find((entry) => entry.memberId === memberId);
        return found ? centsToInputAmount(found.amountCents) : "";
      });
    }

    return buildMemberAmountMap(members);
  });

  const [percentages, setPercentages] = useState<Record<string, string>>(() => {
    if (defaultPayload?.mode === "percent") {
      return buildMemberAmountMap(members, (memberId) => {
        const found = defaultPayload.allocations.find((entry) => entry.memberId === memberId);
        return found ? String(found.percent) : "";
      });
    }

    return buildMemberAmountMap(members);
  });

  const [shares, setShares] = useState<Record<string, string>>(() => {
    if (defaultPayload?.mode === "shares") {
      return buildMemberAmountMap(members, (memberId) => {
        const found = defaultPayload.allocations.find((entry) => entry.memberId === memberId);
        return found ? String(found.shares) : "";
      });
    }

    return buildMemberAmountMap(members);
  });

  const [items, setItems] = useState<ItemState[]>(() => {
    if (defaultPayload?.mode === "itemized") {
      return defaultPayload.items.map((item) => ({
        id: makeItemId(),
        name: item.name,
        amount: centsToInputAmount(item.amountCents),
        memberIds: item.memberIds,
      }));
    }

    return [createBlankItem(members.map((member) => member.userId))];
  });

  const modeHelp = useMemo(() => {
    switch (mode) {
      case "equal":
        return "Split total equally across selected members.";
      case "exact":
        return "Enter each person’s exact amount. Must sum to total.";
      case "percent":
        return "Enter percentages per person. Must sum to 100.";
      case "shares":
        return "Assign share weights. Totals are proportional.";
      case "itemized":
        return "Add items, then assign each item to one or more members.";
      default:
        return "";
    }
  }, [mode]);

  function toggleEqualParticipant(memberId: string): void {
    setEqualParticipants((current) => {
      if (current.includes(memberId)) {
        return current.filter((id) => id !== memberId);
      }

      return [...current, memberId];
    });
  }

  function updateItem(index: number, patch: Omit<Partial<ItemState>, "id">): void {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  }

  function toggleItemMember(index: number, memberId: string): void {
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }

        const selected = item.memberIds.includes(memberId)
          ? item.memberIds.filter((id) => id !== memberId)
          : [...item.memberIds, memberId];

        return {
          ...item,
          memberIds: selected,
        };
      }),
    );
  }

  function removeItem(index: number): void {
    setItems((current) => {
      if (current.length <= 1) {
        return current;
      }

      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  function addItem(): void {
    setItems((current) => [...current, createBlankItem(members.map((member) => member.userId))]);
  }

  function buildPayload(): ExpensePayload {
    if (!description.trim()) {
      throw new Error("Description is required.");
    }

    if (!date) {
      throw new Error("Date is required.");
    }

    if (!paidBy) {
      throw new Error("Choose who paid.");
    }

    const base = {
      description: description.trim(),
      date,
      paidBy,
      currencyCode,
      notes: notes.trim() || undefined,
    };

    if (mode === "equal") {
      const totalCents = parseAmountToCents(totalAmount);
      if (equalParticipants.length === 0) {
        throw new Error("Select at least one participant.");
      }

      return {
        ...base,
        mode,
        totalCents,
        participants: equalParticipants,
      };
    }

    if (mode === "exact") {
      const totalCents = parseAmountToCents(totalAmount);
      const allocations = members.map((member) => ({
        memberId: member.userId,
        amountCents: exactAmounts[member.userId]?.trim()
          ? parseAmountToCents(exactAmounts[member.userId])
          : 0,
      }));

      return {
        ...base,
        mode,
        totalCents,
        allocations,
      };
    }

    if (mode === "percent") {
      const totalCents = parseAmountToCents(totalAmount);
      const allocations = members.map((member) => ({
        memberId: member.userId,
        percent: percentages[member.userId]?.trim() ? Number(percentages[member.userId]) : 0,
      }));

      return {
        ...base,
        mode,
        totalCents,
        allocations,
      };
    }

    if (mode === "shares") {
      const totalCents = parseAmountToCents(totalAmount);
      const allocations = members.map((member) => ({
        memberId: member.userId,
        shares: shares[member.userId]?.trim() ? Number(shares[member.userId]) : 0,
      }));

      return {
        ...base,
        mode,
        totalCents,
        allocations,
      };
    }

    if (mode === "itemized") {
      const normalizedItems = items.map((item) => ({
        name: item.name.trim(),
        amountCents: parseAmountToCents(item.amount),
        memberIds: item.memberIds,
      }));

      return {
        ...base,
        mode,
        items: normalizedItems,
      };
    }

    throw new Error("Unsupported split mode.");
  }

  return (
    <form
      action={async (formData) => {
        setError(null);

        try {
          const payload = buildPayload();
          formData.set("groupId", groupId);
          formData.set("payload", JSON.stringify(payload));

          if (expenseId) {
            formData.set("expenseId", expenseId);
          }

          await submitAction(formData);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Failed to save expense.";
          setError(message);
        }
      }}
      className="space-y-6"
    >
      <section className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm font-medium text-slate-700">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Groceries"
            required
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium text-slate-700">Date</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium text-slate-700">Paid by</span>
          <select
            value={paidBy}
            onChange={(event) => setPaidBy(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          >
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>

        {mode !== "itemized" ? (
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Total ({currencyCode})</span>
            <input
              value={totalAmount}
              onChange={(event) => setTotalAmount(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="0.00"
              required
            />
          </label>
        ) : null}
      </section>

      <label className="space-y-1 block">
        <span className="text-sm font-medium text-slate-700">Split mode</span>
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as SplitMode)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {SPLIT_MODES.map((splitMode) => (
            <option key={splitMode.value} value={splitMode.value}>
              {splitMode.label}
            </option>
          ))}
        </select>
      </label>

      <p className="text-sm text-slate-600">{modeHelp}</p>

      {mode === "equal" ? (
        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-medium text-slate-900">Participants</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {members.map((member) => (
              <label key={member.userId} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={equalParticipants.includes(member.userId)}
                  onChange={() => toggleEqualParticipant(member.userId)}
                />
                {member.displayName}
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {mode === "exact" ? (
        <section className="rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="font-medium text-slate-900">Exact amounts ({currencyCode})</h3>
          {members.map((member) => (
            <label key={member.userId} className="grid grid-cols-[1fr_180px] gap-3 items-center">
              <span className="text-sm text-slate-700">{member.displayName}</span>
              <input
                value={exactAmounts[member.userId] ?? ""}
                onChange={(event) =>
                  setExactAmounts((current) => ({
                    ...current,
                    [member.userId]: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="0.00"
              />
            </label>
          ))}
        </section>
      ) : null}

      {mode === "percent" ? (
        <section className="rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="font-medium text-slate-900">Percentages</h3>
          {members.map((member) => (
            <label key={member.userId} className="grid grid-cols-[1fr_180px] gap-3 items-center">
              <span className="text-sm text-slate-700">{member.displayName}</span>
              <input
                value={percentages[member.userId] ?? ""}
                onChange={(event) =>
                  setPercentages((current) => ({
                    ...current,
                    [member.userId]: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="0"
              />
            </label>
          ))}
        </section>
      ) : null}

      {mode === "shares" ? (
        <section className="rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="font-medium text-slate-900">Share weights</h3>
          {members.map((member) => (
            <label key={member.userId} className="grid grid-cols-[1fr_180px] gap-3 items-center">
              <span className="text-sm text-slate-700">{member.displayName}</span>
              <input
                value={shares[member.userId] ?? ""}
                onChange={(event) =>
                  setShares((current) => ({
                    ...current,
                    [member.userId]: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="0"
              />
            </label>
          ))}
        </section>
      ) : null}

      {mode === "itemized" ? (
        <section className="rounded-lg border border-slate-200 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-slate-900">Items</h3>
            <button
              type="button"
              onClick={addItem}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Add item
            </button>
          </div>

          {items.map((item, itemIndex) => (
            <article key={item.id} className="rounded-md border border-slate-200 p-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-slate-600">Item name</span>
                  <input
                    value={item.name}
                    onChange={(event) => updateItem(itemIndex, { name: event.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Milk"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-slate-600">Amount ({currencyCode})</span>
                  <input
                    value={item.amount}
                    onChange={(event) => updateItem(itemIndex, { amount: event.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="0.00"
                  />
                </label>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {members.map((member) => (
                  <label key={member.userId} className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={item.memberIds.includes(member.userId)}
                      onChange={() => toggleItemMember(itemIndex, member.userId)}
                    />
                    {member.displayName}
                  </label>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => removeItem(itemIndex)}
                  className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700"
                >
                  Remove item
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <label className="space-y-1 block">
        <span className="text-sm font-medium text-slate-700">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Anything useful about this expense"
        />
      </label>

      {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="flex items-center gap-3">
        <SubmitButton
          idleLabel={submitLabel}
          pendingLabel="Saving expense..."
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
        />
      </div>
    </form>
  );
}
