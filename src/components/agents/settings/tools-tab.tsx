"use client";

// The Tools and approvals tab of a teammate's settings
// (docs/plans/ai-teammates.md 5.5): the tool picker (tool-picker.tsx) over
// the route's table of its tools for this person (teammate-views.ts
// toolSettings, rows by teammate-setup.ts settingsToolGroups).
//
//   its managers   tick its tools (PATCH toolNames, with the Google products
//                  whose rows it showed: teammate-setup.ts toolsPatch, so a
//                  Google tool nobody was shown is kept as stored) and, on a
//                  workspace teammate, "Ask everyone first" (PATCH
//                  agentRules: they only tighten)
//   everyone       their own "Ask me first" / "Don't ask" per tool
//                  (PUT .../approvals), and a Remove for each "Don't ask" an
//                  approval card stored: one Talk conversation, or a tool's
//                  calls other people will see ("<tool>:outward")
//
// Nothing here sets one of those per-target choices. The footer says how
// approvals work. A removed teammate's tools cannot change; the person's own
// choices still can.

import { useState } from "react";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { TEAMMATE_SETTINGS } from "@/lib/agents/teammate-copy";
import { agentRulesWith, choiceEdit, ruleRemoval, settingsToolGroups, toolsPatch } from "@/lib/agents/teammate-setup";
import type { TeammateDetail, ToolSetting } from "@/lib/agents/teammate-views";
import type { ApprovalChoice } from "@/lib/agents/tool-policy";
import type { ToolName } from "@/lib/agents/tool-names";
import { ToolPicker } from "../tool-picker";

export function ToolsTab({
  teammate: t,
  canManage,
  onSaved,
  onTools,
}: {
  teammate: TeammateDetail;
  canManage: boolean;
  /** PATCH's answer: the drawer, the list and the chat read it. */
  onSaved: (t: TeammateDetail) => void;
  /** PUT .../approvals' answer: the whole table as it now stands. */
  onTools: (tools: ToolSetting[]) => void;
}) {
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);
  const manages = canManage && t.status !== "ARCHIVED";
  const groups = settingsToolGroups(t.tools, { canManage: manages, workspace: t.visibility === "WORKSPACE" });
  const base = `/api/agents/teammates/${encodeURIComponent(t.slug)}`;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    const r = await apiFetch<{ teammate: TeammateDetail; scheduleStopped?: boolean }>(base, { method: "PATCH", json: body });
    setBusy(false);
    if (!r.ok) {
      toast(r.code ? r.error : TEAMMATE_SETTINGS.saveFailed, { tone: "danger" });
      return;
    }
    if (r.data.scheduleStopped) toast(TEAMMATE_SETTINGS.scheduleStopped);
    onSaved(r.data.teammate);
  }

  async function putRules(rules: Record<string, ApprovalChoice | null>) {
    setBusy(true);
    const r = await apiFetch<{ tools: ToolSetting[] }>(`${base}/approvals`, { method: "PUT", json: { rules } });
    setBusy(false);
    if (!r.ok) {
      toast(r.code ? r.error : TEAMMATE_SETTINGS.choiceFailed, { tone: "danger" });
      return;
    }
    onTools(r.data.tools);
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 ? (
        <p className="m-0 text-base text-ink-2">{TEAMMATE_SETTINGS.noTools}</p>
      ) : (
        <ToolPicker
          groups={groups}
          canTick={manages}
          busy={busy}
          onTick={(name: ToolName, on: boolean) => void patch(toolsPatch(t.tools, name, on))}
          onChoice={(name, value) => void putRules(choiceEdit(name, value))}
          onAskEveryone={(name, ask) => void patch({ agentRules: agentRulesWith(t.tools, name, ask) })}
          onRemoveRule={(key) => void putRules(ruleRemoval(key))}
        />
      )}
      <p className="m-0 text-sm text-ink-2">{TEAMMATE_SETTINGS.toolsFooter}</p>
    </div>
  );
}
