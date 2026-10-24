"use client";

// Apps & modules > AI apps (MCP) (docs/plans/mcp-server.md 6.3, Decision 9,
// 3.9): the workspace switch that lets people connect the AI apps they use
// (Claude, ChatGPT, Cursor, VS Code) through the WorkwrK MCP server, the
// optional list of allowed apps, and the counts. Owners and Admins only: GET
// /api/ai-apps/policy answers anyone else with the Apps page's own refusal
// (403), and answers 404 while this WorkwrK does not offer the MCP server
// (MCP_OFFERED unset); either way this section then draws nothing.
//
//   loading      nothing is drawn until the first answer (the browser
//                section's rule: no section or intro flashes first, so
//                production draws nothing while MCP_OFFERED is unset)
//   otherwise    the switch (turning it off asks first, naming how many
//                connections it ends, and disconnects every AI app here at
//                once); AI off or a closed workspace says so, and the switch
//                can then not be turned on, though it can always go off;
//                Allowed apps, the browser section's chip list
//                (components/settings/site-chips.tsx), its hint one line and
//                the sites to add behind Show more, each change one PUT
//                of one app added or taken away, which the route works out
//                from the list as it is under its lock, so another Admin's
//                change a moment ago is kept (review of step 4, L2), a
//                refused entry said under its field; the live connections,
//                the people holding them and today's requests and things
//                made or changed, counts only, with a link to the Audit
//                log's Data tab, where each change is a row
//
// THE WORKSPACE IS PINNED to the first answer's (review of step 4, L3):
// every change names it, a session switched to another workspace in another
// tab answers workspace_changed, and a later read (the focus reload) that
// answers another workspace reloads the page rather than drawing that
// workspace's switch under this one's changes. Either way the page reloads
// into the workspace the person is in now. No blue button:
// the switch and the list save as they change (the page's own rule). Every
// sentence comes from src/lib/mcp/mcp-copy.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ConfirmDialog } from "@/components/settings/settings-form";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SiteChips } from "@/components/settings/site-chips";
import { Switch } from "@/components/ui/switch";
import { ErrorState } from "@/components/ui/error-state";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { MCP_POLICY_COPY, MCP_SETTINGS_COPY as C } from "@/lib/mcp/mcp-copy";
import type { McpPolicyAdminView } from "@/lib/mcp/policy-admin";

const LINK = "font-medium text-brand-deep hover:underline";
const ROUTE = "/api/ai-apps/policy";
/** The Audit log's Data tab, where each change an app made is a row (src/lib/audit-families.ts). */
const AUDIT_HREF = "/settings/audit?tab=data";
const CHIP_WORDS = { addSite: C.addApp, addPlaceholder: C.addPlaceholder, remove: C.remove };

/** What the route answers: the counts, and the workspace they were read in. */
type McpPolicyView = McpPolicyAdminView & { organizationId: string };
type McpPolicyChanged = McpPolicyView & { revoked: number };

export function McpSection() {
  const { toast } = useOsToast();
  const [view, setView] = useState<McpPolicyView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [busy, setBusy] = useState(false);
  // The workspace the first answer was read in: every change sends it, and no later read draws another.
  const [shownIn, setShownIn] = useState("");
  const pinned = useRef<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<McpPolicyView>(ROUTE, { cache: "no-store" });
    if (!r.ok) {
      // Not offered here (404), or not an Owner or Admin now (403): the section is not theirs to see.
      if (r.status === 403 || r.status === 404) { setState("hidden"); return; }
      setError(r.error);
      setState("error");
      return;
    }
    if (pinned.current === null) {
      pinned.current = r.data.organizationId;
      setShownIn(r.data.organizationId);
    } else if (r.data.organizationId !== pinned.current) {
      // The session moved to another workspace in another tab: the whole page goes with it.
      window.location.reload();
      return;
    }
    setView(r.data);
    setState("ready");
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  /** A refusal's sentence; a session switched to another workspace reloads the page. */
  const refused = useCallback((r: { error: string; code?: string }) => {
    toast(r.error || C.saveFailed, { tone: "danger" });
    if (r.code === "workspace_changed") window.location.reload();
  }, [toast]);

  /** Saved, and how many AI apps the change disconnected. */
  const saved = useCallback((revoked: number) => {
    toast(revoked > 0 ? `${C.saved}. ${C.disconnected(revoked)}` : C.saved);
  }, [toast]);

  const setEnabled = useCallback(async (on: boolean): Promise<boolean> => {
    setSaving(true);
    const r = await apiFetch<McpPolicyChanged>(ROUTE, {
      method: "PUT",
      json: { organizationId: shownIn, enabled: on },
    });
    setSaving(false);
    if (!r.ok) {
      refused(r);
      return false;
    }
    setView(r.data);
    setSavedAt(Date.now());
    saved(r.data.revoked);
    return true;
  }, [shownIn, refused, saved]);

  /**
   * One app added to or taken from the list; the field's own error, or null
   * when it went. Only the one change is sent, and the route applies it to
   * the list as it is under its lock: another Admin's change since this
   * page loaded is kept rather than undone.
   */
  const changeApp = useCallback(async (_list: "apps", change: { add: string } | { remove: string }): Promise<string | null> => {
    const r = await apiFetch<McpPolicyChanged>(ROUTE, {
      method: "PUT",
      json: "add" in change ? { organizationId: shownIn, addApp: change.add } : { organizationId: shownIn, removeApp: change.remove },
    });
    if (!r.ok) {
      if (r.code === "workspace_changed") { refused(r); return r.error; }
      // A refused entry or a full list is said under its field; anything else in a toast too.
      if (r.code !== "invalid_app" && r.code !== "too_many_apps") toast(r.error || C.saveFailed, { tone: "danger" });
      return r.error || C.saveFailed;
    }
    setView(r.data);
    saved(r.data.revoked);
    return null;
  }, [shownIn, refused, saved, toast]);

  // Drawn only once its answer is known: nothing while it loads, for anyone
  // the route refuses, or where this WorkwrK does not offer the MCP server.
  if (state === "hidden" || !view) return null;

  // Turning on needs AI features on and an open workspace (the route's 409s); turning off always works.
  const canTurnOn = !view.aiOff && view.workspaceOpen;
  const why = view.aiOff ? (view.enabled ? C.aiOffWhileOn : C.aiOff) : !view.workspaceOpen ? MCP_POLICY_COPY.workspaceClosed : null;

  // The card alone: the page's one AI label groups it with the teammates'
  // cards, so no section label repeats its title (settings-cleanup B3).
  return (
    <>
      {/* The anchor the consent page's no-workspace line and the docs point to (/settings/apps#ai-apps). */}
      <SettingsCard id="ai-apps" title={C.title} description={C.intro}>
        {state === "error" ? (
          // A reload of a section already known failed: its last answer said what to draw.
          <ErrorState compact what={C.errorWhat} hint={error ?? undefined} onRetry={() => { void load(); }} />
        ) : (
          <>
            {why ? <p className="text-sm text-ink-2">{why}</p> : null}
            <SettingsRow
              label={C.switchLabel}
              helper={C.switchHint}
              savedAt={savedAt}
              control={
                <Switch
                  checked={view.enabled}
                  disabled={saving || (!view.enabled && !canTurnOn)}
                  onChange={(next) => {
                    if (next) void setEnabled(true);
                    else setTurningOff(true);
                  }}
                  aria-label={C.switchLabel}
                />
              }
            />
            <SiteChips list="apps" heading={C.allowedHeading} hint={C.allowedHint} more={C.allowedMore} sites={view.allowedApps} onChange={changeApp} words={CHIP_WORDS} />
            <div>
              <h3 className="mb-1 text-sm font-medium text-ink">{C.usageHeading}</h3>
              <p className="text-sm text-ink-2">{C.connections(view.connections, view.people)}</p>
              <p className="text-sm text-ink-2">{C.today(view.today.calls, view.today.changes)}</p>
              <p className="mt-1 text-sm">
                <Link href={AUDIT_HREF} className={LINK}>{C.auditLink}</Link>
              </p>
            </div>
          </>
        )}
      </SettingsCard>

      <ConfirmDialog
        open={turningOff}
        onOpenChange={(v) => { if (!busy) setTurningOff(v); }}
        title={C.turnOffTitle}
        confirmLabel={C.turnOff}
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          const ok = await setEnabled(false);
          setBusy(false);
          if (ok) setTurningOff(false);
        }}
      >
        <p>{C.turnOffBody(view.connections)}</p>
      </ConfirmDialog>
    </>
  );
}
