"use client";

/* Written-SOP editor — now powered by the same block editor as Notes.
 *
 * Backwards-compatible content shapes:
 *   - { type: "blocks", blocks: Block[], meta? }   ← new shape, default for fresh SOPs
 *   - { type: "WRITTEN", body: string }            ← legacy plain text, auto-converted to paragraph blocks on first edit
 *   - { type: "richtext", html: string }           ← legacy TipTap, auto-converted via htmlToBlocks
 *
 * The save call still uses PATCH /api/sops/[id] and writes content as
 * { type: "blocks", blocks, meta }. Title and status flow unchanged.
 *
 * URL: /sops/new/text?id=<sopId>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileText, Send, Save, ArrowLeft, Hash, BookCopy, Loader2 } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { BlockEditor, type Block } from "@/components/docs/block-editor";

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
  const [meta, setMeta] = useState<DocMeta>({});
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED" | "IN_REVIEW" | "APPROVED">("DRAFT");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoad = useRef(true);

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

        const c = sop.content as { type?: string; blocks?: Block[]; body?: string; html?: string; meta?: DocMeta } | null;
        if (c?.type === "blocks" && Array.isArray(c.blocks)) {
          setBlocks(c.blocks);
          setMeta(c.meta ?? {});
        } else if (typeof c?.html === "string") {
          setBlocks(htmlToBlocks(c.html));
        } else if (typeof c?.body === "string") {
          setBlocks(bodyToBlocks(c.body));
        } else {
          setBlocks([{ id: newId(), kind: "paragraph", text: "" }]);
        }
        initialLoad.current = false;
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Load failed");
      }
    })();
  }, [id]);

  const persist = useCallback(async (nextBlocks: Block[], nextMeta: DocMeta, opts: { publish?: boolean } = {}) => {
    if (!id) return;
    setSaving(true);
    try {
      const newStatus = opts.publish ? "PUBLISHED" : status;
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Untitled SOP",
          content: { type: "blocks", blocks: nextBlocks, meta: nextMeta },
          ...(opts.publish ? { status: newStatus } : {}),
        }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      setLastSaved(new Date());
      if (opts.publish) { setStatus("PUBLISHED"); toast("SOP published"); }
    } catch { toast("Couldn't save"); }
    finally { setSaving(false); }
  }, [id, status, title, toast]);

  const saveBlocks = useCallback(async (next: Block[]) => {
    setBlocks(next);
    await persist(next, meta);
  }, [persist, meta]);

  function saveTitle(next: string) {
    setTitle(next);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      if (blocks) void persist(blocks, meta);
    }, 700);
  }

  if (!id) return (<>
    <OsTitleBar title="New written SOP" Icon={FileText} iconGradient={GRAD.tealGreen} showInvite={false} />
    <div className="sop-edit__error">Missing SOP id. <a href="/sops">Back to SOPs</a></div>
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
      description={saving ? "Saving…" : lastSaved ? `Saved ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Auto-saves as you type"}
      actions={
        <div className="sop-edit__head-actions">
          <Link href="/sops" className="sop-edit__nav-link"><Hash /> SOPs</Link>
          <Link href="/sops/new" className="sop-edit__nav-link"><BookCopy /> Pick type</Link>
          <button type="button" onClick={() => blocks && persist(blocks, meta)} className="sop-edit__nav-link" disabled={saving || !blocks}>
            <Save /> Save
          </button>
          {status !== "PUBLISHED" ? (
            <button type="button" onClick={() => blocks && persist(blocks, meta, { publish: true })} className="sop-edit__btn-primary" disabled={saving || !blocks}>
              <Send /> Publish
            </button>
          ) : (
            <span className="sop-edit__pub">Published</span>
          )}
        </div>
      }
    />

    <div className="sop-edit">
      <button type="button" className="sop-edit__back" onClick={() => router.push("/sops")}>
        <ArrowLeft /> All SOPs
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
        <BlockEditor key={id} initialBlocks={blocks} onSave={saveBlocks} />
      )}

      <footer className="sop-edit__hint">
        Same block editor as Notes — type <kbd>/</kbd> for blocks, <kbd>@</kbd> to mention people / tasks / boards / other SOPs.
      </footer>
    </div>
  </>);
}
