"use client";

/* Change-password dialog — wired to POST /api/me/change-password.
 * Rendered via the shared Radix Dialog (portals to <body>, outside
 * `.workwrk-os`), so this uses literal brand hex + Tailwind utilities. */

import { useState } from "react";
import { Loader2, KeyRound, AlertTriangle, Eye, EyeOff } from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

export function ChangePasswordDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCurrent(""); setNext(""); setConfirm(""); setErr(null); setShow(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next !== confirm) {
      setErr("The new passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error ?? "Couldn't change your password.");
        setSubmitting(false);
        return;
      }
      reset();
      setSubmitting(false);
      onOpenChange(false);
      onChanged();
    } catch {
      setErr("Network error. Try again.");
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[14px] text-zinc-800 outline-none focus:border-[#0073EA] focus:ring-2 focus:ring-[#0073EA]/25 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
  const labelCls = "mb-1 block text-[12px] font-semibold uppercase tracking-wide text-zinc-400";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="block max-w-[420px] gap-0 p-0">
        <form onSubmit={submit} className="px-6 pt-6 pb-5">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold">
            <KeyRound className="h-4 w-4 text-[#0073EA]" />
            Change password
          </DialogTitle>
          <DialogDescription className="mt-1.5">
            Enter your current password, then choose a new one. Changing it signs
            out your other devices.
          </DialogDescription>

          <div className="mt-4 space-y-3">
            <div>
              <label className={labelCls}>Current password</label>
              <input
                type={show ? "text" : "password"}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                className={inputCls}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className={labelCls}>New password</label>
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-600"
                >
                  {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {show ? "Hide" : "Show"}
                </button>
              </div>
              <input
                type={show ? "text" : "password"}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Confirm new password</label>
              <input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className={inputCls}
              />
            </div>
          </div>

          {err && (
            <div className="mt-3 flex items-start gap-2 text-[13px] text-[#E2445C]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-zinc-200 px-3.5 py-2 text-[14px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !current || !next || !confirm}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0073EA] px-3.5 py-2 text-[14px] font-semibold text-white hover:bg-[#0060B9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Update password
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
