"use client";

// Open access requests (access-model-spec 5.6 item 4: "Open requests show in
// the dialog footer and on /settings/access"; Phase 8 stage E). One row per
// PENDING request this person may answer: who, what they asked for, and one
// click to give it, give view instead, or decline. A grant goes through
// PATCH /api/access-requests/[id], which writes it with grants.ts, so the
// Manage access dialog's rules hold. A kind grants.ts does not own opens the
// object to share it there.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SettingsCard } from "@/components/settings/settings-card";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { Avatar } from "@/components/ui/avatar-stack";
import { apiFetch } from "@/lib/api-fetch";
import { OBJECT_ROLE_LABEL } from "@/lib/access/labels";

interface IncomingRequest {
  id: string;
  objectType: string;
  objectId: string;
  role: "VIEW" | "COMMENT" | "EDIT";
  message: string | null;
  createdAt: string;
  link: string | null;
  name: string | null;
  grantable: boolean;
  requester: { id: string; name: string; avatar: string | null };
}

const GIVE: Record<IncomingRequest["role"], string> = { EDIT: "Give edit", COMMENT: "Give comment", VIEW: "Give view" };

const NOUN: Record<string, string> = {
  space: "a Space", folder: "a Folder", list: "a List", board: "a List", doc: "a Doc", table: "a Table",
  canvas: "a Canvas", whiteboard: "a Canvas", form: "a Form", sop: "a SOP", sop_folder: "a SOP folder",
  goal: "a goal", tool: "a tool", contract: "an agreement",
};

export function AccessRequestsCard() {
  const [items, setItems] = useState<IncomingRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<{ incoming: IncomingRequest[] }>("/api/access-requests", { cache: "no-store" });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setItems(r.data.incoming);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const decide = async (req: IncomingRequest, decision: "grant" | "decline", role?: IncomingRequest["role"]) => {
    setBusy(req.id);
    setRowError((e) => ({ ...e, [req.id]: "" }));
    const r = await apiFetch<{ message?: string }>(`/api/access-requests/${req.id}`, { method: "PATCH", json: role ? { decision, role } : { decision } });
    setBusy(null);
    if (!r.ok) {
      setRowError((e) => ({ ...e, [req.id]: r.error || "Couldn't answer that request" }));
      return;
    }
    setItems((list) => (list ?? []).filter((x) => x.id !== req.id));
  };

  const btn = "os-chrome inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover disabled:text-ink-3";

  return (
    <SettingsCard title="Access requests" id="access.requests" wide="access.toggles" description="People asking to open something. Answering here is the same as sharing it from its menu.">
      {error ? (
        <ErrorState what="the open requests" hint={error} onRetry={() => { void load(); }} />
      ) : items === null ? (
        <SkeletonRows rows={2} />
      ) : items.length === 0 ? (
        <p className="text-base text-ink-2">No open requests.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((req) => (
            <li key={req.id} className="flex min-h-14 items-center gap-3 border-b border-line-soft py-2 last:border-b-0">
              <Avatar person={{ id: req.requester.id, firstName: req.requester.name, lastName: "", avatar: req.requester.avatar }} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base text-ink">
                  <span className="font-medium">{req.requester.name}</span> asked for {OBJECT_ROLE_LABEL[req.role]} on{" "}
                  {(() => {
                    const what = req.name ? `${(NOUN[req.objectType] ?? "").replace(/^an? /, "")} ${req.name}`.trim() : NOUN[req.objectType] ?? "something";
                    return req.link ? <Link href={req.link} className="text-brand-deep hover:underline">{what}</Link> : what;
                  })()}
                </p>
                {req.message ? <p className="truncate text-sm text-ink-2">&ldquo;{req.message}&rdquo;</p> : null}
                {rowError[req.id] ? <p className="text-sm text-danger-text" role="alert">{rowError[req.id]}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {req.grantable ? (
                  <>
                    <button type="button" className={btn} disabled={busy === req.id} onClick={() => { void decide(req, "grant", req.role); }}>
                      {GIVE[req.role]}
                    </button>
                    {req.role !== "VIEW" ? (
                      <button type="button" className={btn} disabled={busy === req.id} onClick={() => { void decide(req, "grant", "VIEW"); }}>
                        Give view
                      </button>
                    ) : null}
                  </>
                ) : req.link ? (
                  <Link href={req.link} className={btn}>Open to share</Link>
                ) : null}
                <button type="button" className={btn} disabled={busy === req.id} onClick={() => { void decide(req, "decline"); }}>
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
