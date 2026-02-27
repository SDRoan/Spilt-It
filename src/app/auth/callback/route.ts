import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null): string {
  if (!value) {
    return "/dashboard";
  }

  return value.startsWith("/") ? value : "/dashboard";
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);

  if (!isSupabaseConfigured) {
    return NextResponse.redirect(new URL("/login?error=supabase_not_configured", url.origin));
  }

  const code = url.searchParams.get("code");
  const nextPath = safeNextPath(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
  }

  return NextResponse.redirect(new URL(nextPath, url.origin));
}
