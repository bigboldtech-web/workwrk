"use client";

/* Form builder + submissions inbox (combined).
 *
 * Top: title + isPublic toggle + "Copy share link" + "Open responder".
 * Two tabs:
 *   Build       — add/reorder fields, set labels/required/options
 *   Submissions — list of responses, expand to see per-field answers
 *
 * Field types: short_text, long_text, number, email, url, date,
 *              select (single), multi_select, checkbox.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FormInput, Save, Globe, Lock, Link as LinkIcon, ArrowLeft,
  Trash2, ChevronUp, ChevronDown, Inbox, FileText, Loader2, LayoutGrid,
  Table as TableIcon,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

type ApiStudioBoardLite = { id: string; name: string; slug: string };
type ApiDataTableLite = { id: string; name: string };

type FieldType = "short_text" | "long_text" | "number" | "email" | "url" | "date" | "select" | "multi_select" | "checkbox";

type Field = {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: string[]; // for select / multi_select
  placeholder?: string;
};

type ApiForm = {
  id: string; name: string; description?: string | null;
  fields: Field[]; isPublic: boolean;
  targetBoardId?: string | null;
  targetTableId?: string | null;
  fieldMappings?: { board?: Record<string, string>; table?: Record<string, string> } | null;
  submissionCount: number;
  updatedAt: string;
};

type BoardColumn = { key: string; label: string };
type TableColumn = { id: string; label: string };

type ApiSub = {
  id: string; data: Record<string, unknown>;
  submittedAt: string; submittedById: string | null;
};

const FIELD_LABEL: Record<FieldType, string> = {
  short_text: "Short text", long_text: "Long text", number: "Number",
  email: "Email", url: "URL", date: "Date",
  select: "Single choice", multi_select: "Multiple choice", checkbox: "Checkbox",
};

function newId() { return Math.random().toString(36).slice(2, 10); }

export default function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [formId, setFormId] = useState<string | null>(null);
  const [form, setForm] = useState<ApiForm | null>(null);
  const [tab, setTab] = useState<"build" | "submissions">("build");
  const [subs, setSubs] = useState<ApiSub[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [boards, setBoards] = useState<ApiStudioBoardLite[]>([]);
  const [tables, setTables] = useState<ApiDataTableLite[]>([]);
  const [boardColumns, setBoardColumns] = useState<BoardColumn[]>([]);
  const [tableColumns, setTableColumns] = useState<TableColumn[]>([]);

  useEffect(() => { void params.then((p) => setFormId(p.id)); }, [params]);

  const load = useCallback(async () => {
    if (!formId) return;
    try {
      const res = await fetch(`/api/forms/${formId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const f: ApiForm = d.data ?? d;
      // Normalise fields shape if missing
      f.fields = Array.isArray(f.fields) ? f.fields : [];
      setForm(f);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [formId]);
  useEffect(() => { void load(); }, [load]);

  const loadSubs = useCallback(async () => {
    if (!formId) return;
    try {
      const res = await fetch(`/api/forms/${formId}/submissions`);
      if (!res.ok) return;
      const d = await res.json();
      setSubs(d.data ?? (Array.isArray(d) ? d : []));
    } catch { /* ignore */ }
  }, [formId]);

  useEffect(() => { if (tab === "submissions") void loadSubs(); }, [tab, loadSubs]);

  // Whenever target IDs change, pull the target's column definitions so the mapping UI can show labels.
  useEffect(() => {
    if (!form?.targetBoardId) { setBoardColumns([]); return; }
    const board = boards.find((b) => b.id === form.targetBoardId);
    if (!board) return;
    void (async () => {
      try {
        const res = await fetch(`/api/studio/boards/${board.slug}`);
        if (!res.ok) return;
        const d = await res.json();
        const fields = (d.board?.fields ?? d.fields ?? []) as BoardColumn[];
        setBoardColumns(fields);
      } catch { /* ignore */ }
    })();
  }, [form?.targetBoardId, boards]);

  useEffect(() => {
    if (!form?.targetTableId) { setTableColumns([]); return; }
    void (async () => {
      try {
        const res = await fetch(`/api/tables/${form.targetTableId}`);
        if (!res.ok) return;
        const d = await res.json();
        const cols = (d.data?.columns ?? d.columns ?? []) as TableColumn[];
        setTableColumns(cols);
      } catch { /* ignore */ }
    })();
  }, [form?.targetTableId]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/studio/boards");
        if (!res.ok) return;
        const d = await res.json();
        setBoards(d.boards ?? []);
      } catch { /* ignore */ }
    })();
    void (async () => {
      try {
        const res = await fetch("/api/tables");
        if (!res.ok) return;
        const d = await res.json();
        setTables(d.data ?? (Array.isArray(d) ? d : []));
      } catch { /* ignore */ }
    })();
  }, []);

  async function save() {
    if (!form || !formId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/forms/${formId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim() || "Untitled form",
          description: form.description,
          fields: form.fields,
          isPublic: form.isPublic,
          targetBoardId: form.targetBoardId ?? null,
          targetTableId: form.targetTableId ?? null,
          fieldMappings: form.fieldMappings ?? {},
        }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      toast("Saved");
    } catch { toast("Couldn't save"); }
    setSaving(false);
  }

  function updateField(id: string, patch: Partial<Field>) {
    setForm((prev) => prev ? { ...prev, fields: prev.fields.map((f) => f.id === id ? { ...f, ...patch } : f) } : prev);
  }
  function addField(type: FieldType) {
    setForm((prev) => prev ? {
      ...prev,
      fields: [...prev.fields, { id: newId(), type, label: FIELD_LABEL[type], required: false, options: type === "select" || type === "multi_select" ? ["Option 1"] : undefined }],
    } : prev);
  }
  function removeField(id: string) {
    setForm((prev) => prev ? { ...prev, fields: prev.fields.filter((f) => f.id !== id) } : prev);
  }
  function moveField(id: string, dir: -1 | 1) {
    setForm((prev) => {
      if (!prev) return prev;
      const arr = [...prev.fields];
      const i = arr.findIndex((f) => f.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...prev, fields: arr };
    });
  }

  function copyResponderLink() {
    if (!formId) return;
    const url = `${window.location.origin}/forms/${formId}/respond`;
    navigator.clipboard.writeText(url).then(() => toast("Responder link copied"));
  }

  function copyEmbedSnippet() {
    if (!formId) return;
    const url = `${window.location.origin}/embed/forms/${formId}`;
    const snippet = `<iframe src="${url}" width="100%" height="640" frameborder="0" style="border:1px solid #e5e7eb;border-radius:8px"></iframe>`;
    navigator.clipboard.writeText(snippet).then(() => toast(form?.isPublic ? "Embed snippet copied" : "Snippet copied — set the form to Public so external sites can submit"));
  }

  const fieldMap = useMemo(() => new Map((form?.fields ?? []).map((f) => [f.id, f])), [form?.fields]);

  if (loadError) return <div className="frmb__error">Couldn&apos;t load form: {loadError}</div>;
  if (!form) return <div className="frmb__loading"><Loader2 className="frmb__spin" /> Loading…</div>;

  return (
    <div className="frmb">
      <header className="frmb__head">
        <button type="button" className="frmb__back" onClick={() => router.push("/forms")} aria-label="Back"><ArrowLeft /></button>
        <div className="frmb__title-wrap">
          <FormInput />
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Untitled form"
          />
        </div>
        <div className="frmb__actions">
          <label className="frmb__public-toggle">
            <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
            {form.isPublic ? <><Globe /> Public</> : <><Lock /> Org-only</>}
          </label>
          <button type="button" className="frmb__btn" onClick={copyResponderLink}><LinkIcon /> Share link</button>
          <button type="button" className="frmb__btn" onClick={copyEmbedSnippet} title="Copy <iframe> snippet for your website"><FileText /> Embed code</button>
          <button type="button" className="frmb__btn frmb__btn--primary" onClick={save} disabled={saving}>
            <Save /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <nav className="frmb__tabs">
        <button type="button" className={tab === "build" ? "is-active" : ""} onClick={() => setTab("build")}>
          <FileText /> Build
        </button>
        <button type="button" className={tab === "submissions" ? "is-active" : ""} onClick={() => setTab("submissions")}>
          <Inbox /> Submissions <em>{form.submissionCount}</em>
        </button>
      </nav>

      {tab === "build" ? (
        <div className="frmb__build">
          <div className="frmb__fields">
            {form.fields.length === 0 ? (
              <div className="frmb__empty">
                <p>No fields yet. Add one below to start building.</p>
              </div>
            ) : form.fields.map((f, idx) => (
              <article key={f.id} className="frmb-field">
                <header>
                  <span className="frmb-field__type">{FIELD_LABEL[f.type]}</span>
                  <div className="frmb-field__actions">
                    <button type="button" onClick={() => moveField(f.id, -1)} disabled={idx === 0}><ChevronUp /></button>
                    <button type="button" onClick={() => moveField(f.id, 1)} disabled={idx === form.fields.length - 1}><ChevronDown /></button>
                    <button type="button" onClick={() => removeField(f.id)}><Trash2 /></button>
                  </div>
                </header>
                <input
                  type="text"
                  className="frmb-field__label"
                  value={f.label}
                  onChange={(e) => updateField(f.id, { label: e.target.value })}
                  placeholder="Question label"
                />
                <label className="frmb-field__required">
                  <input type="checkbox" checked={f.required} onChange={(e) => updateField(f.id, { required: e.target.checked })} />
                  Required
                </label>
                {(f.type === "select" || f.type === "multi_select") && (
                  <div className="frmb-field__options">
                    <label>Options (one per line)</label>
                    <textarea
                      rows={Math.min(8, Math.max(2, (f.options ?? []).length))}
                      value={(f.options ?? []).join("\n")}
                      onChange={(e) => updateField(f.id, { options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>

          <aside className="frmb__add">
            <h3>Add a field</h3>
            <div className="frmb__add-grid">
              {(Object.keys(FIELD_LABEL) as FieldType[]).map((t) => (
                <button key={t} type="button" onClick={() => addField(t)}>{FIELD_LABEL[t]}</button>
              ))}
            </div>

            <h3 style={{ marginTop: 24 }}><LayoutGrid style={{ verticalAlign: -3, marginRight: 6 }} /> Send to board</h3>
            <p style={{ fontSize: 12, color: "var(--os-ink-3)", margin: "4px 0 10px" }}>
              Every submission auto-creates a row on the chosen Studio board. Match form field labels to board column labels.
            </p>
            <select
              value={form.targetBoardId ?? ""}
              onChange={(e) => setForm({ ...form, targetBoardId: e.target.value || null })}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--os-line)", borderRadius: 6, fontSize: 13, background: "var(--os-bg)" }}
            >
              <option value="">— None —</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>

            <h3 style={{ marginTop: 18 }}><TableIcon style={{ verticalAlign: -3, marginRight: 6 }} /> Send to table</h3>
            <p style={{ fontSize: 12, color: "var(--os-ink-3)", margin: "4px 0 10px" }}>
              Or feed a Data Table. Both can be set — submissions go to both targets.
            </p>
            <select
              value={form.targetTableId ?? ""}
              onChange={(e) => setForm({ ...form, targetTableId: e.target.value || null })}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--os-line)", borderRadius: 6, fontSize: 13, background: "var(--os-bg)" }}
            >
              <option value="">— None —</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>

            {(form.targetBoardId || form.targetTableId) && form.fields.length > 0 && (
              <div className="frmb__mapping">
                <h3 style={{ marginTop: 18 }}>Field mapping</h3>
                <p>Explicit mapping — empty = match by label (case-insensitive).</p>
                <div className="frmb__mapping-grid">
                  <div className="frmb__mapping-head">Form field</div>
                  {form.targetBoardId && <div className="frmb__mapping-head">→ Board column</div>}
                  {form.targetTableId && <div className="frmb__mapping-head">→ Table column</div>}
                  {form.fields.map((f) => {
                    const mappings = form.fieldMappings ?? {};
                    return (
                      <FieldMappingRow
                        key={f.id}
                        field={f}
                        boardSelected={mappings.board?.[f.id] ?? ""}
                        tableSelected={mappings.table?.[f.id] ?? ""}
                        showBoard={!!form.targetBoardId}
                        showTable={!!form.targetTableId}
                        boardColumns={boardColumns}
                        tableColumns={tableColumns}
                        onBoardChange={(k) => setForm({ ...form, fieldMappings: { ...mappings, board: { ...(mappings.board ?? {}), [f.id]: k } } })}
                        onTableChange={(k) => setForm({ ...form, fieldMappings: { ...mappings, table: { ...(mappings.table ?? {}), [f.id]: k } } })}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="frmb__subs">
          {subs === null ? (
            <div className="frmb__empty"><Loader2 className="frmb__spin" /> Loading submissions…</div>
          ) : subs.length === 0 ? (
            <div className="frmb__empty">
              <Inbox />
              <p>No submissions yet. Share the responder link from the top bar.</p>
            </div>
          ) : (
            <div className="frmb__subs-list">
              {subs.map((s) => (
                <details key={s.id} className="frmsub">
                  <summary>
                    <span className="frmsub__date">{new Date(s.submittedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    <span className="frmsub__who">{s.submittedById ? "Org member" : "Anonymous"}</span>
                  </summary>
                  <div className="frmsub__answers">
                    {form.fields.map((f) => {
                      const v = s.data[f.id];
                      const display = Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "—" : String(v);
                      return (
                        <div key={f.id} className="frmsub__row">
                          <span className="frmsub__label">{f.label}</span>
                          <span className="frmsub__value">{display || "—"}</span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldMappingRow({ field, boardSelected, tableSelected, showBoard, showTable, boardColumns, tableColumns, onBoardChange, onTableChange }: {
  field: Field;
  boardSelected: string; tableSelected: string;
  showBoard: boolean; showTable: boolean;
  boardColumns: BoardColumn[]; tableColumns: TableColumn[];
  onBoardChange: (key: string) => void;
  onTableChange: (key: string) => void;
}) {
  return (
    <>
      <div className="frmb__mapping-label">{field.label}</div>
      {showBoard && (
        <select value={boardSelected} onChange={(e) => onBoardChange(e.target.value)}>
          <option value="">(auto-match)</option>
          {boardColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      )}
      {showTable && (
        <select value={tableSelected} onChange={(e) => onTableChange(e.target.value)}>
          <option value="">(auto-match)</option>
          {tableColumns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      )}
    </>
  );
}
