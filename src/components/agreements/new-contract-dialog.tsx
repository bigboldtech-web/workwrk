"use client";

// The New contract chooser (spec-process section 2 `/agreements`), 560:
// Title (required), Folder (a Picker over settings.process.contractFolders
// with the "Manage folders…" footer), Start from: Write / Upload a PDF (PDF
// only, 25 MB) / a template picker list; one primary "Create" that lands on
// /agreements/[id]. On the Templates view the same modal makes a template
// (Write / Upload a PDF). No "Untitled" rows: the title is asked here.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LayoutTemplate, PenLine, Plus, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Picker, PickerFooterRow } from "@/components/ui/picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Dots } from "@/components/ui/dots";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

const FIELD = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand";
const LABEL = "text-sm font-medium text-ink-2";
type Source = "write" | "pdf" | "template";
type TemplateRow = { id: string; title: string; category: string | null };

export function NewContractDialog({ open, onClose, folders, isTemplate, initialSource = "write", onCreated }: {
  open: boolean;
  onClose: () => void;
  folders: string[];
  /** On the Templates view the dialog makes a template. */
  isTemplate: boolean;
  initialSource?: Source;
  onCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [source, setSource] = useState<Source>(initialSource);
  const [file, setFile] = useState<File | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) { setSeenOpen(open); if (open) { setTitle(""); setFolder(null); setSource(initialSource); setFile(null); setTemplateId(null); } }
  useEffect(() => {
    if (!open || source !== "template" || templates !== null) return;
    void apiFetch<{ data?: TemplateRow[] }>("/api/agreements?view=templates&pageSize=100", { cache: "no-store" }).then((r) => setTemplates(r.ok ? r.data.data ?? [] : []));
  }, [open, source, templates]);

  const options: Array<{ value: Source; label: string }> = isTemplate
    ? [{ value: "write", label: "Write" }, { value: "pdf", label: "Upload a PDF" }]
    : [{ value: "write", label: "Write" }, { value: "pdf", label: "Upload a PDF" }, { value: "template", label: "From template" }];
  const canCreate = title.trim().length > 0 && (source === "write" || (source === "pdf" && !!file) || (source === "template" && !!templateId)) && !busy;

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    try {
      let pdfUrl: string | null = null;
      if (source === "pdf" && file) {
        const fd = new FormData(); fd.append("file", file);
        const up = await fetch("/api/upload", { method: "POST", body: fd });
        if (!up.ok) { const j = await up.json().catch(() => ({})); toast((j as { error?: string }).error || "Upload failed", { tone: "danger" }); return; }
        const uj = await up.json();
        pdfUrl = uj.url ?? uj.data?.url ?? null;
        if (!pdfUrl) { toast("Upload failed", { tone: "danger" }); return; }
      }
      const body: Record<string, unknown> = { title: title.trim(), category: folder, isTemplate };
      if (source === "template") body.fromTemplateId = templateId;
      else { body.sourceType = source === "pdf" ? "pdf" : "blocknote"; if (pdfUrl) body.pdfUrl = pdfUrl; }
      const r = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/agreements", { method: "POST", json: body });
      if (!r.ok) { toast(r.error || "Couldn't create", { tone: "danger" }); return; }
      const id = r.data?.id ?? r.data?.data?.id;
      if (!id) { toast("Couldn't create", { tone: "danger" }); return; }
      onCreated?.(id);
      onClose();
      router.push(`/agreements/${id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>{isTemplate ? "New template" : "New contract"}</DialogTitle>
        <DialogDescription>{isTemplate ? "A template is what new contracts start from. Give it a name and a folder." : "Give it a name and a folder, then choose how to start."}</DialogDescription>
        <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Title <span className="font-normal text-ink-3">(required)</span></span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isTemplate ? "Mutual NDA" : "Vendor agreement with Acme"} className={FIELD} />
          </label>
          <div className="flex flex-col gap-1">
            <span className={LABEL}>Folder</span>
            <span className="relative block">
              <button type="button" onClick={() => setFolderOpen((o) => !o)} className={`${FIELD} flex items-center gap-2 text-start`}>
                <span className={`min-w-0 flex-1 truncate ${folder ? "" : "text-ink-3"}`}>{folder ?? "Unfiled"}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
              </button>
              <Picker open={folderOpen} onClose={() => setFolderOpen(false)} ariaLabel="Folder" selected={folder} onSelect={(v) => { setFolder(v === "__none__" ? null : v); setFolderOpen(false); }}
                sections={[{ options: [{ value: "__none__", label: "Unfiled" }, ...folders.map((f) => ({ value: f, label: f }))] }]}
                footer={<PickerFooterRow onClick={() => router.push("/sops/manage?tab=contract-folders")}>Manage folders…</PickerFooterRow>} />
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <span className={LABEL}>Start from</span>
            <SegmentedControl<Source> label="Start from" value={source} onChange={setSource} options={options} />
            {source === "write" ? <p className="inline-flex items-center gap-2 text-sm text-ink-2"><PenLine className="h-4 w-4" strokeWidth={1.5} aria-hidden /> A blank document in the editor.</p> : null}
            {source === "pdf" ? (
              <div className="flex flex-col gap-1">
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; if (f && f.size > MAX_UPLOAD_BYTES) { toast(`That file is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`, { tone: "danger" }); return; } setFile(f); }} />
                <button type="button" onClick={() => fileRef.current?.click()} className={cn("inline-flex h-9 items-center gap-2 rounded-md border border-dashed border-line-strong px-3 text-base text-ink hover:bg-hover", file ? "border-solid" : "")}>
                  <Upload className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden /> {file ? file.name : "Choose a PDF"}
                </button>
                <span className="text-xs text-ink-3">PDF only, up to {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.</span>
              </div>
            ) : null}
            {source === "template" ? (
              templates === null ? <div className="rounded-md border border-line p-2"><SkeletonRows rows={3} rowHeight="36px" /></div>
              : templates.length === 0 ? <p className="text-sm text-ink-2">No templates yet. Save any contract as a template from its page.</p>
              : (
                <ul className="max-h-56 overflow-y-auto rounded-md border border-line">
                  {templates.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => setTemplateId(t.id)} aria-pressed={templateId === t.id} className={cn("flex h-9 w-full items-center gap-2 px-3 text-start text-base text-ink hover:bg-hover", templateId === t.id ? "bg-selected" : "")}>
                        <LayoutTemplate className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.category ? <span className="shrink-0 text-xs text-ink-2">{t.category}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
            <button type="submit" disabled={!canCreate} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
              {busy ? <Dots variant="pending" /> : <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Create
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
