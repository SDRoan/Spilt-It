import Link from "next/link";

import { saveExpenseAction } from "@/app/actions";
import { ExpenseForm } from "@/components/expense-form";
import { requireUser } from "@/lib/auth";
import { getGroupAndMembers } from "@/lib/db";

interface NewExpensePageProps {
  params: Promise<{ groupId: string }>;
}

export default async function NewExpensePage({ params }: NewExpensePageProps) {
  const { groupId } = await params;
  await requireUser(`/g/${groupId}/expense/new`);

  const { group, members } = await getGroupAndMembers(groupId);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6">
        <Link href={`/g/${groupId}`} className="text-sm text-slate-600 hover:text-slate-900">
          Back to group
        </Link>
        <h1 className="mt-1 font-display text-3xl font-bold text-slate-900">Add expense</h1>
        <p className="text-sm text-slate-600">Group: {group.name}</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <ExpenseForm
          groupId={groupId}
          currencyCode={group.currencyCode}
          members={members.map((member) => ({ userId: member.userId, displayName: member.displayName }))}
          submitAction={saveExpenseAction}
          submitLabel="Create expense"
        />
      </section>
    </main>
  );
}
