"use client";

import { useActionState } from "react";

import { loginAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";

interface LoginFormProps {
  nextPath?: string;
  queryError?: string;
}

export function LoginForm({ nextPath, queryError }: LoginFormProps) {
  const [state, formAction] = useActionState(loginAction, {});

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <input type="hidden" name="next" value={nextPath ?? "/dashboard"} />

      <label className="space-y-1 block">
        <span className="text-sm font-medium text-slate-700">Email</span>
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      {queryError ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{queryError}</p>
      ) : null}

      {state.error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p> : null}
      {state.success ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.success}</p>
      ) : null}

      <SubmitButton
        idleLabel="Send magic link"
        pendingLabel="Sending..."
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
      />
    </form>
  );
}
