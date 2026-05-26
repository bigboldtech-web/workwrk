"use client";

/* OsActivityFeed — renders /api/item-activity?entityType=…&entityId=… as
 * a timeline of "Person <verb> <field> from X to Y, N min ago" rows.
 *
 * Used by the item drawer's Activity tab AND the full-page item detail's
 * Activity tab. Reads only — activity rows are written server-side by
 * PATCH handlers via logItemActivity() (see src/lib/activity/log.ts).
 */

import { useEffect, useMemo, useState } from "react";
import { History, Sparkles } from "lucide-react";
import { C } from "./catalog";

type Activity = {
  id: string;
  action: string;
  meta?: Record<string, unknown> | null;
  actorId?: string | null;
  actorName?: string | null;
  actorImage?: string | null;
  createdAt: string;
};

/** Map a moduleId → the entityType string used by backend PATCH handlers
 *  when writing to ItemActivity. Keep these in sync as more backends
 *  start logging. */
export const MODULE_ENTITY_TYPE: Record<string, string> = {
  tasks: "task",
  crm: "opportunity",
  itsm: "ticket",
  helpdesk: "support_ticket",
  recruiting: "application",
  meetings: "meeting",
  marketing: "campaign",
  procurement: "purchase_order",
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarColorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
}

function fmtRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Try to make an activity row read naturally — fall back to the raw
 *  action string if we don't recognise the shape. Treat meta keys
 *  defensively since they're arbitrary JSON. */
function renderAction(a: Activity): React.ReactNode {
  const action = a.action.toLowerCase();
  const m = (a.meta ?? {}) as Record<string, unknown>;
  const from = m.from as string | undefined;
  const to = m.to as string | undefined;
  const field = (m.field as string | undefined) ?? "";
  const value = (m.value as string | undefined) ?? "";
  const previousValue = (m.previousValue as string | undefined) ?? "";

  if (action === "created" || action === "create") {
    return <>created this item</>;
  }
  if (action === "deleted" || action === "delete") {
    return <>deleted this item</>;
  }
  if (action === "status_changed" || action === "status_change") {
    return <>changed <strong>status</strong>{from ? <> from <strong>{from}</strong></> : null}{to ? <> to <strong>{to}</strong></> : null}</>;
  }
  if (action === "priority_changed" || action === "priority_change") {
    return <>changed <strong>priority</strong>{from ? <> from <strong>{from}</strong></> : null}{to ? <> to <strong>{to}</strong></> : null}</>;
  }
  if (action === "renamed" || action === "title_changed") {
    return <>renamed to <strong>"{value || to || ""}"</strong></>;
  }
  if (action === "assigned" || action === "assignee_changed") {
    return <>assigned <strong>{value || to || "someone"}</strong></>;
  }
  if (action === "field_changed" && field) {
    return <>changed <strong>{field}</strong>{previousValue ? <> from <em>{previousValue}</em></> : null}{value ? <> to <em>{value}</em></> : null}</>;
  }
  // Fallback — render the action verbatim, lower-cased + spaced
  const friendly = a.action.replace(/_/g, " ").toLowerCase();
  return <>{friendly}{value ? <> · <em>{value}</em></> : null}</>;
}

/** Pick a dot color per action kind so the timeline reads at a glance. */
function dotColorFor(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("create"))   return C.indigo;
  if (a.includes("status"))   return C.orange;
  if (a.includes("priorit"))  return C.pink;
  if (a.includes("assign"))   return C.purple;
  if (a.includes("rename") || a.includes("title")) return C.blue;
  if (a.includes("delete"))   return C.red;
  if (a.includes("complete") || a.includes("done")) return C.green;
  return C.teal;
}

export function OsActivityFeed({
  moduleId, itemId, entityType: entityTypeOverride,
}: {
  moduleId: string;
  itemId: string;
  /** Override the moduleId → entityType mapping if a module's backend
   *  writes under a non-default string. */
  entityType?: string;
}) {
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entityType = entityTypeOverride ?? MODULE_ENTITY_TYPE[moduleId] ?? moduleId;

  useEffect(() => {
    if (!itemId || !entityType) return;
    let cancelled = false;
    setRows(null);
    fetch(`/api/item-activity?entityType=${entityType}&entityId=${itemId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((data) => {
        if (cancelled) return;
        const list: Activity[] = data.activity ?? data.data ?? [];
        // Reverse-chronological from the API; render that way
        setRows(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "load failed");
        setRows([]);
      });
    return () => { cancelled = true; };
  }, [entityType, itemId]);

  const ordered = useMemo(() => rows ?? [], [rows]);

  if (rows === null) {
    return (
      <div style={{ padding: "20px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
        Loading activity…
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <>
        <h3 className="os-drawer__section-title">
          <History />
          Activity
        </h3>
        <div style={{ padding: "20px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
          {error ? "Couldn't load activity." : "No activity yet."}
          <div style={{ marginTop: 6, fontSize: 11.5 }}>
            <Sparkles style={{ width: 12, height: 12, color: "var(--os-c-purple)", display: "inline", marginRight: 4 }} />
            As you and your team work on this item, every change shows up here.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <h3 className="os-drawer__section-title">
        <History />
        Activity
        <span style={{ fontWeight: 500, color: "var(--os-ink-3)", marginLeft: 6 }}>{ordered.length}</span>
      </h3>
      {ordered.map((a) => {
        const dot = dotColorFor(a.action);
        const who = a.actorName || (a.actorId ? "Someone" : "System");
        return (
          <div key={a.id} className="os-drawer__activity">
            <span className="os-drawer__activity-dot" style={{ background: dot }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ color: a.actorId ? avatarColorFor(a.actorId) : "var(--os-ink-2)" }}>{who}</strong>{" "}
              {renderAction(a)}
            </span>
            <span className="os-drawer__activity-time">{fmtRelative(a.createdAt)}</span>
          </div>
        );
      })}
    </>
  );
}
