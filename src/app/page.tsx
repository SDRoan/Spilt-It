import Link from "next/link";
import { redirect } from "next/navigation";

import { PreviewWorkspace } from "@/components/preview-workspace";
import { getCurrentUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

export default async function LandingPage() {
  if (!isSupabaseConfigured) {
    return <PreviewWorkspace />;
  }

  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-16">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm md:p-12">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">Split It</p>
        <h1 className="mt-4 max-w-2xl font-display text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
          Split group expenses quickly, manually, and clearly.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-600">
          Add expenses by hand, choose advanced split modes, see balances instantly, and settle up with fewer
          payments.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Login with magic link
          </Link>
          <span className="text-sm text-slate-500">No OCR, no scanning, no paid APIs.</span>
        </div>
      </section>
    </main>
  );
}
