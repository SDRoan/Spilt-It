"use client";

import { useMemo, useState } from "react";

import { buildSmsShareUrl, buildWhatsAppShareUrl } from "@/lib/reminder";

interface ReminderActionsProps {
  message: string;
  className?: string;
}

export function ReminderActions({ message, className }: ReminderActionsProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const whatsappHref = useMemo(() => buildWhatsAppShareUrl(message), [message]);
  const smsHref = useMemo(() => buildSmsShareUrl(message), [message]);

  async function handleCopyReminder(): Promise<void> {
    try {
      await navigator.clipboard.writeText(message);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1800);
    } catch {
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 2200);
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={handleCopyReminder}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy reminder"}
      </button>

      <a
        href={whatsappHref}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
      >
        WhatsApp
      </a>

      <a
        href={smsHref}
        className="rounded-md border border-sky-300 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50"
      >
        SMS
      </a>
    </div>
  );
}
