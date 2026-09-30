"use client";

// "Send verification email" with its 60 second cool down (spec-account-auth
// Profile and Security): POST /api/auth/request-verify, a toast naming the
// address, then the button reads "Sent" and stays disabled for 60 seconds.

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";

export const VERIFY_COOLDOWN_MS = 60_000;

export function useVerifyCooldown(email: string) {
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);

  useEffect(() => {
    if (sentAt === null) return;
    const t = window.setTimeout(() => setSentAt(null), VERIFY_COOLDOWN_MS);
    return () => window.clearTimeout(t);
  }, [sentAt]);

  const send = useCallback(async () => {
    if (busy || sentAt !== null) return;
    setBusy(true);
    const r = await apiFetch("/api/auth/request-verify", { method: "POST", json: {} });
    setBusy(false);
    if (!r.ok) {
      toast(r.error || "Couldn't send the verification email");
      return;
    }
    setSentAt(Date.now());
    toast(`Verification email sent to ${email}`);
  }, [busy, sentAt, email, toast]);

  return { send, busy, sent: sentAt !== null, disabled: busy || sentAt !== null };
}
