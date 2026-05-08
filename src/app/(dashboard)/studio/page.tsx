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
import { Wrench, Plus, GitBranch, ListPlus, Trash2 } from "lucide-react";

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
      <Tabs defaultValue="workflows">
        <TabsList>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="fields">Custom fields</TabsTrigger>
        </TabsList>
        <TabsContent value="workflows" className="mt-4"><WorkflowsTab /></TabsContent>
        <TabsContent value="fields" className="mt-4"><CustomFieldsTab /></TabsContent>
      </Tabs>
    </div>
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

function CreateWorkflowDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState("EXPENSE");
  const [steps, setSteps] = useState<WorkflowStep[]>([
    { id: "step-1", name: "Manager review", approverRule: "MANAGER" },
  ]);
  const [saving, setSaving] = useState(false);

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
            <Card key={target}>
              <CardContent className="p-4">
                <div className="text-xs uppercase tracking-widest text-muted mb-2">{target}</div>
                <ul className="divide-y divide-white/5">
                  {fields.map((f) => (
                    <li key={f.id} className="py-2 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">
                          {f.label}
                          {f.required && <span className="text-red-400 ml-1">*</span>}
                        </div>
                        <div className="text-[10px] text-muted font-mono">{f.key} · {FIELD_TYPE_LABEL[f.fieldType]}</div>
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${f.active ? "text-green-400 border-green-400/30" : "text-muted border-white/20"}`}>
                        {f.active ? "Active" : "Disabled"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
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
