"use client";

/* My settings · Profile · Your data · the skills a person showed their AI
 * teammates (review of docs/plans/ai-teammates-phase5.md step 3, M2;
 * Decisions 13, 14 and 25).
 *
 * The Skills tab lives in a teammate's settings drawer, which needs the AI
 * app. A person with AI off opens no drawer, so without this list their
 * recordings would be kept unseen and undeletable. Here, beside the download
 * of their data (which holds every skill whole), each skill of theirs in
 * this workspace is listed with its teammate, its steps and sites, the day
 * it will be deleted when its person or teammate is gone, and its chip, and
 * deleted behind a confirm. GET /api/teammate-skills (no teammate named) and
 * DELETE /api/teammate-skills/[id] need a signed-in person only, never the
 * AI app, and read by the person's own id: nobody else's skill is ever here.
 *
 * NOTHING IS DRAWN until the read is back, when it fails (the download still
 * holds them), or while the person keeps no skill: production, where no
 * skill was ever made, draws nothing. A recording has no Delete: Done or
 * Discard in its browser card end it (the route answers still_recording).
 *
 * Built from what is there (Decision 13, the founder's rule): the Skills
 * tab's bordered row list and StatusChip, the page's own dangerGhost button
 * and useConfirm. No blue button: the page's one is the Save bar's.
 */

import { useCallback, useEffect, useState } from "react";
import { btn } from "@/components/account/account-ui";
import { useOsToast } from "@/components/layout/os/toast";
import { StatusChip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { SKILLS_COPY as S } from "@/lib/agents/teammate-copy";
import { RUN_TONE_COLOR, type RunTone } from "@/lib/automation/run-status";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import type { SkillStatus } from "@/lib/skills/types";
import type { OwnSkillRow } from "@/lib/skills/views";

/** The Skills tab's chips (settings/skills-tab.tsx). */
const CHIP: Record<SkillStatus, { label: string; tone: RunTone }> = {
  draft: { label: S.draft, tone: "neutral" },
  ready: { label: S.ready, tone: "success" },
  recording: { label: S.recording, tone: "danger" },
};

export function TeammateSkillsList() {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const [skills, setSkills] = useState<OwnSkillRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<{ skills: OwnSkillRow[] }>("/api/teammate-skills", { cache: "no-store" });
    if (!r.ok) return;
    setSkills(Array.isArray(r.data.skills) ? r.data.skills : []);
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

  async function remove(s: OwnSkillRow) {
    const ok = await confirm({ title: S.deleteTitle, description: S.deleteBody, confirmLabel: S.delete, destructive: true });
    if (!ok) return;
    setBusy(s.id);
    const r = await apiFetch<{ deleted: boolean }>(`/api/teammate-skills/${encodeURIComponent(s.id)}`, { method: "DELETE", json: { organizationId: s.organizationId } });
    setBusy(null);
    if (!r.ok) {
      toast(r.error || S.deleteFailed, { tone: "danger" });
      if (r.code === "workspace_changed") window.location.reload();
      else void load();
      return;
    }
    setSkills((list) => (list ? list.filter((x) => x.id !== s.id) : list));
    toast(S.deleted);
  }

  if (!skills || skills.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="m-0 text-base font-medium text-ink">{S.accountHeading}</h3>
        <p className="m-0 mt-0.5 text-sm text-ink-2">{S.accountHint}</p>
      </div>
      <ul className="m-0 flex list-none flex-col rounded-md border border-line p-0">
        {skills.map((s) => (
          <li key={s.id} className="flex min-w-0 items-start gap-2 border-t border-line-soft px-3 py-2 first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="m-0 break-words text-base font-medium text-ink">{s.name}</p>
              {s.teammate ? <p className="m-0 break-words text-sm text-ink-2">{S.withTeammate(s.teammate)}</p> : null}
              <p className="m-0 break-words text-sm text-ink-2">{S.stepsLine(s.stepCount, s.sites.join(", "))}</p>
              {s.deletesOn ? <p className="m-0 text-sm text-ink-2">{S.deletesOnLine(formatDate(s.deletesOn, datePrefs, "date"))}</p> : null}
            </div>
            <StatusChip color={RUN_TONE_COLOR[CHIP[s.status].tone]} label={CHIP[s.status].label} className="shrink-0" />
            {s.status !== "recording" ? (
              <button type="button" className={btn.dangerGhost} disabled={busy === s.id} aria-label={S.deleteNamed(s.name)} onClick={() => void remove(s)}>
                {S.delete}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
