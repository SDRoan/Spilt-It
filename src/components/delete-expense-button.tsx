"use client";

import { deleteExpenseAction } from "@/app/actions";

interface DeleteExpenseButtonProps {
  groupId: string;
  expenseId: string;
}

export function DeleteExpenseButton({ groupId, expenseId }: DeleteExpenseButtonProps) {
  return (
    <form
      action={async (formData) => {
        if (!window.confirm("Delete this expense? This cannot be undone.")) {
          return;
        }

        formData.set("groupId", groupId);
        formData.set("expenseId", expenseId);
        await deleteExpenseAction(formData);
      }}
    >
      <button
        type="submit"
        className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
      >
        Delete
      </button>
    </form>
  );
}
