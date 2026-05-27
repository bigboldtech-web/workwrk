"use client";

/* BlockDocEditor — chrome around the BlockEditor for a /docs/[id] page.
 *
 * Handles: load + title + auto-save + the back/close button. Detects
 * legacy `{ html }` docs and offers a one-click "Convert to blocks"
 * (parses the HTML into one paragraph block — lossless preservation
 * of plain text + structure inference). New docs are blocks-first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Link as LinkIcon, Sparkles, Loader2 } from "lucide-react";
import { BlockEditor, type Block } from "./block-editor";
import { useOsToast } from "@/components/layout/os/toast";

type DocPayload = {
  id: string;
  title: string;
  content: { blocks?: Block[]; html?: string } | null;
  updatedAt: string;
  createdAt: string;
};

function newId() { return Math.random().toString(36).slice(2, 10); }

// Convert legacy HTML into a one-shot paragraph-per-line block array.
function htmlToBlocks(html: string): Block[] {
  // Split on block-level tags. Crude but lossless: keeps all text.
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [{ id: newId(), kind: "paragraph", text: "" }];
  return lines.map((t) => ({ id: newId(), kind: "paragraph" as const, text: t }));
}

interface Props { docId: string }

export function BlockDocEditor({ docId }: Props) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [doc, setDoc] = useState<DocPayload | null>(null);
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [legacy, setLegacy] = useState<string | null>(null); // legacy html
  const [loadError, setLoadError] = useState<string | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/docs/${docId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const d: DocPayload = data.doc ?? data;
        setDoc(d);
        setTitle(d.title ?? "");
        const c = d.content;
        if (c && Array.isArray((c as { blocks?: Block[] }).blocks)) {
          setBlocks((c as { blocks: Block[] }).blocks);
          setLegacy(null);
        } else if (c && typeof (c as { html?: string }).html === "string") {
          setLegacy((c as { html: string }).html);
          setBlocks(null);
        } else {
          setBlocks([]);
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "load failed");
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  const saveBlocks = useCallback(async (next: Block[]) => {
    setBlocks(next);
    try {
      // Excerpt = first 200 chars across text-bearing blocks.
      const text = next
        .map((b) => "text" in b ? (b as { text: string }).text : "")
        .filter(Boolean)
        .join(" ")
        .slice(0, 400);
      const res = await fetch(`/api/docs/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Untitled doc",
          content: { blocks: next },
          excerpt: text || null,
        }),
      });
      if (!res.ok) throw new Error();
    } catch { toast("Couldn't save"); }
  }, [docId, title, toast]);

  function saveTitle(next: string) {
    setTitle(next);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      try {
        await fetch(`/api/docs/${docId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: next.trim() || "Untitled doc" }),
        });
      } catch { /* ignore */ }
    }, 700);
  }

  function convertLegacy() {
    if (!legacy) return;
    const converted = htmlToBlocks(legacy);
    setBlocks(converted);
    setLegacy(null);
    void saveBlocks(converted);
    toast("Converted to blocks — old content preserved as paragraphs");
  }

  function copyLink() {
    const url = `${window.location.origin}/docs/${docId}`;
    navigator.clipboard.writeText(url).then(() => toast("Link copied"));
  }

  if (loadError) {
    return (
      <div className="bdoc__error">
        <p>Couldn&apos;t load doc: {loadError}</p>
        <button type="button" onClick={() => router.back()}>Back</button>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="bdoc__loading">
        <Loader2 className="bdoc__spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="bdoc">
      <header className="bdoc__head">
        <button type="button" className="bdoc__back" onClick={() => router.back()} aria-label="Back">
          <ArrowLeft />
        </button>
        <button type="button" className="bdoc__copy" onClick={copyLink}>
          <LinkIcon /> Copy link
        </button>
      </header>

      <div className="bdoc__page">
        <input
          type="text"
          className="bdoc__title"
          value={title}
          onChange={(e) => saveTitle(e.target.value)}
          placeholder="Untitled doc"
        />

        {legacy !== null ? (
          <div className="bdoc__legacy">
            <div className="bdoc__legacy-banner">
              <Sparkles />
              <span>This doc is in the old rich-text format.</span>
              <button type="button" onClick={convertLegacy}>Convert to blocks</button>
            </div>
            <div className="bdoc__legacy-body" dangerouslySetInnerHTML={{ __html: legacy }} />
          </div>
        ) : (
          <BlockEditor initialBlocks={blocks} onSave={saveBlocks} />
        )}
      </div>
    </div>
  );
}
