"use client";

import { useActionState } from "react";

import { updateDisplayNameAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";

interface ProfileFormProps {
  defaultDisplayName: string;
}

export function ProfileForm({ defaultDisplayName }: ProfileFormProps) {
  const [state, formAction] = useActionState(updateDisplayNameAction, {});

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Profile</h2>
      <label className="space-y-1 block">
        <span className="text-sm text-slate-700">Display name</span>
        <input
          name="displayName"
          defaultValue={defaultDisplayName}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      {state.error ? <p className="text-sm text-rose-700">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700">{state.success}</p> : null}

      <SubmitButton
        idleLabel="Save profile"
        pendingLabel="Saving..."
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
      />
    </form>
  );
}
