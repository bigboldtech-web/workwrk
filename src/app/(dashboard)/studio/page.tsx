"use client";

// Studio — admin-side configurator. Two tabs:
//   - Workflows: define multi-step approval chains for any record type.
//   - Custom fields: extend any object with org-specific fields.
//
// Both are CRUD-light: list + create dialog. Editing existing rows
// happens via the JSON-shaped admin UI under each list (planned in
// v2 — for now, delete + re-create is the path if a definition needs
// to change).

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Wrench, Plus, GitBranch, ListPlus, Trash2, GripVertical, FlaskConical } from "lucide-react";
import { CustomFieldsPanel } from "@/components/custom-fields/custom-fields-panel";

type WorkflowStep = {
  id: string;
  name: string;
  approverRule: "MANAGER" | "ADMIN" | "ROLE" | "USER";
  approverValue?: string;
  slaHours?: number;
  requireNote?: boolean;
};

type Workflow = {
  id: string;
  name: string;
  targetType: string;
  active: boolean;
  steps: WorkflowStep[];
  _count: { runs: number };
};

type FieldType = "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT" | "MULTI_SELECT" | "URL" | "EMAIL";

type CustomField = {
  id: string;
  targetType: string;
  key: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  position: number;
  active: boolean;
  options: Record<string, unknown>;
};

const TARGET_TYPES = [
  "EXPENSE", "PURCHASE_ORDER", "INVOICE", "TIME_OFF_REQUEST",
  "TIMESHEET", "TASK", "USER", "VENDOR", "CANDIDATE",
  "JOB", "REVIEW", "POLICY", "MEETING",
];

const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Text", TEXTAREA: "Long text", NUMBER: "Number", DATE: "Date",
  CHECKBOX: "Checkbox", SELECT: "Single select", MULTI_SELECT: "Multi select",
  URL: "URL", EMAIL: "Email",
};

export default function StudioPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Wrench size={20} /> Studio
        </h1>
        <p className="text-muted text-sm mt-1">
          Custom approval workflows and per-org fields. Define the platform's behavior to fit how you work.
        </p>
      </div>
      <Tabs defaultValue="fields">
        <TabsList>
          <TabsTrigger value="fields">Custom fields</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="playground">Playground</TabsTrigger>
        </TabsList>
        <TabsContent value="fields" className="mt-4"><CustomFieldsTab /></TabsContent>
        <TabsContent value="workflows" className="mt-4"><WorkflowsTab /></TabsContent>
        <TabsContent value="playground" className="mt-4"><PlaygroundTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// Playground — verify your custom field definitions work end-to-end
// without leaving Studio. Pick a target type + paste any record ID
// from that table, see the live field editor render + save.
function PlaygroundTab() {
  const [entityType, setEntityType] = useState<string>("TASK");
  const [entityId, setEntityId] = useState<string>("");
  const [activeEntityId, setActiveEntityId] = useState<string>("");

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-violet-600" />
          <h3 className="text-sm font-semibold">Live preview</h3>
          <Badge variant="secondary" className="text-[10px]">Phase C1</Badge>
        </div>
        <p className="text-xs text-muted">
          Pick a target type, paste a record ID from that table, and see your custom fields render
          + save in real time. Field values persist to <code className="text-[11px]">CustomFieldValue</code> and
          can be read back from any feature via <code className="text-[11px]">/api/custom-fields/values</code>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr_auto] gap-2 items-end">
          <div>
            <Label className="text-xs">Target type</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TARGET_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Record ID (cuid)</Label>
            <Input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="paste an id from the database"
            />
          </div>
          <Button
            type="button"
            onClick={() => setActiveEntityId(entityId.trim())}
            disabled={!entityId.trim()}
          >
            Load
          </Button>
        </div>

        {activeEntityId && (
          <div className="border border-border rounded-lg p-4 bg-surface-2">
            <CustomFieldsPanel
              entityType={entityType}
              entityId={activeEntityId}
              showEmptyState
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WorkflowsTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workflows");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1.5" /> New workflow
        </Button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted">
            No workflows yet. Build a multi-step approval chain for any record type.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((w) => (
            <Card key={w.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <GitBranch size={14} className="text-muted" />
                      <span className="font-medium">{w.name}</span>
                      <Badge variant="outline" className="text-[10px]">{w.targetType}</Badge>
                      <Badge variant="outline" className={`text-[10px] ${w.active ? "text-green-400 border-green-400/30" : "text-muted border-white/20"}`}>
                        {w.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted mt-1">{w._count.runs} runs · {w.steps.length} step{w.steps.length === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <ol className="flex flex-wrap items-center gap-2 text-xs">
                  {w.steps.map((s, i) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded border border-line">
                        <span className="text-muted mr-1">{i + 1}.</span>
                        {s.name}
                        <span className="text-muted ml-1.5">
                          ({s.approverRule}{s.approverValue ? `:${s.approverValue}` : ""})
                        </span>
                      </span>
                      {i < w.steps.length - 1 && <span className="text-muted">→</span>}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {showCreate && (
        <CreateWorkflowDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); toast({ type: "success", title: "Workflow created" }); load(); }}
        />
      )}
    </>
  );
}

// Pre-built approval-chain shapes. The user can clone one as a starting
// point instead of building from scratch — each captures a common
// workplace pattern (1-up manager, dual sign, admin override, etc.).
const WORKFLOW_TEMPLATES: Array<{
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}> = [
  {
    id: "1-up-manager",
    name: "1-up manager",
    description: "Simplest case: requester's direct manager approves.",
    steps: [{ id: "step-1", name: "Manager approval", approverRule: "MANAGER" }],
  },
  {
    id: "manager-then-admin",
    name: "Manager → org admin",
    description: "Manager signs off, then finance / org admin double-checks.",
    steps: [
      { id: "step-1", name: "Manager approval", approverRule: "MANAGER" },
      { id: "step-2", name: "Org admin sign-off", approverRule: "ADMIN" },
    ],
  },
  {
    id: "dual-sign",
    name: "Dual sign-off",
    description: "Two different org admins must both approve (segregation of duties).",
    steps: [
      { id: "step-1", name: "First admin", approverRule: "ADMIN", requireNote: true },
      { id: "step-2", name: "Second admin", approverRule: "ADMIN", requireNote: true },
    ],
  },
  {
    id: "three-tier",
    name: "Three-tier (manager → director → admin)",
    description: "For larger orgs: layered review up the chain.",
    steps: [
      { id: "step-1", name: "Manager approval", approverRule: "MANAGER" },
      { id: "step-2", name: "Director review", approverRule: "ROLE" },
      { id: "step-3", name: "Org admin sign-off", approverRule: "ADMIN" },
    ],
  },
  {
    id: "hr-plus-manager",
    name: "HR + manager (sensitive ops)",
    description: "HR confirms first (comp, leave-of-absence, terminations), then manager.",
    steps: [
      { id: "step-1", name: "HR review", approverRule: "ROLE" },
      { id: "step-2", name: "Manager confirm", approverRule: "MANAGER", requireNote: true },
    ],
  },
];

function CreateWorkflowDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState("EXPENSE");
  const [steps, setSteps] = useState<WorkflowStep[]>([
    { id: "step-1", name: "Manager review", approverRule: "MANAGER" },
  ]);
  const [saving, setSaving] = useState(false);

  function applyTemplate(templateId: string) {
    const t = WORKFLOW_TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    // Clone the steps so editing one workflow's draft doesn't mutate the
    // shared template definition.
    setSteps(t.steps.map((s, i) => ({ ...s, id: `step-${i + 1}` })));
    if (!name.trim()) setName(t.name);
  }

  function addStep() {
    setSteps((s) => [...s, { id: `step-${s.length + 1}`, name: "Approval", approverRule: "MANAGER" }]);
  }
  function removeStep(idx: number) {
    setSteps((s) => s.filter((_, i) => i !== idx));
  }
  function updateStep(idx: number, patch: Partial<WorkflowStep>) {
    setSteps((s) => s.map((step, i) => i === idx ? { ...step, ...patch } : step));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), targetType, steps }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't save", description: data?.error });
        return;
      }
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New workflow</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Expense > $5k approval" autoFocus /></div>
            <div className="space-y-1.5">
              <Label>Applies to</Label>
              <Select value={targetType} onValueChange={setTargetType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TARGET_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Start from a template</Label>
              <span className="text-[10px] text-muted-2">applies to the steps below</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WORKFLOW_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.id)}
                  title={t.description}
                  className="text-[10px] rounded-md border border-line px-2 py-1 text-muted hover:text-foreground hover:border-fg/30 transition-colors text-left"
                >
                  <span className="font-medium">{t.name}</span>
                  <span className="text-muted-2 ml-1.5">· {t.steps.length} step{t.steps.length === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Steps</Label>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addStep}>
                <ListPlus size={12} className="mr-1" /> Add step
              </Button>
            </div>
            {steps.map((s, i) => (
              <div key={s.id} className="border border-line rounded p-2 grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                <Input
                  value={s.name}
                  onChange={(e) => updateStep(i, { name: e.target.value })}
                  className="h-8 text-xs"
                  placeholder="Step name"
                />
                <Select value={s.approverRule} onValueChange={(v) => updateStep(i, { approverRule: v as WorkflowStep["approverRule"] })}>
                  <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="ADMIN">Org admin</SelectItem>
                    <SelectItem value="ROLE">Role…</SelectItem>
                    <SelectItem value="USER">Specific user…</SelectItem>
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  disabled={steps.length === 1}
                  className="text-muted hover:text-red-400 disabled:opacity-30 p-1"
                  aria-label="Remove step"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!name.trim() || saving} onClick={save}>{saving ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomFieldsTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/custom-fields");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group by target type so the page reads as "what extra fields am I
  // adding to each entity?" instead of a flat list.
  const grouped = new Map<string, CustomField[]>();
  for (const f of rows) {
    const arr = grouped.get(f.targetType) ?? [];
    arr.push(f);
    grouped.set(f.targetType, arr);
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1.5" /> New field
        </Button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted">
            No custom fields yet. Add fields to expenses, POs, candidates, or any record type.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {Array.from(grouped.entries()).map(([target, fields]) => (
            <FieldGroup
              key={target}
              targetType={target}
              fields={fields}
              onReorder={async (newOrder) => {
                // Optimistic: rewrite local positions in render order so
                // the drop snaps immediately. Then fan out PATCH calls;
                // any failure triggers a refetch to roll back.
                setRows((prev) => {
                  const byId = new Map(newOrder.map((f, i) => [f.id, i]));
                  return prev.map((r) =>
                    r.targetType === target && byId.has(r.id)
                      ? { ...r, position: byId.get(r.id)! }
                      : r,
                  );
                });
                try {
                  await Promise.all(
                    newOrder.map((f, i) =>
                      fetch(`/api/custom-fields/${f.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ position: i }),
                      }).then((r) => {
                        if (!r.ok) throw new Error("position save failed");
                      }),
                    ),
                  );
                } catch {
                  toast({ type: "error", title: "Couldn't save new order — reloading" });
                  load();
                }
              }}
            />
          ))}
        </div>
      )}
      {showCreate && (
        <CreateFieldDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); toast({ type: "success", title: "Field added" }); load(); }}
        />
      )}
    </>
  );
}

function CreateFieldDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [targetType, setTargetType] = useState("EXPENSE");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("TEXT");
  const [required, setRequired] = useState(false);
  const [choicesText, setChoicesText] = useState("");
  const [saving, setSaving] = useState(false);

  // Auto-derive a snake_case key from the label as the user types,
  // unless they've started editing the key directly.
  const [keyTouched, setKeyTouched] = useState(false);
  useEffect(() => {
    if (keyTouched) return;
    const k = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    setKey(k);
  }, [label, keyTouched]);

  async function save() {
    setSaving(true);
    try {
      const options: Record<string, unknown> = {};
      if (fieldType === "SELECT" || fieldType === "MULTI_SELECT") {
        const choices = choicesText.split("\n").map((s) => s.trim()).filter(Boolean).map((s) => ({
          value: s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
          label: s,
        }));
        options.choices = choices;
      }
      const res = await fetch("/api/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, key, label, fieldType, required, options }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't save", description: data?.error });
        return;
      }
      onCreated();
    } finally { setSaving(false); }
  }

  const needsChoices = fieldType === "SELECT" || fieldType === "MULTI_SELECT";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New custom field</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Applies to</Label>
              <Select value={targetType} onValueChange={setTargetType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TARGET_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={fieldType} onValueChange={(v) => setFieldType(v as FieldType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FIELD_TYPE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Project code" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Key (snake_case)</Label>
            <Input
              value={key}
              onChange={(e) => { setKey(e.target.value); setKeyTouched(true); }}
              placeholder="project_code"
            />
          </div>
          {needsChoices && (
            <div className="space-y-1.5">
              <Label>Choices (one per line)</Label>
              <Textarea
                value={choicesText}
                onChange={(e) => setChoicesText(e.target.value)}
                rows={4}
                placeholder={"Marketing\nEngineering\nSales"}
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            Required field
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!label.trim() || !key.trim() || saving} onClick={save}>{saving ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One target-type group inside the custom-fields list. Local state
// holds the in-flight ordering so a drag feels instant; we only call
// `onReorder` on drop with the final array. Re-syncs from props on
// every re-render so a parent refetch wins over local state.
function FieldGroup({
  targetType,
  fields,
  onReorder,
}: {
  targetType: string;
  fields: CustomField[];
  onReorder: (newOrder: CustomField[]) => Promise<void>;
}) {
  // Sort by position so the user sees the same order the API would
  // return on a refetch. Stable across renders since we control the
  // sort key explicitly.
  const sorted = [...fields].sort((a, b) => a.position - b.position);
  const [local, setLocal] = useState<CustomField[]>(sorted);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null);
  // Sync local state with props whenever the parent's `fields` array
  // changes (e.g., a refetch after a failed save). Using JSON-string
  // of ids as the dep so we don't re-sync on every parent render.
  const propsKey = sorted.map((f) => f.id).join(",");
  useEffect(() => {
    setLocal(sorted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsKey]);

  function handleDrop(targetId: string | null) {
    const dragId = draggingId;
    setDraggingId(null);
    setDropBeforeId(null);
    if (!dragId) return;
    const fromIdx = local.findIndex((f) => f.id === dragId);
    if (fromIdx < 0) return;
    let toIdx = targetId === null ? local.length : local.findIndex((f) => f.id === targetId);
    if (toIdx < 0) return;
    if (toIdx > fromIdx) toIdx -= 1;
    if (toIdx === fromIdx) return;
    const next = [...local];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setLocal(next);
    onReorder(next);
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-widest text-muted mb-2">{targetType}</div>
        <ul className="divide-y divide-border">
          {local.map((f) => {
            const isDragging = draggingId === f.id;
            const showDropLine = dropBeforeId === f.id;
            return (
              <li
                key={f.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-custom-field-id", f.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingId(f.id);
                }}
                onDragEnd={() => { setDraggingId(null); setDropBeforeId(null); }}
                onDragOver={(e) => {
                  if (!draggingId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropBeforeId !== f.id) setDropBeforeId(f.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(f.id);
                }}
                className={
                  "py-2 flex items-center justify-between gap-3 transition-opacity " +
                  (isDragging ? "opacity-40 " : "") +
                  (showDropLine ? "border-t-2 border-[color:var(--accent-strong)] -mt-px " : "")
                }
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GripVertical
                    size={12}
                    className="text-muted-2 cursor-grab active:cursor-grabbing flex-shrink-0"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {f.label}
                      {f.required && <span className="text-red-400 ml-1">*</span>}
                    </div>
                    <div className="text-[10px] text-muted font-mono truncate">{f.key} · {FIELD_TYPE_LABEL[f.fieldType]}</div>
                  </div>
                </div>
                <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${f.active ? "text-green-400 border-green-400/30" : "text-muted border-white/20"}`}>
                  {f.active ? "Active" : "Disabled"}
                </Badge>
              </li>
            );
          })}
          {/* Trailing drop zone — drag to the bottom to send a field to
              the end of its group. Same handler with a null target. */}
          <li
            onDragOver={(e) => { if (draggingId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
            onDrop={(e) => { e.preventDefault(); handleDrop(null); }}
            className="h-2"
            aria-hidden
          />
        </ul>
      </CardContent>
    </Card>
  );
}
