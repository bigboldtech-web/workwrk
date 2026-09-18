"use client";

// Request access (access-model-spec 5.6): the one primary on a LockedPage.
// A View / Edit choice (Comment for Docs), an optional message, one POST to
// /api/access-requests, then the button becomes "Request sent". The owner
// (or, with no owner, the workspace admins) gets an inbox row.

import { useState } from "react";
import { Dots } from "@/components/ui/dots";
import { apiFetch } from "@/lib/api-fetch";
import { OBJECT_ROLE_LABEL } from "@/lib/access/labels";

type Role = "VIEW" | "EDIT" | "COMMENT";

export function RequestAccessButton({
  objectType,
  objectId,
  roles = ["VIEW", "EDIT"],
  owner,
  label = "Request access",
}: {
  objectType: string;
  objectId: string;
  roles?: Role[];
  owner: { id: string; name: string } | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>(roles[0] ?? "VIEW");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "failed">("idle");

  const send = async () => {
    setState("busy");
    const r = await apiFetch("/api/access-requests", {
      method: "POST",
      json: { objectType, objectId, role, message: message.trim() || undefined },
    });
    setState(r.ok ? "sent" : "failed");
    if (r.ok) setOpen(false);
  };

  if (state === "sent") {
    return (
      <p className="m-0 text-base font-medium text-success-text">
        Request sent{owner ? ` to ${owner.name}` : ""}
      </p>
    );
  }

  const seg = "inline-flex h-8 items-center rounded-md px-3 text-base font-medium";

  return (
    <div className="flex flex-col items-center gap-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="os-chrome inline-flex h-9 items-center rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-[var(--os-brand-hover)]"
        >
          {label}
        </button>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className="os-chrome flex w-full max-w-sm flex-col items-stretch gap-3 rounded-lg border border-line bg-raised p-4 text-start"
        >
          {roles.length > 1 ? (
            <div role="radiogroup" aria-label="Access level" className="inline-flex self-center rounded-lg bg-subtle p-0.5">
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  onClick={() => setRole(r)}
                  className={`${seg} ${role === r ? "border border-line bg-raised text-ink" : "text-ink-2 hover:text-ink"}`}
                >
                  {OBJECT_ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">Message (optional)</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={owner ? `Tell ${owner.name} why you need this` : "Tell the admins why you need this"}
              className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base text-ink placeholder:text-ink-3"
            />
          </label>
          {state === "failed" ? <p className="m-0 text-sm text-danger-text">Couldn&apos;t send the request. Try again.</p> : null}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={`${seg} text-ink-2 hover:bg-hover hover:text-ink`}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={state === "busy"}
              className="inline-flex h-8 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-[var(--os-brand-hover)] disabled:opacity-70"
            >
              {state === "busy" ? <Dots variant="pending" /> : null}
              Send request
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
