import { redirect } from "next/navigation";

import { PreviewSettingsPage } from "@/components/preview-settings-page";
import { getCurrentUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

export default async function SettingsPage() {
  if (!isSupabaseConfigured) {
    return <PreviewSettingsPage />;
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <PreviewSettingsPage />;
}
