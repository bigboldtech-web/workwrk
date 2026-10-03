"use client";

// "Public link" for one task: Anyone with the link can view it, read only,
// without signing in (access-model toggle 10). What the dialog offers, the
// address, the settings and every reason it cannot be changed come from the
// server (GET /api/items/[id]/public-link), so it never offers what the
// route would refuse, and a control this person cannot use is left out, not
// greyed: they get the sentence that says why instead.
//
// Settings (founder decision 4): how long the link lasts (no end date, 7, 30
// or 90 days), and "Show assignees and comments", off unless the sharer turns
// it on. Both change the same address.

import Link from "next/link";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link2, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BootContext } from "@/components/layout/os/boot-context";
import { accessMessage } from "@/lib/access-message";
import { formatTaskDate } from "@/lib/item-date";

type LinkState = {
  allowed: boolean;
  canManage: boolean;
  canTurnOn: boolean;
  personal: boolean;
  system?: boolean;
  inTrash: "task" | "place" | null;
  on: boolean;
  url: string | null;
  since: string | null;
  expiresAt: string | null;
  expired: boolean;
  showPeople: boolean;
};

const EXPIRY_CHOICES: Array<{ days: number | null; label: string }> = [
  { days: null, label: "No end date" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

/** The server's own sentence when it sent one, else the access words, else the fallback. */
function refusalText(d: unknown, fallback: string): string {
  const message = d && typeof d === "object" ? (d as { message?: unknown }).message : null;
  return typeof message === "string" && message.trim() ? message : accessMessage(d, fallback);
}

export function TaskPublicLinkDialog({
  itemId,
  open,
  onClose,
  onChanged,
}: {
  itemId: string;
  open: boolean;
  onClose: () => void;
  /** Whether the link is on, each time the server answers, so the host's menu row follows it. */
  onChanged?: (on: boolean) => void;
}) {
  const boot = useContext(BootContext)?.boot;
  const isAdmin = boot?.viewer.orgRole === "OWNER" || boot?.viewer.orgRole === "ADMIN";
  const [state, setState] = useState<LinkState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  const addressRef = useRef<HTMLInputElement>(null);
  const base = `/api/items/${encodeURIComponent(itemId)}/public-link`;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(refusalText(d, "Couldn't read this task's public link."));
        return;
      }
      setState(d as LinkState);
      onChanged?.(Boolean((d as LinkState).on));
    } catch {
      setLoadError("Couldn't read this task's public link. Check your connection and try again.");
    }
  }, [base, onChanged]);

  useEffect(() => {
    if (!open) return;
    const run = async () => {
      await load();
    };
    void run();
  }, [open, load]);

  const send = async (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown> | null, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(refusalText(d, fallback));
        // The state the refusal was about has moved on: show the true one.
        if (res.status === 409) await load();
        return;
      }
      setState(d as LinkState);
      onChanged?.(Boolean((d as LinkState).on));
      setCopy("idle");
    } catch {
      setError("Couldn't save that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const address = state?.url && typeof window !== "undefined" ? `${window.location.origin}${state.url}` : null;

  const copyAddress = async () => {
    if (!address) return;
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(address);
      setCopy("copied");
    } catch {
      addressRef.current?.focus();
      addressRef.current?.select();
      setCopy("manual");
    }
  };

  // Why it cannot be turned on, for someone who may share it.
  const offReason = !state || state.on || !state.canManage || state.canTurnOn
    ? null
    : !state.allowed
      ? "public_links_off"
      : state.system
        ? "This belongs to a meeting, so it can't be shared publicly."
        : state.personal
        ? "This task is in your Personal List, which is yours alone, so it can't be shared publicly."
        : state.inTrash === "task"
          ? "This task is in Trash, so it can't be shared."
          : state.inTrash === "place"
            ? "This task's List, Folder or Space is in Trash, so it can't be shared."
            : null;

  // Why a link that is on shows nothing right now.
  const deadNote = !state?.on
    ? null
    : state.inTrash === "task"
      ? "This task is in Trash, so its link shows nothing until the task is restored."
      : state.inTrash === "place"
        ? "This task's List, Folder or Space is in Trash, so its link shows nothing until it is restored."
        : !state.allowed
          ? "public_links_off"
          : state.expired
            ? "This link has ended. Choose how long it lasts to turn the same address back on."
            : null;

  const endsLine = !state?.on
    ? null
    : state.expiresAt
      ? `${state.expired ? "Ended" : "Ends"} ${formatTaskDate(state.expiresAt, null, { withWeekday: true })}`
      : "Never ends";

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent className="max-w-[460px]">
        <DialogTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-ink-2" strokeWidth={1.75} aria-hidden />
          Public link
        </DialogTitle>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Anyone with the link can see this task&rsquo;s title, status, priority, dates, description (as written), checklist and subtasks, and
          your workspace&rsquo;s name and logo, without signing in. They can&rsquo;t change anything, and they never see files or emails.
        </p>

        {loadError ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5" role="alert">
            <p className="text-xs text-[var(--os-danger,#D92D20)]">{loadError}</p>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : !state ? (
          <p className="mt-4 text-xs text-ink-2" aria-busy="true">
            Loading…
          </p>
        ) : !state.canManage ? (
          <p className="mt-4 text-xs text-ink-2">
            {state.on ? "A public link to this task is on. " : ""}
            Only someone who can add tasks to this task&rsquo;s List, or a workspace admin, can share it publicly.
          </p>
        ) : offReason ? (
          offReason === "public_links_off" ? (
            <p className="mt-4 text-xs text-ink-2">
              Public links are turned off for this workspace.{" "}
              {isAdmin ? (
                <Link href="/settings/access" className="font-medium text-brand-deep underline-offset-2 hover:underline">
                  Turn them on in Settings, Access
                </Link>
              ) : (
                "A workspace admin can turn them on in Settings, Access."
              )}
            </p>
          ) : (
            <p className="mt-4 text-xs text-ink-2">{offReason}</p>
          )
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
              <span className="text-base font-medium text-ink">Anyone with the link can view</span>
              <Switch
                checked={state.on}
                onChange={(next) => void send(next ? "POST" : "DELETE", null, next ? "Couldn't turn on the public link." : "Couldn't turn off the public link.")}
                disabled={busy}
                aria-label="Anyone with the link can view"
              />
            </div>

            {state.on && address ? (
              <div className="mt-3 flex items-center gap-2">
                <input
                  ref={addressRef}
                  readOnly
                  value={address}
                  aria-label="Public link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 min-w-0 flex-1 rounded-md border border-line bg-subtle px-2 text-xs text-ink"
                />
                <Button size="sm" variant="secondary" onClick={() => void copyAddress()}>
                  {copy === "copied" ? "Copied" : "Copy link"}
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
            {copy === "manual" ? (
              <p className="mt-1.5 text-xs text-ink-2" role="status">
                The address is selected: press Ctrl+C (Cmd+C on a Mac) to copy it.
              </p>
            ) : null}

            {state.on ? (
              <>
                <div className="mt-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-ink">How long it lasts</span>
                    <span className="text-xs text-ink-2">{endsLine}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="How long the link lasts">
                    {EXPIRY_CHOICES.map((c) => {
                      // Only "No end date" is a state the server can state; a
                      // length is an action, and the line above says when it ends.
                      const current = c.days === null && !state.expiresAt;
                      return (
                        <button
                          key={c.label}
                          type="button"
                          disabled={busy}
                          {...(c.days === null ? { "aria-pressed": current } : {})}
                          onClick={() => void send("PATCH", { expiresInDays: c.days }, "Couldn't change how long the link lasts.")}
                          className={`h-7 rounded-md border px-2.5 text-xs font-medium ${current ? "border-[var(--os-brand)] bg-brand-soft text-brand-deep" : "border-line text-ink hover:bg-hover"}`}
                        >
                          {c.days === null ? c.label : `${c.label} from now`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">Show assignees and comments</span>
                    <span className="block text-xs text-ink-2">
                      Adds the assignees&rsquo; first names and the latest 200 comments, as written, with the names they mention. Files stay hidden.
                    </span>
                  </span>
                  <Switch
                    checked={state.showPeople}
                    onChange={(next) => void send("PATCH", { showPeople: next }, "Couldn't change what the link shows.")}
                    disabled={busy}
                    aria-label="Show assignees and comments"
                  />
                </div>
              </>
            ) : null}

            {deadNote === "public_links_off" ? (
              <p className="mt-3 text-xs text-ink-2">
                Public links are turned off for this workspace, so this link shows nothing until they are turned back on.{" "}
                {isAdmin ? (
                  <Link href="/settings/access" className="font-medium text-brand-deep underline-offset-2 hover:underline">
                    Turn them on in Settings, Access
                  </Link>
                ) : (
                  "A workspace admin can turn them on in Settings, Access."
                )}
              </p>
            ) : deadNote ? (
              <p className="mt-3 text-xs text-ink-2">{deadNote}</p>
            ) : null}
            {state.on ? (
              <p className="mt-2 text-xs text-ink-3">Turning it off stops this address for good. Turning it on again makes a new one.</p>
            ) : null}
          </>
        )}

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
