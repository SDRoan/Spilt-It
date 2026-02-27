import Link from "next/link";

import { CreateGroupForm } from "@/components/create-group-form";
import { LogoutButton } from "@/components/logout-button";
import { ProfileForm } from "@/components/profile-form";
import { requireUser } from "@/lib/auth";
import { ensureOwnProfile, listGroupsForUser } from "@/lib/db";

export default async function DashboardPage() {
  const { user } = await requireUser("/dashboard");
  const profile = await ensureOwnProfile(user.id, user.email);
  const groups = await listGroupsForUser(user.id);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-600">Manage your groups and profile.</p>
        </div>
        <LogoutButton />
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Your groups</h2>
          </div>

          {groups.length === 0 ? (
            <p className="text-sm text-slate-600">No groups yet. Create one to get started.</p>
          ) : (
            <ul className="space-y-3">
              {groups.map((group) => (
                <li key={group.id}>
                  <Link
                    href={`/g/${group.id}`}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 hover:border-slate-300"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{group.name}</span>
                      <span className="block text-xs text-slate-500">Currency: {group.currencyCode}</span>
                    </span>
                    <span className="text-sm text-sky-700">Open</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>

        <div className="space-y-4">
          <ProfileForm defaultDisplayName={profile.displayName} />
          <CreateGroupForm />
        </div>
      </section>
    </main>
  );
}
