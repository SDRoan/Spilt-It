import Link from "next/link";
import { notFound } from "next/navigation";

import { saveExpenseAction } from "@/app/actions";
import { ExpenseForm } from "@/components/expense-form";
import { requireUser } from "@/lib/auth";
import { getExpenseById, getGroupAndMembers } from "@/lib/db";
import { expenseToPayload } from "@/lib/expense-transform";

interface EditExpensePageProps {
  params: Promise<{ groupId: string; expenseId: string }>;
}

export default async function EditExpensePage({ params }: EditExpensePageProps) {
  const { groupId, expenseId } = await params;
  await requireUser(`/g/${groupId}/expense/${expenseId}/edit`);

  const [groupContext, expense] = await Promise.all([getGroupAndMembers(groupId), getExpenseById(expenseId)]);

  if (!expense || expense.groupId !== groupId) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6">
        <Link href={`/g/${groupId}`} className="text-sm text-slate-600 hover:text-slate-900">
          Back to group
        </Link>
        <h1 className="mt-1 font-display text-3xl font-bold text-slate-900">Edit expense</h1>
        <p className="text-sm text-slate-600">{groupContext.group.name}</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <ExpenseForm
          groupId={groupId}
          expenseId={expenseId}
          currencyCode={groupContext.group.currencyCode}
          members={groupContext.members.map((member) => ({
            userId: member.userId,
            displayName: member.displayName,
          }))}
          defaultPayload={expenseToPayload(expense)}
          submitAction={saveExpenseAction}
          submitLabel="Update expense"
        />
      </section>
    </main>
  );
}
