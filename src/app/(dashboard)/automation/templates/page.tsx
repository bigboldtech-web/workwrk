"use client";

/* /automation/templates — the starter-recipe gallery.
 *
 *  GET  /api/automation/templates    → global AutomationTemplate rows
 *                                      (the API seeds 5 recipes if empty)
 *  POST /api/automation/workflows    → "Use template" clones templateJson
 *                                      into a new DRAFT, then routes to
 *                                      the builder to finish and publish.
 *
 * Monday-style sentence cards: the template name IS the recipe sentence.
 * Templates on not-yet-emitting triggers carry the same honest chip the
 * builder uses.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Loader2, Zap } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { AutomationHeader, CARD, DARK_PILL, SEVERITY_META } from "../shared";

interface ApiTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  severity: string;
  templateJson: unknown;
}

interface ApiTrigger {
  key: string;
  name: string;
  isEmitting: boolean;
}

function templateTrigger(t: ApiTemplate): string | null {
  if (t.templateJson && typeof t.templateJson === "object") {
    const v = (t.templateJson as Record<string, unknown>).triggerEvent;
    if (typeof v === "string" && v) return v;
  }
  return null;
}

export default function AutomationTemplatesPage() {
  const router = useRouter();
  const { toast } = useOsToast();
  const [templates, setTemplates] = useState<ApiTemplate[] | null>(null);
  const [triggers, setTriggers] = useState<Map<string, ApiTrigger>>(new Map());
  const [usingId, setUsingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/automation/templates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setTemplates(Array.isArray(d?.templates) ? d.templates : []);
      })
      .catch(() => {
        if (alive) {
          setTemplates([]);
          toast("Couldn't load templates");
        }
      });
    fetch("/api/automation/triggers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.triggers)) {
          setTriggers(new Map((d.triggers as ApiTrigger[]).map((t) => [t.key, t])));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [toast]);

  const applyTemplate = useCallback(
    async (t: ApiTemplate) => {
      const json =
        t.templateJson && typeof t.templateJson === "object"
          ? (t.templateJson as Record<string, unknown>)
          : {};
      setUsingId(t.id);
      try {
        const res = await fetch("/api/automation/workflows", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: t.name,
            description: t.description ?? undefined,
            triggerEvent: typeof json.triggerEvent === "string" ? json.triggerEvent : undefined,
            severity: t.severity,
            definition:
              json.definition && typeof json.definition === "object" ? json.definition : undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(data?.error ?? "Couldn't create the automation");
          return;
        }
        toast("Draft created from template");
        router.push(`/automation/workflows/${data.workflow.id}`);
      } catch {
        toast("Couldn't create the automation");
      } finally {
        setUsingId(null);
      }
    },
    [router, toast],
  );

  return (
    <div className="flex h-full flex-col bg-white">
      <AutomationHeader
        Icon={LayoutTemplate}
        title="Templates"
        meta={
          templates && templates.length > 0 ? (
            <span className="tabular-nums">{templates.length} starter recipes</span>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-4">
        {templates === null ? (
          <div className="flex items-center gap-2 p-6 text-[13px] text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center pt-20">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-zinc-50">
              <Zap className="h-5 w-5 text-zinc-500" />
            </span>
            <h2 className="mt-4 text-[16px] font-semibold text-zinc-900">No templates yet</h2>
            <p className="mt-1 max-w-sm text-center text-[13px] text-zinc-500">
              Starter recipes appear here. You can always build an automation from scratch in
              Workflows.
            </p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => {
              const triggerKey = templateTrigger(t);
              const trigger = triggerKey ? triggers.get(triggerKey) : undefined;
              const severityMeta = SEVERITY_META.find((s) => s.key === t.severity);
              return (
                <div key={t.id} className={`${CARD} flex flex-col p-4`}>
                  <div className="flex items-center gap-1.5">
                    {t.category ? (
                      <span className="inline-flex h-[18px] items-center rounded-md border border-zinc-200 bg-zinc-50 px-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500">
                        {t.category}
                      </span>
                    ) : null}
                    {severityMeta && severityMeta.key !== "MINOR" ? (
                      <span
                        className="inline-flex h-[18px] items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold uppercase tracking-wide"
                        style={{
                          backgroundColor: `${severityMeta.color}14`,
                          color: severityMeta.color,
                          border: `1px solid ${severityMeta.color}33`,
                        }}
                      >
                        {severityMeta.label}
                      </span>
                    ) : null}
                    {trigger && !trigger.isEmitting ? (
                      <span
                        className="inline-flex h-[18px] items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                        title="This trigger event isn't emitting yet — the recipe goes live automatically once its module ships."
                      >
                        not live yet
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-2.5 text-[14.5px] font-semibold leading-snug text-zinc-900">
                    {t.name}
                  </h3>
                  <p className="mt-1.5 flex-1 text-[12px] leading-relaxed text-zinc-500">
                    {t.description}
                  </p>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => void applyTemplate(t)}
                      disabled={usingId !== null}
                      className={DARK_PILL}
                    >
                      {usingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Use template
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
