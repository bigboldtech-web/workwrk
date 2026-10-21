"use client";

// The consent page's form, sent once (src/lib/oauth/submit-once.ts): a second
// click on Allow or Deny never posts again, and both buttons show disabled
// (their existing :disabled style) once the first post is on its way. With
// no script at all it is the same plain POST form.

import { useRef, type FormEvent, type ReactNode } from "react";
import { submitOnceGuard } from "@/lib/oauth/submit-once";

export function SubmitOnceForm({ action, className, children }: { action: string; className?: string; children: ReactNode }) {
  const guard = useRef<ReturnType<typeof submitOnceGuard> | null>(null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const once = (guard.current ??= submitOnceGuard(() => {
      for (const b of form.querySelectorAll("button")) b.disabled = true;
    }));
    once.onSubmit(e);
  };
  return (
    <form method="post" action={action} className={className} onSubmit={onSubmit}>
      {children}
    </form>
  );
}
