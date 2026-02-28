"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  PREVIEW_STORAGE_KEY,
  getDefaultPreviewGroup,
  type PreviewGroup,
} from "@/lib/preview";

function loadGroupFromStorage(): PreviewGroup {
  const fallback = getDefaultPreviewGroup();

  try {
    const stored = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!stored) {
      return fallback;
    }

    const parsed = JSON.parse(stored) as PreviewGroup;
    if (!parsed || !Array.isArray(parsed.members) || !Array.isArray(parsed.expenses) || !Array.isArray(parsed.payments)) {
      return fallback;
    }

    return {
      ...parsed,
      financialCoachByMember: parsed.financialCoachByMember ?? {},
    };
  } catch {
    return fallback;
  }
}

export function PreviewSettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const group = loadGroupFromStorage();

    setGroupName(group.name);
    setCurrencyCode(group.currencyCode);
    setLoaded(true);
  }, []);

  function handleSaveSettings(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setStatus(null);

    try {
      const trimmedGroupName = groupName.trim();
      if (trimmedGroupName.length < 2) {
        throw new Error("Group name must be at least 2 characters.");
      }

      const currentGroup = loadGroupFromStorage();
      const nextGroup: PreviewGroup = {
        ...currentGroup,
        name: trimmedGroupName,
      };

      window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(nextGroup));

      setGroupName(nextGroup.name);
      setCurrencyCode(nextGroup.currencyCode);
      setStatus("Settings saved.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not save settings.";
      setError(message);
    }
  }

  function handleResetData(): void {
    if (!window.confirm("Reset all local app data to defaults?")) {
      return;
    }

    window.localStorage.removeItem(PREVIEW_STORAGE_KEY);

    const defaults = getDefaultPreviewGroup();
    setGroupName(defaults.name);
    setCurrencyCode(defaults.currencyCode);
    setError(null);
    setStatus("Data reset to defaults.");
  }

  if (!loaded) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <p className="text-sm text-slate-600">Loading settings...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">Settings</h1>
          <p className="mt-1 text-sm text-slate-600">Manage local workspace preferences for Split It.</p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Back to workspace
        </Link>
      </header>

      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <form onSubmit={handleSaveSettings} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-slate-700">Group name</span>
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              Currency: <span className="font-semibold">{currencyCode}</span> (fixed for this group)
            </p>
            <p className="mt-1">Data storage: saved locally in this browser.</p>
          </div>

          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          {status ? <p className="text-sm text-emerald-700">{status}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Save settings
            </button>
            <button
              type="button"
              onClick={handleResetData}
              className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
            >
              Reset data
            </button>
          </div>

          <p className="text-xs text-slate-500">
            Reset removes members, expenses, payments, and guardrails saved on this browser.
          </p>
        </form>
      </article>
    </main>
  );
}
