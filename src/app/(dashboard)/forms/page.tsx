"use client";

/* Forms: the org's forms (Tables hub; the directory layout renders ModuleOff
 * when the Tables module is off).
 *
 * The one page pattern (design-system 4.4): OsPageHeader with the one blue
 * "New form" primary and "AI generate" as a ghost action, SkeletonRows while
 * loading, ErrorState with Try again on a failed read, the quiet OsEmptyView
 * when there are none, and the card grid otherwise. Click a card to open the
 * builder. ?new=1 (the hub "+") opens the name prompt once on arrival.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus, Globe, Lock, Inbox, ChevronRight, Sparkles } from "lucide-react";
import { OsPageHeader, HeaderAction } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { usePrompt } from "@/components/ui/dialog-provider";

type ApiForm = {
  id: string; name: string; description?: string | null;
  isPublic: boolean; targetBoardId?: string | null;
  createdAt: string; updatedAt: string;
  submissionCount: number;
};

export default function FormsPage() {
  const router = useRouter();
  const search = useSearchParams();
  // Armed latch for ?new=1: disarms on fire, re-arms when the param leaves
  // the URL (via router.replace, which a plain history.replaceState cannot
  // do since Next's searchParams never sees it).
  const newArmed = useRef(true);
  const [forms, setForms] = useState<ApiForm[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();
  const promptDialog = usePrompt();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/forms");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setForms(d.data ?? (Array.isArray(d) ? d : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("forms");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const name = (await promptDialog({ title: "Form name?" }))?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/forms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, fields: [] }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const d = await res.json();
      const f = d.data ?? d;
      router.push(`/forms/${f.id}`);
    } catch { toast("Couldn't create form"); }
  }

  // The hub "+" routes here with ?new=1: open quick-add and strip the param
  // via the router, re-arming the latch, so the "+" works every time,
  // including after the person cancels the name prompt.
  useEffect(() => {
    if (search?.get("new") !== "1") { newArmed.current = true; return; }
    if (!newArmed.current) return;
    newArmed.current = false;
    router.replace("/forms", { scroll: false });
    void quickAdd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, router]);

  const [generating, setGenerating] = useState(false);
  async function aiGenerate() {
    if (generating) return;
    const prompt = (await promptDialog({ title: "Describe the form you want (e.g. 'Customer support ticket', 'Event RSVP', 'Vendor onboarding'):" }))?.trim();
    if (!prompt) return;
    setGenerating(true);
    try {
      const gen = await fetch("/api/forms/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!gen.ok) { const err = await gen.json().catch(() => ({ error: `HTTP ${gen.status}` })); toast(`AI failed: ${err.error}`); return; }
      const g = await gen.json();
      const spec = g.data ?? g;
      // Assign IDs to each field (the API expects unique IDs on each field).
      const fields = (spec.fields ?? []).map((f: Record<string, unknown>) => ({ ...f, id: Math.random().toString(36).slice(2, 10) }));
      const create = await fetch("/api/forms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: spec.name, description: spec.description, fields }),
      });
      if (!create.ok) throw new Error();
      const d = await create.json();
      const f = d.data ?? d;
      toast(`Generated "${spec.name}" with ${fields.length} fields`);
      router.push(`/forms/${f.id}`);
    } catch { toast("Couldn't generate form"); }
    finally { setGenerating(false); }
  }

  const total = forms?.length ?? 0;

  return (
    <>
      <OsPageHeader
        title="Forms"
        actions={
          <HeaderAction
            icon={Sparkles}
            label={generating ? "Generating…" : "AI generate"}
            disabled={generating}
            onClick={() => { void aiGenerate(); }}
          />
        }
        primary={{ label: "New form", icon: Plus, onClick: () => { void quickAdd(); } }}
      />

      <div className="px-6 py-5">
        {loadError ? (
          <ErrorState what="forms" onRetry={() => { setLoadError(null); void load(); }} />
        ) : forms === null ? (
          <SkeletonRows />
        ) : total === 0 ? (
          <OsEmptyView context="list" title="No forms yet" />
        ) : (
          <div className="frmlist__grid">
            {forms.map((f) => (
              <Link key={f.id} href={`/forms/${f.id}`} className="frmcard">
                <header>
                  <h3>{f.name}</h3>
                  <span className={`frmcard__chip ${f.isPublic ? "is-public" : "is-private"}`}>
                    {f.isPublic ? <><Globe /> Public</> : <><Lock /> Org</>}
                  </span>
                </header>
                {f.description && <p className="frmcard__desc">{f.description.length > 80 ? f.description.slice(0, 80) + "…" : f.description}</p>}
                <footer>
                  <span className="frmcard__subs"><Inbox /> {f.submissionCount} submission{f.submissionCount === 1 ? "" : "s"}</span>
                  <span className="frmcard__open">Edit <ChevronRight /></span>
                </footer>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
