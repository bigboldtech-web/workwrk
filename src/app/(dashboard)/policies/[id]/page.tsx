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
import { ShieldCheck, ArrowLeft, CheckCircle2, Loader2, Users, Pencil, Save, X, History, UserPlus, RotateCcw, CalendarDays, AlertTriangle } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { BlockNoteCanvas } from "@/components/docs/blocknote-canvas";

type PolStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type VersionRow = { id: string; version: number; title: string; createdAt: string; publishedBy: string | null };
type AssigneeRow = { id: string; userId: string; status: string; name: string; email: string | null; completedAt: string | null };
type OrgUser = { id: string; firstName: string; lastName: string; email: string };
type Policy = {
  id: string;
  title: string;
  content: string;
  category?: string | null;
  version: number;
  status: PolStatus;
  requiresAck: boolean;
  effectiveDate?: string | null;
  ackVersion?: number;
  ackStatement?: string | null;
  updatedAt: string;
  acknowledged?: boolean;
  needsReack?: boolean;
  totalAcks?: number;
  totalUsers?: number;
  canEdit?: boolean;
};

const DEFAULT_ATTESTATION = "I have read, understood, and agree to comply with this policy.";

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
  const [attested, setAttested] = useState(false); // attestation checkbox

  // Edit state (managers).
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editStatus, setEditStatus] = useState<PolStatus>("DRAFT");
  const [editEffectiveDate, setEditEffectiveDate] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editRequireReack, setEditRequireReack] = useState(false); // force re-ack on this publish
  const [saving, setSaving] = useState(false);

  // Version history + assignees + assign-dialog state.
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<AssigneeRow[] | null>(null);
  const [showAssignees, setShowAssignees] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [orgUsers, setOrgUsers] = useState<OrgUser[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignAll, setAssignAll] = useState(false);
  const [assignDueDate, setAssignDueDate] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [userQuery, setUserQuery] = useState("");

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
          setEditEffectiveDate(p.effectiveDate ? p.effectiveDate.slice(0, 10) : "");
          setEditCategory(p.category ?? "");
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
    setEditEffectiveDate(policy.effectiveDate ? policy.effectiveDate.slice(0, 10) : "");
    setEditCategory(policy.category ?? "");
    setEditing(true);
  }

  // ── Version history ──
  async function openHistory() {
    setShowHistory((v) => !v);
    setShowAssignees(false);
    if (versions === null && id) {
      try {
        const res = await fetch(`/api/policies/${id}/versions`);
        if (res.ok) { const j = await res.json(); setVersions((j.data ?? j).versions ?? []); }
      } catch { /* ignore */ }
    }
  }
  async function restore(versionId: string) {
    if (!id || restoring) return;
    setRestoring(versionId);
    try {
      const res = await fetch(`/api/policies/${id}/versions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      if (!res.ok) { toast("Couldn't restore"); return; }
      toast("Version restored");
      const pr = await fetch(`/api/policies/${id}`); if (pr.ok) { const d = await pr.json(); setPolicy(d.data ?? d); }
      const vr = await fetch(`/api/policies/${id}/versions`); if (vr.ok) { const j = await vr.json(); setVersions((j.data ?? j).versions ?? []); }
    } catch { toast("Couldn't restore"); } finally { setRestoring(null); }
  }

  // ── Assignees ──
  async function openAssignees() {
    setShowAssignees((v) => !v);
    setShowHistory(false);
    if (assignees === null && id) {
      try {
        const res = await fetch(`/api/policies/${id}/assignments`);
        if (res.ok) { const j = await res.json(); setAssignees((j.data ?? j).assignments ?? []); }
      } catch { /* ignore */ }
    }
  }

  // ── Assign dialog ──
  async function openAssign() {
    setShowAssign(true);
    if (orgUsers === null) {
      try {
        const res = await fetch(`/api/users?limit=500`);
        if (res.ok) {
          const j = await res.json();
          // /api/users is paginated → data.data; be defensive about shape.
          const arr = j.data?.data ?? j.data ?? j.users ?? [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setOrgUsers(arr.map((u: any) => ({ id: u.id, firstName: u.firstName ?? "", lastName: u.lastName ?? "", email: u.email ?? "" })));
        }
      } catch { /* ignore */ }
    }
  }
  async function doAssign() {
    if (!id || assignBusy) return;
    if (!assignAll && selectedIds.size === 0) { toast("Pick at least one person"); return; }
    setAssignBusy(true);
    try {
      const res = await fetch(`/api/policies/${id}/assignments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(assignAll ? { all: true } : { userIds: [...selectedIds] }),
          ...(assignDueDate ? { dueDate: assignDueDate } : {}),
        }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't assign"); return; }
      const j = await res.json();
      const count = (j.data ?? j).count ?? 0;
      toast(`Assigned to ${count} ${count === 1 ? "person" : "people"}`);
      setShowAssign(false); setSelectedIds(new Set()); setAssignAll(false); setAssignDueDate("");
      setAssignees(null); // reload on next open
    } catch { toast("Couldn't assign"); } finally { setAssignBusy(false); }
  }

  async function save() {
    if (!id || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/policies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim() || "Untitled policy", content: editContent, status: editStatus, effectiveDate: editEffectiveDate || null, category: editCategory.trim() || null, requireReack: editRequireReack }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Manager access required" : "Couldn't save"); return; }
      // Re-fetch so the (possibly auto-incremented) version + effective date reflect server state.
      const pr = await fetch(`/api/policies/${id}`);
      if (pr.ok) { const d = await pr.json(); setPolicy(d.data ?? d); }
      setVersions(null); // version may have changed
      setEditRequireReack(false);
      setEditing(false);
      toast("Policy saved");
    } catch { toast("Couldn't save"); }
    finally { setSaving(false); }
  }

  async function acknowledge() {
    if (!id || acking || policy?.acknowledged || !attested) return;
    const attestation = policy?.ackStatement?.trim() || DEFAULT_ATTESTATION;
    setAcking(true);
    try {
      const res = await fetch(`/api/policies/${id}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attestation }),
      });
      if (!res.ok) throw new Error();
      // A re-ack doesn't add a new person to the count; a first-time ack does.
      setPolicy((p) => (p ? { ...p, acknowledged: true, needsReack: false, totalAcks: (p.totalAcks ?? 0) + (p.needsReack ? 0 : 1) } : p));
      setAttested(false);
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
              <>
                <button type="button" onClick={openAssign} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
                  <UserPlus className="h-3.5 w-3.5" /> Assign
                </button>
                <button type="button" onClick={openAssignees} className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] hover:bg-zinc-50 ${showAssignees ? "border-zinc-300 bg-zinc-50 text-zinc-900" : "border-zinc-200 text-zinc-700"}`}>
                  <Users className="h-3.5 w-3.5" /> Assignees
                </button>
                <button type="button" onClick={openHistory} className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] hover:bg-zinc-50 ${showHistory ? "border-zinc-300 bg-zinc-50 text-zinc-900" : "border-zinc-200 text-zinc-700"}`}>
                  <History className="h-3.5 w-3.5" /> History
                </button>
                <Link href={`/policies/${policy.id}/compliance`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
                  <ShieldCheck className="h-3.5 w-3.5" /> Audit ledger
                </Link>
                <button type="button" onClick={startEdit} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
              </>
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

      <div className={`px-6 py-8 ${editing ? "w-full max-w-none" : "mx-auto max-w-3xl"}`}>
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
              <label className="flex items-center gap-1.5 text-[13px] text-zinc-500" title="Effective date (system field)">
                <CalendarDays className="h-3.5 w-3.5" />
                <input
                  type="date"
                  value={editEffectiveDate}
                  onChange={(e) => setEditEffectiveDate(e.target.value)}
                  className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-[13px] text-zinc-700"
                />
              </label>
              <input
                type="text"
                list="policy-categories"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                placeholder="Category…"
                title="Category — groups this policy on the Policies page"
                className="h-8 w-40 rounded-md border border-zinc-200 bg-white px-2 text-[13px] text-zinc-700 outline-none focus:border-zinc-300"
              />
              <datalist id="policy-categories">
                <option value="HR" />
                <option value="Security" />
                <option value="Compliance" />
                <option value="Operations" />
                <option value="Code of Conduct" />
                <option value="Leave" />
                <option value="Expense" />
              </datalist>
              {editStatus === "PUBLISHED" ? (
                <label className="flex items-center gap-1.5 text-[13px] text-zinc-600" title="Material change — resets everyone to pending and requires them to re-acknowledge the new version. Leave off for typo/format fixes.">
                  <input type="checkbox" checked={editRequireReack} onChange={(e) => setEditRequireReack(e.target.checked)} className="h-4 w-4" style={{ accentColor: "#7c3aed" }} />
                  Require re-acknowledgement
                </label>
              ) : null}
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
            <div className="rounded-xl border border-zinc-200 bg-white px-10 py-7">
              <BlockNoteCanvas
                key={policy.id}
                initialBnDoc={null}
                legacyBlocks={null}
                initialHtml={policy.content || ""}
                readonly={false}
                onChange={() => { /* HTML-mode: see onHtmlChange */ }}
                onHtmlChange={setEditContent}
                entity={{ type: "policy", id: policy.id }}
              />
            </div>
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
              <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
                {policy.needsReack ? (
                  <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> This policy was updated to v{policy.version}. Please re-acknowledge the current version.
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-4">
                  <div className="min-w-[200px] flex-1">
                    <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-700">
                      <Users className="h-4 w-4 text-zinc-400" /> {policy.totalAcks ?? 0} of {policy.totalUsers ?? 0} acknowledged
                      <span className="text-zinc-400">· {ackRate}% on v{policy.ackVersion ?? policy.version}</span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${ackRate}%` }} />
                    </div>
                  </div>
                  {policy.acknowledged ? (
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-50 px-3 text-[13px] font-medium text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" /> You&apos;ve acknowledged v{policy.ackVersion ?? policy.version}
                    </span>
                  ) : (
                    <div className="flex flex-col items-end gap-2">
                      <label className="flex max-w-sm cursor-pointer items-start gap-2 text-[13px] text-zinc-700">
                        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5 h-4 w-4" style={{ accentColor: "#7c3aed" }} />
                        <span>{policy.ackStatement?.trim() || DEFAULT_ATTESTATION}</span>
                      </label>
                      <button type="button" onClick={acknowledge} disabled={acking || !attested} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
                        {acking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Acknowledge
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {showHistory ? (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-white">
                <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 text-[13px] font-medium text-zinc-700">
                  <History className="h-4 w-4 text-zinc-400" /> Version history
                  <span className="text-zinc-400">· current v{policy.version}</span>
                </div>
                {versions === null ? (
                  <div className="px-4 py-3 text-[13px] text-zinc-400"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Loading…</div>
                ) : versions.length === 0 ? (
                  <div className="px-4 py-3 text-[13px] text-zinc-400">No prior versions yet — edits to a published policy are versioned automatically.</div>
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {versions.map((v) => (
                      <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded bg-zinc-100 px-1.5 text-[12px] font-semibold text-zinc-600">v{v.version}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-zinc-800">{v.title}</div>
                          <div className="text-[11px] text-zinc-400">{new Date(v.createdAt).toLocaleString()}</div>
                        </div>
                        <button type="button" onClick={() => restore(v.id)} disabled={!!restoring} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2 text-[12px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                          {restoring === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {showAssignees ? (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-white">
                <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 text-[13px] font-medium text-zinc-700">
                  <Users className="h-4 w-4 text-zinc-400" /> Assignees
                  {assignees ? <span className="text-zinc-400">· {assignees.filter((a) => a.status === "COMPLETED").length}/{assignees.length} acknowledged</span> : null}
                </div>
                {assignees === null ? (
                  <div className="px-4 py-3 text-[13px] text-zinc-400"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Loading…</div>
                ) : assignees.length === 0 ? (
                  <div className="px-4 py-3 text-[13px] text-zinc-400">No one assigned yet — use <strong>Assign</strong> to send this to employees.</div>
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {assignees.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-zinc-800">{a.name}</div>
                          {a.email ? <div className="truncate text-[11px] text-zinc-400">{a.email}</div> : null}
                        </div>
                        {a.status === "COMPLETED"
                          ? <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Acknowledged</span>
                          : <span className="text-[12px] text-amber-600">Pending</span>}
                      </li>
                    ))}
                  </ul>
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

      {showAssign ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={() => setShowAssign(false)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <div className="text-sm font-semibold text-zinc-900">Assign policy</div>
              <button type="button" onClick={() => setShowAssign(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><X className="h-4 w-4" /></button>
            </div>
            <div className="border-b border-zinc-100 px-4 py-2.5">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-zinc-700">
                <input type="checkbox" checked={assignAll} onChange={(e) => setAssignAll(e.target.checked)} className="h-4 w-4" style={{ accentColor: "#7c3aed" }} />
                Everyone in the org
              </label>
            </div>
            {!assignAll ? (
              <>
                <div className="border-b border-zinc-100 px-4 py-2">
                  <input type="text" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Search people…" className="h-8 w-full rounded-md border border-zinc-200 px-2.5 text-[13px] outline-none focus:border-zinc-300" />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {orgUsers === null ? (
                    <div className="px-4 py-3 text-[13px] text-zinc-400"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Loading…</div>
                  ) : (() => {
                    const q = userQuery.trim().toLowerCase();
                    const list = orgUsers.filter((u) => !q || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q));
                    return list.length === 0 ? (
                      <div className="px-4 py-3 text-[13px] text-zinc-400">No people match.</div>
                    ) : (
                      <ul>
                        {list.map((u) => {
                          const on = selectedIds.has(u.id);
                          return (
                            <li key={u.id}>
                              <label className="flex cursor-pointer items-center gap-2.5 px-4 py-2 hover:bg-zinc-50">
                                <input type="checkbox" checked={on} onChange={() => setSelectedIds((prev) => { const n = new Set(prev); if (on) n.delete(u.id); else n.add(u.id); return n; })} className="h-4 w-4" style={{ accentColor: "#7c3aed" }} />
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] text-zinc-800">{u.firstName} {u.lastName}</div>
                                  <div className="truncate text-[11px] text-zinc-400">{u.email}</div>
                                </div>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              </>
            ) : null}
            <div className="flex items-center gap-2 border-t border-zinc-100 px-4 py-2.5">
              <label htmlFor="assign-due" className="text-[12px] text-zinc-500">Acknowledge by</label>
              <input id="assign-due" type="date" value={assignDueDate} onChange={(e) => setAssignDueDate(e.target.value)} className="h-8 rounded-md border border-zinc-200 px-2 text-[13px] text-zinc-700 outline-none focus:border-zinc-300" />
              {assignDueDate ? <button type="button" onClick={() => setAssignDueDate("")} className="text-[12px] text-zinc-400 hover:text-zinc-700">Clear</button> : <span className="text-[12px] text-zinc-300">optional</span>}
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3">
              <div className="text-[12px] text-zinc-400">{assignAll ? "All active employees" : `${selectedIds.size} selected`}</div>
              <button type="button" onClick={doAssign} disabled={assignBusy} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
                {assignBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Assign
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
