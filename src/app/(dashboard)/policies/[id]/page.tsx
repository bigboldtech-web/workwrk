"use client";

/* Policy detail — view a policy (rich HTML content), acknowledge it, see org
 * ack progress, and (managers) edit title/content/status with the same rich
 * editor used elsewhere. Fixes: 404 on card click, raw-HTML rendering, and the
 * inability to actually write policy content.
 *
 *   GET   /api/policies/[id]              policy + acknowledged/ack stats + canEdit
 *   PATCH /api/policies/[id]              { title, content, status }  (manager)
 *   POST  /api/policies/[id]/acknowledge  idempotent ack
 */

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, ArrowLeft, CheckCircle2, Loader2, Users, Pencil, Save, X } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { RichEditor } from "@/components/ui/rich-editor";

type PolStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type Policy = {
  id: string;
  title: string;
  content: string;
  category?: string | null;
  version: number;
  status: PolStatus;
  requiresAck: boolean;
  effectiveDate?: string | null;
  updatedAt: string;
  acknowledged?: boolean;
  totalAcks?: number;
  totalUsers?: number;
  canEdit?: boolean;
};

// Strip dangerous tags/attrs before rendering policy HTML.
function safeHtml(html: string): string {
  return (html || "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1="#"');
}

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const search = useSearchParams();
  const { toast } = useOsToast();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [acking, setAcking] = useState(false);

  // Edit state (managers).
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editStatus, setEditStatus] = useState<PolStatus>("DRAFT");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/policies/${id}`);
        if (!res.ok) { setLoadErr(true); return; }
        const data = await res.json();
        const p = (data.data ?? data) as Policy;
        setPolicy(p);
        // Auto-open the editor when arriving from "New policy" (?edit=1).
        if (search?.get("edit") === "1" && p.canEdit) {
          setEditTitle(p.title);
          setEditContent(p.content || "");
          setEditStatus(p.status);
          setEditing(true);
        }
      } catch { setLoadErr(true); }
    })();
  }, [id, search]);

  function startEdit() {
    if (!policy) return;
    setEditTitle(policy.title);
    setEditContent(policy.content || "");
    setEditStatus(policy.status);
    setEditing(true);
  }

  async function save() {
    if (!id || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/policies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim() || "Untitled policy", content: editContent, status: editStatus }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't save"); return; }
      setPolicy((p) => (p ? { ...p, title: editTitle.trim() || "Untitled policy", content: editContent, status: editStatus } : p));
      setEditing(false);
      toast("Policy saved");
    } catch { toast("Couldn't save"); }
    finally { setSaving(false); }
  }

  async function acknowledge() {
    if (!id || acking || policy?.acknowledged) return;
    setAcking(true);
    try {
      const res = await fetch(`/api/policies/${id}/acknowledge`, { method: "POST" });
      if (!res.ok) throw new Error();
      setPolicy((p) => (p ? { ...p, acknowledged: true, totalAcks: (p.totalAcks ?? 0) + 1 } : p));
      toast("Policy acknowledged");
    } catch { toast("Couldn't acknowledge"); }
    finally { setAcking(false); }
  }

  const ackRate = policy && policy.totalUsers ? Math.round(((policy.totalAcks ?? 0) / policy.totalUsers) * 100) : 0;

  return (
    <>
      <OsTitleBar
        title="Policy"
        Icon={ShieldCheck}
        iconGradient={GRAD.indigoBlue}
        showStandardActions={false}
        actions={
          <div className="flex items-center gap-2">
            {policy?.canEdit && !editing ? (
              <button type="button" onClick={startEdit} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            ) : null}
            <Link href="/policies" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              <ArrowLeft className="h-3.5 w-3.5" /> All policies
            </Link>
            <Link href="/policies/compliance" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              Compliance
            </Link>
          </div>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-8">
        {loadErr ? (
          <div className="text-sm text-zinc-500">
            Couldn&apos;t load this policy. <Link href="/policies" className="text-violet-600 underline">Back to Policies</Link>
          </div>
        ) : !policy ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : editing ? (
          /* ── Edit mode (manager) ── */
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as PolStatus)}
                className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-[13px] text-zinc-700"
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <div className="flex-1" />
              <button type="button" onClick={() => setEditing(false)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button type="button" onClick={save} disabled={saving} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
              </button>
            </div>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Policy title…"
              className="w-full border-0 border-b border-zinc-200 px-0 py-1 text-2xl font-semibold tracking-[-0.01em] text-zinc-900 outline-none focus:border-zinc-300"
            />
            <RichEditor content={editContent} onChange={setEditContent} editable placeholder="Write the policy here. Press / for headings, lists, tables…" minHeight="400px" />
          </div>
        ) : (
          /* ── View mode ── */
          <>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              {policy.category ? <span className="font-medium text-zinc-500">{policy.category}</span> : null}
              <span>v{policy.version}</span>
              {policy.effectiveDate ? <span>· Effective {new Date(policy.effectiveDate).toLocaleDateString()}</span> : null}
              {policy.status !== "PUBLISHED" ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">{policy.status}</span> : null}
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.01em] text-zinc-900">{policy.title}</h1>

            {policy.requiresAck ? (
              <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4">
                <div className="min-w-[200px] flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-700">
                    <Users className="h-4 w-4 text-zinc-400" /> {policy.totalAcks ?? 0} of {policy.totalUsers ?? 0} acknowledged
                    <span className="text-zinc-400">· {ackRate}%</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${ackRate}%` }} />
                  </div>
                </div>
                {policy.acknowledged ? (
                  <span className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-50 px-3 text-[13px] font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> You&apos;ve acknowledged
                  </span>
                ) : (
                  <button type="button" onClick={acknowledge} disabled={acking} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
                    {acking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Acknowledge
                  </button>
                )}
              </div>
            ) : null}

            {policy.content ? (
              <article
                className="prose prose-zinc mt-6 max-w-none prose-headings:font-semibold prose-h1:text-[22px] prose-h2:text-[18px] prose-h3:text-[15px] prose-p:text-[15px] prose-p:leading-relaxed prose-li:text-[15px]"
                dangerouslySetInnerHTML={{ __html: safeHtml(policy.content) }}
              />
            ) : (
              <p className="mt-6 text-sm text-zinc-400">No content yet.{policy.canEdit ? " Click Edit to write the policy." : ""}</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
