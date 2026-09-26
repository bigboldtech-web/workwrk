"use client";

/* /automation/templates: start from an automation someone already worked out
 * (spec-ai-automation /automation/templates).
 *
 *   GET  /api/automation/templates   the recipes (the API seeds any missing
 *                                    fixed recipe; the Cashkr-era Leads
 *                                    recipe is behind the legacy flag)
 *   POST /api/automation/workflows   "Use this" clones a recipe into a new
 *                                    DRAFT and opens it in the builder
 *
 * No page-level primary: the honest primary is per recipe, so each card
 * carries one secondary "Use this". A recipe on a trigger that does not fire
 * yet says so with a "Not live yet" chip and stays usable.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { SkeletonCard } from "@/components/ui/skeleton";
import { BTN, CARD, InlineRow, NeutralChip, useAutomationCatalog, useAutomationRights } from "@/components/automation/automation-ui";
import { apiFetch } from "@/lib/api-fetch";
import { notifyAiChatsChanged } from "@/lib/ai/events";

interface ApiTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  severity: string;
  templateJson: unknown;
}

interface TemplateJson {
  triggerEvent?: string;
  definition?: { actions?: Array<{ key?: string }>; [k: string]: unknown };
}

function readJson(t: ApiTemplate): TemplateJson {
  return t.templateJson && typeof t.templateJson === "object" ? (t.templateJson as TemplateJson) : {};
}

export default function AutomationTemplatesPage() {
  const router = useRouter();
  const { toast } = useOsToast();
  const rights = useAutomationRights();
  const catalog = useAutomationCatalog({ actions: true });
  const [templates, setTemplates] = useState<ApiTemplate[] | null>(null);
  const [error, setError] = useState(false);
  const [usingId, setUsingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<{ templates: ApiTemplate[] }>("/api/automation/templates", { cache: "no-store" });
    if (!r.ok) {
      setError(true);
      return;
    }
    setError(false);
    setTemplates(Array.isArray(r.data.templates) ? r.data.templates : []);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const triggerByKey = useMemo(() => new Map(catalog.triggers.map((t) => [t.key, t])), [catalog.triggers]);
  const actionByKey = useMemo(() => new Map(catalog.actions.map((a) => [a.key, a])), [catalog.actions]);

  /** "When a task is created, send an in-app notification." */
  const sentence = useCallback((t: ApiTemplate): string => {
    const json = readJson(t);
    const trig = json.triggerEvent ? triggerByKey.get(json.triggerEvent) : undefined;
    const acts = (json.definition?.actions ?? [])
      .map((a) => (a.key ? actionByKey.get(a.key)?.name : undefined))
      .filter((n): n is string => Boolean(n))
      .map((n) => n.charAt(0).toLowerCase() + n.slice(1));
    if (!trig || acts.length === 0) return t.description ?? "";
    return `When ${trig.phrase}, ${acts.join(", and then ")}.`;
  }, [triggerByKey, actionByKey]);

  const applyTemplate = useCallback(async (t: ApiTemplate) => {
    const json = readJson(t);
    setUsingId(t.id);
    const r = await apiFetch<{ workflow: { id: string } }>("/api/automation/workflows", {
      method: "POST",
      json: {
        name: t.name,
        description: t.description ?? undefined,
        triggerEvent: json.triggerEvent,
        severity: t.severity,
        definition: json.definition,
      },
    });
    setUsingId(null);
    if (!r.ok) {
      toast(r.error || "Couldn't create the automation", { tone: "danger" });
      return;
    }
    const id = r.data.workflow.id;
    notifyAiChatsChanged();
    // The draft is theirs, so its creator may take it back. Undo archives it
    // (the hub never hard-deletes: run history and versions stay), and a
    // failed Undo says so instead of leaving the draft behind in silence.
    const undo = async () => {
      const u = await apiFetch(`/api/automation/workflows/${id}`, { method: "DELETE" });
      if (!u.ok) {
        toast("Couldn't undo. The draft is still in Workflows.", { tone: "danger", action: { label: "Try again", onClick: () => void undo() } });
        return;
      }
      notifyAiChatsChanged();
      router.push("/automation/templates");
    };
    toast("Draft created", { action: { label: "Undo", onClick: () => void undo() } });
    router.push(`/automation/workflows/${id}`);
  }, [router, toast]);

  const ready = templates !== null && catalog.loaded;
  const visible = ready
    ? templates.filter((t) => {
        const key = readJson(t).triggerEvent;
        return !(key && triggerByKey.get(key)?.hidden);
      })
    : null;

  return (
    <>
      <OsPageHeader title="Templates" />
      <div className="px-6 pb-10 pt-2">
        <div className="os-chrome">
        {error ? (
          <InlineRow action={{ label: "Try again", onClick: () => void load() }} className="justify-center">Couldn&apos;t load templates</InlineRow>
        ) : visible === null ? (
          <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-2 min-[1280px]:grid-cols-3" aria-busy="true" aria-label="Loading templates">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : visible.length === 0 ? (
          <OsEmptyView title="No templates yet" action={{ label: "Create an automation from scratch", href: "/automation/workflows" }} />
        ) : (
          <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-2 min-[1280px]:grid-cols-3">
            {visible.map((t) => {
              const key = readJson(t).triggerEvent;
              const trig = key ? triggerByKey.get(key) : undefined;
              // Using a template is a create, which every Member may do.
              const canUse = rights.canCreate;
              return (
                <div
                  key={t.id}
                  tabIndex={canUse ? 0 : undefined}
                  onKeyDown={canUse ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget && usingId === null) void applyTemplate(t); } : undefined}
                  className={`${CARD} flex flex-col p-4 outline-none focus-visible:border-brand`}
                >
                  <h2 className="m-0 text-row font-medium text-ink">{t.name}</h2>
                  <p className="m-0 mt-1 line-clamp-2 text-sm text-ink-2" title={t.description ?? undefined}>{sentence(t)}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {t.category ? <NeutralChip>{t.category}</NeutralChip> : null}
                    {trig && !trig.isEmitting ? <NeutralChip title="This trigger does not fire yet.">Not live yet</NeutralChip> : null}
                  </div>
                  <span className="flex-1" />
                  {canUse ? (
                    <div className="mt-4">
                      <button type="button" onClick={() => void applyTemplate(t)} disabled={usingId !== null} className={BTN.secondarySm}>
                        {usingId === t.id ? "Creating" : "Use this"}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>
    </>
  );
}
