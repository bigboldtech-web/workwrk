"use client";

// "Public link" for one task: Anyone with the link can view it, read only,
// without signing in (access-model toggle 10). What the switch, the address
// and every reason it cannot be changed say comes from the server
// (GET /api/items/[id]/public-link), so the dialog never offers what the
// route would refuse.

import { useCallback, useEffect, useState } from "react";
import { Link2, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { accessMessage } from "@/lib/access-message";

type LinkState = { allowed: boolean; canManage: boolean; archived: boolean; on: boolean; url: string | null };

export function TaskPublicLinkDialog({ itemId, open, onClose }: { itemId: string; open: boolean; onClose: () => void }) {
  const [state, setState] = useState<LinkState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/public-link`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(accessMessage(d, "Couldn't read this task's public link."));
        return;
      }
      setState(d as LinkState);
    } catch {
      setError("Couldn't read this task's public link. Check your connection and try again.");
    }
  }, [itemId]);

  useEffect(() => {
    if (!open) return;
    const run = async () => {
      await load();
    };
    void run();
  }, [open, load]);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/public-link`, { method: next ? "POST" : "DELETE" });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(accessMessage(d, next ? "Couldn't turn on the public link." : "Couldn't turn off the public link."));
        return;
      }
      setState(d as LinkState);
      setCopied(false);
    } catch {
      setError("Couldn't save that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const address = state?.url && typeof window !== "undefined" ? `${window.location.origin}${state.url}` : null;
  const reason = !state
    ? null
    : !state.canManage
      ? "Only someone who can add tasks to this task's List can share it publicly."
      : !state.allowed && !state.on
        ? "Public links are turned off for this workspace. A workspace admin can turn them on in Settings, Access."
        : state.archived && !state.on
          ? "This task is in Trash, so it can't be shared."
          : null;
  const canToggle = !!state && state.canManage && (state.on || (state.allowed && !state.archived));

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent className="max-w-[440px]">
        <DialogTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-ink-2" strokeWidth={1.75} aria-hidden />
          Public link
        </DialogTitle>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Anyone with the link can view this task&rsquo;s title, status, dates, description, checklist and subtasks, without signing in. They can&rsquo;t
          see comments, files, people&rsquo;s emails or anything else in the workspace, and they can&rsquo;t change anything.
        </p>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
          <span className="text-base font-medium text-ink">Anyone with the link can view</span>
          <Switch
            checked={!!state?.on}
            onChange={(next) => void toggle(next)}
            disabled={!canToggle || busy}
            aria-label="Anyone with the link can view"
          />
        </div>

        {state?.on && address ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              readOnly
              value={address}
              aria-label="Public link"
              onFocus={(e) => e.currentTarget.select()}
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-subtle px-2 text-xs text-ink"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(address);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <a
              href={address}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              aria-label="Open the public page"
              title="Open the public page"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </a>
          </div>
        ) : null}
        {state?.on && !address && !state.canManage ? (
          <p className="mt-3 text-xs text-ink-2">A public link to this task is on. Someone who can share it can copy the address or turn it off.</p>
        ) : null}
        {state?.on ? (
          <p className="mt-2 text-xs text-ink-3">Turning it off stops this address for good. Turning it on again makes a new one.</p>
        ) : null}
        {reason ? <p className="mt-3 text-xs text-ink-2">{reason}</p> : null}
        {error ? (
          <p className="mt-3 text-xs text-[var(--os-danger,#D92D20)]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
