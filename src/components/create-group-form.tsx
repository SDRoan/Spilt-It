"use client";

import { useActionState } from "react";

import { createGroupAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";

export function CreateGroupForm() {
  const [state, formAction] = useActionState(createGroupAction, {});

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Create group</h2>

      <label className="space-y-1 block">
        <span className="text-sm text-slate-700">Group name</span>
        <input
          name="name"
          required
          placeholder="Roommates"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="space-y-1 block">
        <span className="text-sm text-slate-700">Currency code (single currency per group)</span>
        <input
          name="currencyCode"
          required
          maxLength={3}
          minLength={3}
          placeholder="USD"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase"
        />
      </label>

      {state.error ? <p className="text-sm text-rose-700">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700">{state.success}</p> : null}

      <SubmitButton
        idleLabel="Create group"
        pendingLabel="Creating..."
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
      />
    </form>
  );
}
