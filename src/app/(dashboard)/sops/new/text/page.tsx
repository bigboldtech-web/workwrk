"use client";

/* Written-SOP editor.
 *
 * Plain textarea with lightweight markdown preview (H1/H2/H3/list/blank).
 * Auto-saves to /api/sops/[id] on blur + every 5s while idle. Title is
 * a separate input. Publish toggles status DRAFT -> PUBLISHED.
 *
 * URL: /sops/new/text?id=<sopId>
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, Eye, EyeOff, Send, Save, ArrowLeft } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

export default function WrittenSopEditor() {
  const router = useRouter();
  const search = useSearchParams();
  const id = search.get("id");
  const { toast } = useOsToast();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED" | "IN_REVIEW" | "APPROVED">("DRAFT");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const dirty = useRef(false);
  const initialLoad = useRef(true);

  // Load
  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/sops/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        const sop = data.data ?? data;
        setTitle(sop.title ?? "");
        const c = sop.content as { body?: string } | null;
        setBody(c?.body ?? "");
        setStatus(sop.status ?? "DRAFT");
        initialLoad.current = false;
      } catch { /* ignore */ }
    })();
  }, [id]);

  // Mark dirty after the initial load
  useEffect(() => { if (!initialLoad.current) dirty.current = true; }, [title, body]);

  async function save(opts: { publish?: boolean } = {}) {
    if (!id) return;
    setSaving(true);
    try {
      const newStatus = opts.publish ? "PUBLISHED" : status;
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Untitled SOP",
          content: { type: "WRITTEN", body },
          ...(opts.publish ? { status: newStatus } : {}),
        }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      setLastSaved(new Date());
      if (opts.publish) {
        setStatus("PUBLISHED");
        toast("SOP published");
      }
      dirty.current = false;
    } catch { toast("Couldn't save"); }
    finally { setSaving(false); }
  }

  // Idle auto-save every 5s
  useEffect(() => {
    const t = setInterval(() => { if (dirty.current && !saving) void save(); }, 5000);
    return () => clearInterval(t);
  }, [saving, title, body]);

  function renderMarkdown(src: string) {
    return src.split("\n").map((line, i) => {
      if (line.startsWith("# "))    return <h1 key={i}>{line.slice(2)}</h1>;
      if (line.startsWith("## "))   return <h2 key={i}>{line.slice(3)}</h2>;
      if (line.startsWith("### "))  return <h3 key={i}>{line.slice(4)}</h3>;
      if (line.startsWith("- "))    return <li key={i}>{line.slice(2)}</li>;
      if (line.startsWith("1. "))   return <li key={i}>{line.slice(3)}</li>;
      if (line.trim() === "")       return <br key={i} />;
      return <p key={i}>{line}</p>;
    });
  }

  if (!id) return <div className="sop-edit__error">Missing SOP id. <a href="/sops">Back to SOPs</a></div>;

  return (
    <div className="sop-edit">
      <header className="sop-edit__head">
        <div className="sop-edit__head-l">
          <button type="button" className="sop-edit__back" onClick={() => router.push("/sops")} aria-label="Back">
            <ArrowLeft />
          </button>
          <div className="sop-edit__type"><FileText /> Written SOP</div>
          <div className="sop-edit__save-state">
            {saving ? "Saving…" : lastSaved ? `Saved ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}
          </div>
        </div>
        <div className="sop-edit__actions">
          <button type="button" onClick={() => setPreview((p) => !p)} className="sop-edit__btn">
            {preview ? <EyeOff /> : <Eye />} {preview ? "Edit" : "Preview"}
          </button>
          <button type="button" onClick={() => save()} className="sop-edit__btn" disabled={saving}>
            <Save /> Save
          </button>
          {status !== "PUBLISHED" && (
            <button type="button" onClick={() => save({ publish: true })} className="sop-edit__btn sop-edit__btn--primary" disabled={saving}>
              <Send /> Publish
            </button>
          )}
          {status === "PUBLISHED" && <span className="sop-edit__pub">Published</span>}
        </div>
      </header>

      <input
        type="text"
        className="sop-edit__title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="SOP title…"
      />

      {preview ? (
        <div className="sop-edit__preview">{renderMarkdown(body)}</div>
      ) : (
        <textarea
          className="sop-edit__textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write the procedure. Markdown supported: # H1, ## H2, ### H3, - bullet, 1. numbered."
          spellCheck
        />
      )}

      <footer className="sop-edit__hint">
        Auto-saves while you type. Switch to <strong>Preview</strong> to see formatting.
      </footer>
    </div>
  );
}
