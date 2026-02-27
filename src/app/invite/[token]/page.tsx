import Link from "next/link";

import { joinInviteAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { requireUser } from "@/lib/auth";
import { getInviteInfoByToken } from "@/lib/db";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  await requireUser(`/invite/${token}`);

  const invite = await getInviteInfoByToken(token);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {!invite ? (
          <>
            <h1 className="font-display text-2xl font-bold text-slate-900">Invite not found</h1>
            <p className="mt-2 text-sm text-slate-600">This invite token is invalid or no longer available.</p>
            <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-sky-700">
              Back to dashboard
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold text-slate-900">Join group invite</h1>
            <p className="mt-2 text-sm text-slate-600">
              Group: <span className="font-semibold text-slate-900">{invite.groupName}</span>
            </p>
            <p className="text-sm text-slate-600">Currency: {invite.currencyCode}</p>
            <p className="text-sm text-slate-600">
              Expires: {new Date(invite.expiresAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </p>

            {invite.alreadyMember ? (
              <>
                <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  You are already a member of this group.
                </p>
                <Link
                  href={`/g/${invite.groupId}`}
                  className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                >
                  Open group
                </Link>
              </>
            ) : invite.isExpired ? (
              <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This invite has expired.
              </p>
            ) : (
              <form action={joinInviteAction} className="mt-5">
                <input type="hidden" name="token" value={token} />
                <SubmitButton
                  idleLabel="Join group"
                  pendingLabel="Joining..."
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
                />
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}
