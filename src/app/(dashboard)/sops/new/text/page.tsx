"use client";

/* Written-SOP editor — powered by the SAME BlockNote editor as Notes.
 *
 * Content shapes (backwards-compatible, no data loss):
 *   - { type: "blocks", bnDoc?: PartialBlock[], blocks: Block[], meta? }
 *       new shape. `bnDoc` is BlockNote's source of truth; `blocks` is the
 *       legacy mirror kept so EntityLink sync / versioning / empty-checks
 *       keep working. Old SOPs (no bnDoc) load by converting `blocks` → BN.
 *   - { type: "WRITTEN", body } / { type: "richtext", html }  ← legacy,
 *       converted to blocks then to BN on load.
 *
 * Save uses PATCH /api/sops/[id]; title + status flow unchanged.
 * URL: /sops/new/text?id=<sopId>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileText, Send, Save, ArrowLeft, Loader2 } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { type Block } from "@/components/docs/block-editor";
import { BlockNoteCanvas, type BnDocJSON } from "@/components/docs/blocknote-canvas";
import { collectLegacyCustomEmbeds, rehydrateMirrorWithLegacyEmbeds } from "@/components/docs/legacy-embed-preserve";

function newId() { return Math.random().toString(36).slice(2, 10); }

// Convert legacy SOP body (plain text with light markdown) into blocks.
function bodyToBlocks(body: string): Block[] {
  const lines = (body ?? "").split("\n");
  const out: Block[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push({ id: newId(), kind: "paragraph", text: "" }); continue; }
    if (line.startsWith("# "))   { out.push({ id: newId(), kind: "h1", text: line.slice(2) }); continue; }
    if (line.startsWith("## "))  { out.push({ id: newId(), kind: "h2", text: line.slice(3) }); continue; }
    if (line.startsWith("### ")) { out.push({ id: newId(), kind: "h3", text: line.slice(4) }); continue; }
    if (line.startsWith("- "))   { out.push({ id: newId(), kind: "bullet", text: line.slice(2) }); continue; }
    if (/^\d+\. /.test(line))    { out.push({ id: newId(), kind: "numbered", text: line.replace(/^\d+\. /, "") }); continue; }
    out.push({ id: newId(), kind: "paragraph", text: line });
  }
  if (out.length === 0) out.push({ id: newId(), kind: "paragraph", text: "" });
  return out;
}

// Convert legacy TipTap HTML into a lossless flat blocks array.
function htmlToBlocks(html: string): Block[] {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  return bodyToBlocks(text);
}

type DocMeta = { icon?: string; coverGradient?: string; coverUrl?: string };

export default function WrittenSopEditor() {
  const router = useRouter();
  const search = useSearchParams();
  const id = search.get("id");
  const { toast } = useOsToast();

  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [bnDoc, setBnDoc] = useState<BnDocJSON | null>(null);
  // Frozen custom-embed originals (sop_card/task_card/…) so they survive the
  // blocks→BlockNote→blocks round-trip instead of decaying to paragraphs.
  const preservedLegacyRef = useRef<Map<string, Block>>(new Map());
  const [meta, setMeta] = useState<DocMeta>({});
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED" | "IN_REVIEW" | "APPROVED">("DRAFT");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoad = useRef(true);
  const creatingRef = useRef(false);

  // Self-create: visiting /sops/new/text with no ?id mints a fresh WRITTEN SOP
  // and redirects to it, so the editor always has a row to load/save.
  useEffect(() => {
    if (id || creatingRef.current) return;
    creatingRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/sops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Untitled written SOP",
            sopType: "WRITTEN",
            content: { type: "WRITTEN", body: "" },
          }),
        });
        if (!res.ok) throw new Error(`POST ${res.status}`);
        const data = await res.json();
        const sop = data.data ?? data;
        router.replace(`/sops/new/text?id=${encodeURIComponent(sop.id)}`);
      } catch { toast("Couldn't create SOP"); }
    })();
  }, [id, router, toast]);

  // Load
  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/sops/${id}`);
        if (!res.ok) { setLoadError(`HTTP ${res.status}`); return; }
        const data = await res.json();
        const sop = data.data ?? data;
        setTitle(sop.title ?? "");
        setStatus(sop.status ?? "DRAFT");

        const c = sop.content as { type?: string; bnDoc?: BnDocJSON; blocks?: Block[]; body?: string; html?: string; meta?: DocMeta } | null;
        if (c?.type === "blocks" && Array.isArray(c.blocks)) {
          setBnDoc(Array.isArray(c.bnDoc) ? c.bnDoc : null);
          setBlocks(c.blocks);
          setMeta(c.meta ?? {});
          preservedLegacyRef.current = collectLegacyCustomEmbeds(c.blocks);
        } else if (typeof c?.html === "string") {
          setBnDoc(null);
          setBlocks(htmlToBlocks(c.html));
        } else if (typeof c?.body === "string") {
          setBnDoc(null);
          setBlocks(bodyToBlocks(c.body));
        } else {
          setBnDoc(null);
          setBlocks([{ id: newId(), kind: "paragraph", text: "" }]);
        }
        initialLoad.current = false;
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Load failed");
      }
    })();
  }, [id]);

  const persist = useCallback(async (nextBnDoc: BnDocJSON | null, nextBlocks: Block[], nextMeta: DocMeta, opts: { publish?: boolean } = {}) => {
    if (!id) return;
    setSaving(true);
    try {
      const newStatus = opts.publish ? "PUBLISHED" : status;
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Untitled SOP",
          // Keep type:"blocks" + the `blocks` mirror so EntityLink sync,
          // versioning and empty-checks keep working; bnDoc is BN's truth.
          content: { type: "blocks", ...(nextBnDoc ? { bnDoc: nextBnDoc } : {}), blocks: nextBlocks, meta: nextMeta },
          ...(opts.publish ? { status: newStatus } : {}),
        }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      setLastSaved(new Date());
      if (opts.publish) { setStatus("PUBLISHED"); toast("SOP published"); }
    } catch { toast("Couldn't save"); }
    finally { setSaving(false); }
  }, [id, status, title, toast]);

  const handleEditorChange = useCallback((nextBnDoc: BnDocJSON, mirror: Block[]) => {
    const enriched = rehydrateMirrorWithLegacyEmbeds(mirror, preservedLegacyRef.current);
    setBnDoc(nextBnDoc);
    setBlocks(enriched);
    void persist(nextBnDoc, enriched, meta);
  }, [persist, meta]);

  function saveTitle(next: string) {
    setTitle(next);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      if (blocks) void persist(bnDoc, blocks, meta);
    }, 700);
  }

  if (!id) return (<>
    <OsTitleBar title="New written SOP" Icon={FileText} iconGradient={GRAD.tealGreen} showStandardActions={false} />
    <div className="sop-edit__loading"><Loader2 className="bedit__spin" /> Creating SOP…</div>
  </>);

  if (loadError) {
    return (<>
      <OsTitleBar title="Written SOP" Icon={FileText} iconGradient={GRAD.tealGreen} showInvite={false} />
      <div className="sop-edit__error">Couldn&apos;t load this SOP: {loadError}. <Link href="/sops">Back to SOPs</Link></div>
    </>);
  }

  return (<>
    <OsTitleBar
      title="Written SOP"
      Icon={FileText}
      iconGradient={GRAD.tealGreen}
      showStandardActions={false}
      description={saving ? "Saving…" : lastSaved ? `Saved ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Auto-saves as you type"}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => blocks && persist(bnDoc, blocks, meta)}
            disabled={saving || !blocks}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>
          {status !== "PUBLISHED" ? (
            <button
              type="button"
              onClick={() => blocks && persist(bnDoc, blocks, meta, { publish: true })}
              disabled={saving || !blocks}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[13px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> Publish
            </button>
          ) : (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 text-[13px] font-medium text-emerald-700">Published</span>
          )}
        </div>
      }
    />

    <div className="sop-edit">
      <button
        type="button"
        onClick={() => router.push("/sops")}
        className="inline-flex h-7 w-fit items-center gap-1.5 rounded-md px-2 text-[13px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
      >
        <ArrowLeft className="h-4 w-4" /> All SOPs
      </button>

      <input
        type="text"
        className="sop-edit__title"
        value={title}
        onChange={(e) => saveTitle(e.target.value)}
        placeholder="SOP title…"
      />

      {blocks === null ? (
        <div className="sop-edit__loading"><Loader2 className="bedit__spin" /> Loading…</div>
      ) : (
        <BlockNoteCanvas
          key={id}
          initialBnDoc={bnDoc}
          legacyBlocks={blocks}
          readonly={false}
          onChange={handleEditorChange}
          entity={{ type: "sop", id }}
        />
      )}

      <footer className="sop-edit__hint">
        Same block editor as Notes — type <kbd>/</kbd> for blocks, <kbd>@</kbd> to mention people / tasks / boards / other SOPs.
      </footer>
    </div>
  </>);
}
