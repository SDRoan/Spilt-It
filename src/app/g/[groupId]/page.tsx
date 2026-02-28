import Link from "next/link";

import { createInviteAction, createPaymentAction } from "@/app/actions";
import { DeleteExpenseButton } from "@/components/delete-expense-button";
import { SubmitButton } from "@/components/submit-button";
import { requireUser } from "@/lib/auth";
import { getGroupOverview } from "@/lib/db";
import { env } from "@/lib/env";
import { buildInstallmentPlan } from "@/lib/installments";
import { centsToAmountString, formatCurrencyFromCents, parseAmountToCents } from "@/lib/money";

interface GroupPageProps {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toReadableDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" });
}

export default async function GroupPage({ params, searchParams }: GroupPageProps) {
  const { groupId } = await params;
  const search = await searchParams;

  await requireUser(`/g/${groupId}`);

  const overview = await getGroupOverview(groupId);
  const memberNameById = new Map(overview.members.map((member) => [member.userId, member.displayName]));

  const inviteToken = typeof search.invite === "string" ? search.invite : null;
  const inviteLink = inviteToken ? `${env.siteUrl()}/invite/${inviteToken}` : null;
  const memberIdSet = new Set(overview.members.map((member) => member.userId));

  const settleFrom = typeof search.settleFrom === "string" ? search.settleFrom.trim() : "";
  const settleTo = typeof search.settleTo === "string" ? search.settleTo.trim() : "";
  const settleAmount = typeof search.settleAmount === "string" ? search.settleAmount.trim() : "";
  const settleDate = typeof search.settleDate === "string" ? search.settleDate.trim() : "";
  const settleNote = typeof search.settleNote === "string" ? search.settleNote.trim() : "";

  const defaultFromMemberId = memberIdSet.has(settleFrom) ? settleFrom : (overview.members[0]?.userId ?? "");
  const fallbackToMemberId =
    overview.members.find((member) => member.userId !== defaultFromMemberId)?.userId ??
    (overview.members[0]?.userId ?? "");
  const defaultToMemberId =
    memberIdSet.has(settleTo) && settleTo !== defaultFromMemberId ? settleTo : fallbackToMemberId;

  let defaultAmount = "";
  if (settleAmount) {
    try {
      parseAmountToCents(settleAmount);
      defaultAmount = settleAmount;
    } catch {
      defaultAmount = "";
    }
  }

  const defaultPaymentDate = settleDate && isIsoDate(settleDate) ? settleDate : todayDate();
  const defaultNote = settleNote;
  function buildSettleHref(input: {
    fromMemberId: string;
    toMemberId: string;
    amountCents: number;
    paymentDate?: string;
    note?: string;
  }): string {
    const settleQuery = new URLSearchParams({
      settleFrom: input.fromMemberId,
      settleTo: input.toMemberId,
      settleAmount: centsToAmountString(input.amountCents),
      settleDate: input.paymentDate && isIsoDate(input.paymentDate) ? input.paymentDate : todayDate(),
    });

    if (input.note && input.note.trim().length > 0) {
      settleQuery.set("settleNote", input.note.trim());
    }

    return `/g/${groupId}?${settleQuery.toString()}#record-payment`;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">
            Back to dashboard
          </Link>
          <h1 className="mt-1 font-display text-3xl font-bold text-slate-900">{overview.group.name}</h1>
          <p className="text-sm text-slate-600">Currency: {overview.group.currencyCode}</p>
        </div>

        <Link
          href={`/g/${groupId}/expense/new`}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Add expense
        </Link>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Members</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {overview.members.map((member) => (
                <li key={member.userId} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-900">{member.displayName}</span>
                  <span className="ml-2 text-xs uppercase text-slate-500">{member.role}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Expenses</h2>
              <span className="text-xs text-slate-500">{overview.expenses.length} total</span>
            </div>

            {overview.expenses.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No expenses yet.</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {overview.expenses.map((expense) => {
                  const splitTotals = expense.splits.reduce<Record<string, number>>((acc, split) => {
                    acc[split.participantId] = (acc[split.participantId] ?? 0) + split.amountCents;
                    return acc;
                  }, {});

                  return (
                    <li key={expense.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-slate-900">{expense.description}</h3>
                          <p className="text-sm text-slate-600">
                            {new Date(expense.expenseDate).toLocaleDateString("en-US", { dateStyle: "medium" })} · Paid by{" "}
                            {memberNameById.get(expense.paidBy) ?? "Unknown"}
                          </p>
                          <p className="text-sm text-slate-600">Mode: {expense.splitMode}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-base font-semibold text-slate-900">
                            {formatCurrencyFromCents(expense.totalCents, overview.group.currencyCode)}
                          </p>
                          <div className="mt-2 flex items-center justify-end gap-2">
                            <Link
                              href={`/g/${groupId}/expense/${expense.id}/edit`}
                              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Edit
                            </Link>
                            <DeleteExpenseButton groupId={groupId} expenseId={expense.id} />
                          </div>
                        </div>
                      </div>

                      {expense.items.length > 0 ? (
                        <div className="mt-3 rounded-md bg-slate-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Items</p>
                          <ul className="mt-2 space-y-1 text-sm text-slate-700">
                            {expense.items.map((item) => (
                              <li key={item.id} className="flex items-center justify-between gap-2">
                                <span>{item.name}</span>
                                <span>{formatCurrencyFromCents(item.amountCents, overview.group.currencyCode)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div className="mt-3 rounded-md bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Per-member breakdown</p>
                        <ul className="mt-2 space-y-1 text-sm text-slate-700">
                          {Object.entries(splitTotals).map(([memberId, amountCents]) => (
                            <li key={memberId} className="flex items-center justify-between gap-2">
                              <span>{memberNameById.get(memberId) ?? "Unknown"}</span>
                              <span>{formatCurrencyFromCents(amountCents, overview.group.currencyCode)}</span>
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
              {overview.members.map((member) => {
                const balance = overview.balances[member.userId] ?? 0;
                const signLabel = balance > 0 ? "is owed" : balance < 0 ? "owes" : "settled";

                return (
                  <li key={member.userId} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                    <span>{member.displayName}</span>
                    <span className={balance > 0 ? "text-emerald-700" : balance < 0 ? "text-rose-700" : "text-slate-600"}>
                      {signLabel} {formatCurrencyFromCents(Math.abs(balance), overview.group.currencyCode)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Settle suggestions</h2>
            {overview.suggestions.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">Everyone is settled.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {overview.suggestions.map((suggestion, index) => {
                  const payerName = memberNameById.get(suggestion.fromMemberId) ?? "Unknown";
                  const payeeName = memberNameById.get(suggestion.toMemberId) ?? "Unknown";
                  const amountLabel = formatCurrencyFromCents(suggestion.amountCents, overview.group.currencyCode);
                  const settleHref = buildSettleHref({
                    fromMemberId: suggestion.fromMemberId,
                    toMemberId: suggestion.toMemberId,
                    amountCents: suggestion.amountCents,
                  });
                  const installmentPlans = [2, 3, 4].map((parts) => {
                    const plan = buildInstallmentPlan(suggestion.amountCents, parts, todayDate());
                    const first = plan[0];
                    if (!first) {
                      throw new Error("Invalid installment plan.");
                    }

                    const planSummary = plan
                      .map(
                        (entry) =>
                          `${entry.index}) ${formatCurrencyFromCents(entry.amountCents, overview.group.currencyCode)} on ${toReadableDate(entry.dueDate)}`,
                      )
                      .join("; ");
                    const installmentNote = `Installment 1/${parts} of ${amountLabel} settlement`;
                    const firstInstallmentHref = buildSettleHref({
                      fromMemberId: suggestion.fromMemberId,
                      toMemberId: suggestion.toMemberId,
                      amountCents: first.amountCents,
                      paymentDate: first.dueDate,
                      note: installmentNote,
                    });

                    return {
                      parts,
                      planSummary,
                      firstInstallmentHref,
                    };
                  });

                  return (
                    <li key={`${suggestion.fromMemberId}-${suggestion.toMemberId}-${index}`} className="rounded-md border border-slate-200 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p>
                          <span className="font-medium">{payerName}</span> pays{" "}
                          <span className="font-medium">{payeeName}</span>{" "}
                          <span className="font-semibold text-slate-900">{amountLabel}</span>
                        </p>
                        <Link
                          href={settleHref}
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Settle now
                        </Link>
                      </div>

                      <div className="mt-2 rounded-md bg-slate-50 p-2">
                        <p className="text-xs font-medium text-slate-700">Need flexibility? Start a weekly payment plan:</p>
                        <ul className="mt-2 space-y-2">
                          {installmentPlans.map((option) => (
                            <li key={option.parts} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                              <p className="text-xs text-slate-600">{option.planSummary}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <Link
                                  href={option.firstInstallmentHref}
                                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Start {option.parts}-part plan
                                </Link>
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

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Invite member</h2>
            <form action={createInviteAction} className="mt-3">
              <input type="hidden" name="groupId" value={groupId} />
              <SubmitButton
                idleLabel="Create invite link"
                pendingLabel="Creating..."
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
              />
            </form>

            {inviteLink ? (
              <div className="mt-3 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
                <p className="font-medium">Invite link:</p>
                <p className="break-all">{inviteLink}</p>
              </div>
            ) : null}
          </article>

          <article id="record-payment" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Record payment</h2>
            <form action={createPaymentAction} className="mt-3 space-y-3">
              <input type="hidden" name="groupId" value={groupId} />

              <label className="space-y-1 block">
                <span className="text-sm text-slate-700">From</span>
                <select
                  name="fromMemberId"
                  defaultValue={defaultFromMemberId}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                >
                  {overview.members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-sm text-slate-700">To</span>
                <select
                  name="toMemberId"
                  defaultValue={defaultToMemberId}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                >
                  {overview.members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-sm text-slate-700">Amount ({overview.group.currencyCode})</span>
                <input
                  name="amount"
                  defaultValue={defaultAmount}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-sm text-slate-700">Date</span>
                <input
                  type="date"
                  name="paymentDate"
                  defaultValue={defaultPaymentDate}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-sm text-slate-700">Note (optional)</span>
                <input name="note" defaultValue={defaultNote} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>

              <SubmitButton
                idleLabel="Record payment"
                pendingLabel="Saving..."
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
              />
            </form>

            {overview.payments.length > 0 ? (
              <ul className="mt-4 space-y-2 text-sm">
                {overview.payments.slice(0, 6).map((payment) => (
                  <li key={payment.id} className="rounded-md border border-slate-200 px-3 py-2">
                    <span className="font-medium">{memberNameById.get(payment.fromMemberId) ?? "Unknown"}</span> paid{" "}
                    <span className="font-medium">{memberNameById.get(payment.toMemberId) ?? "Unknown"}</span>{" "}
                    <span className="font-semibold">
                      {formatCurrencyFromCents(payment.amountCents, overview.group.currencyCode)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        </div>
      </section>
    </main>
  );
}
