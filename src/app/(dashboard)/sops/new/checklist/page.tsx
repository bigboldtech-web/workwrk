"use client";

/* Checklist-SOP editor — uses the rich ChecklistBuilder (the SAME component
 * the SOP detail page uses): per-step content blocks (text / divider / image /
 * video), form fields (short/long text, number, checkbox, email, website,
 * date, dropdown, multichoice, file upload), and approval steps.
 *
 * Saves { type: "CHECKLIST", sections } and can be spun up as a ProcessRun
 * (shareable, runnable at /run/[token]). Old checklists ({title, notes}) are
 * normalized into the rich shape on load.
 *
 * URL: /sops/new/checklist?id=<sopId>
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Send, Save } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { OsPageHeader, HeaderAction } from "@/components/layout/os/page-header";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";

import { useOsToast } from "@/components/layout/os/toast";
import { ChecklistBuilder, normalizeChecklistSections, type ChecklistSection } from "@/components/checklist-builder";
import { SopTaxonomyPicker } from "@/components/sops/sop-taxonomy-picker";
import { SopTagInput } from "@/components/sops/sop-tag-input";

function genId(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }
function emptySections(): ChecklistSection[] {
  return [{ id: genId("sec"), title: "Steps", steps: [{ id: genId("step"), title: "", description: "", type: "task", inputs: [], contentBlocks: [] }] }];
}

export default function ChecklistSopEditor() {
  const router = useRouter();
  const search = useSearchParams();
  const id = search.get("id");
  const { toast } = useOsToast();

  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<ChecklistSection[]>(emptySections);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED" | "IN_REVIEW" | "APPROVED">("DRAFT");
  // Gate taxonomy controls until the GET hydrates: a tag added pre-load
  // would PATCH [newTag] and wipe the server's existing tags.
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const dirty = useRef(false);
  const initialLoad = useRef(true);
  const creatingRef = useRef(false);

  // Self-create: visiting /sops/new/checklist with no ?id (e.g. the sidebar
  // "New step-by-step SOP" link) mints a fresh CHECKLIST SOP and redirects to
  // it, so the editor always has a row to load/save.
  useEffect(() => {
    if (id || creatingRef.current) return;
    creatingRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/sops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Untitled checklist",
            sopType: "CHECKLIST",
            content: { type: "CHECKLIST", sections: [{ title: "Steps", steps: [{ id: "s1", title: "First step" }] }] },
          }),
        });
        if (!res.ok) throw new Error(`POST ${res.status}`);
        const data = await res.json();
        const sop = data.data ?? data;
        router.replace(`/sops/new/checklist?id=${encodeURIComponent(sop.id)}`);
      } catch { toast("Couldn't create checklist"); }
    })();
  }, [id, router, toast]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/sops/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        const sop = data.data ?? data;
        setTitle(sop.title ?? "");
        const c = sop.content as { sections?: unknown } | null;
        const normalized = normalizeChecklistSections(c?.sections);
        if (normalized.length > 0) setSections(normalized);
        setFolderId(sop.folderId ?? null);
        setTags(Array.isArray(sop.tags) ? sop.tags : []);
        setHydrated(true);
        setStatus(sop.status ?? "DRAFT");
        initialLoad.current = false;
      } catch { /* ignore */ }
    })();
  }, [id]);

  useEffect(() => { if (!initialLoad.current) dirty.current = true; }, [title, sections]);

  // Taxonomy + tags save as their OWN single-field PATCHes, never through
  // save()'s content payload — the 5s autosave in flight can then never
  // clobber a concurrent category/tag pick.
  async function patchMeta(patch: { folderId?: string | null; tags?: string[] }, label: string) {
    if (!id) return;
    try {
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      setLastSaved(new Date());
    } catch { toast(`Couldn't save ${label}`); }
  }

  async function save(opts: { publish?: boolean } = {}) {
    if (!id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Untitled checklist",
          content: { type: "CHECKLIST", sections },
          ...(opts.publish ? { status: "PUBLISHED" } : {}),
        }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      setLastSaved(new Date());
      if (opts.publish) { setStatus("PUBLISHED"); toast("Checklist published"); }
      dirty.current = false;
    } catch { toast("Couldn't save"); }
    finally { setSaving(false); }
  }
  useEffect(() => {
    const t = setInterval(() => { if (dirty.current && !saving) void save(); }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, title, sections]);

  const totalSteps = sections.reduce((acc, s) => acc + s.steps.length, 0);

  if (!id) return (<>
    <OsPageHeader title="New checklist SOP" back={{ fallbackHref: "/sops", label: "SOPs" }} />
    <div className="sop-edit__loading"><Dots variant="pending" /> Creating checklist…</div>
  </>);

  return (<>
    <OsPageHeader
      title={title || "Checklist SOP"}
      back={{ fallbackHref: "/sops", label: "SOPs" }}
      autosave={
        <AutosaveIndicator
          status={saving ? "saving" : lastSaved ? "saved" : "idle"}
          lastSavedAt={lastSaved}
          labels={{ idle: "Auto-saves every 5s" }}
        />
      }
      actions={
        <>
          <HeaderAction icon={Save} label="Save" disabled={saving} onClick={() => { void save(); }} />
          {status === "PUBLISHED" ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-success-bg px-2 text-sm font-medium text-success-text">Published</span>
          ) : null}
        </>
      }
      primary={status !== "PUBLISHED"
        ? { label: "Publish", icon: Send, disabled: saving, onClick: () => { void save({ publish: true }); } }
        : undefined}
    />

    <div className="sop-edit">

      <input type="text" className="sop-edit__title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Checklist title…" />

      <div className="mb-3 mt-1 flex flex-wrap items-center gap-1.5">
        <SopTaxonomyPicker
          disabled={!hydrated}
          folderId={folderId}
          onChange={(next) => { setFolderId(next); void patchMeta({ folderId: next }, "category"); }}
        />
        <div className="min-w-[220px] max-w-[360px] flex-1">
          <SopTagInput
            disabled={!hydrated}
            value={tags}
            onChange={(next) => { setTags(next); void patchMeta({ tags: next }, "tags"); }}
          />
        </div>
      </div>

      <ChecklistBuilder sections={sections} onChange={setSections} editing />
    </div>
  </>);
}
