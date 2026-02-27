import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (!isSupabaseConfigured) {
    redirect("/");
  }

  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-16">
      <section className="w-full space-y-4">
        <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">
          Back to home
        </Link>
        <h1 className="font-display text-3xl font-bold text-slate-900">Log in to Split It</h1>
        <p className="text-sm text-slate-600">Enter your email and we will send a secure magic login link.</p>
        <LoginForm nextPath={next} queryError={error} />
      </section>
    </main>
  );
}
