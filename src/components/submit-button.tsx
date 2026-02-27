"use client";

import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  idleLabel: string;
  pendingLabel?: string;
  className?: string;
}

export function SubmitButton({ idleLabel, pendingLabel = "Saving...", className }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
