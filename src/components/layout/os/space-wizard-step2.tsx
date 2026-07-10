"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Plus, X, GripVertical, Layers, Target, Settings2, Users, Search, Check } from "lucide-react";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  PRESETS,
  VIEW_CATALOG,
  MODULE_CATALOG,
  workflowFromPreset,
} from "./space-wizard-presets";
import type {
  ModuleKey,
  PresetId,
  StatusDef,
  StatusGroup,
  ViewKey,
  WorkflowConfig,
} from "./space-wizard-types";

export type Step2SubScreen = null | "owner" | "views" | "statuses" | "modules";

export interface UserOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatar?: string | null;
  role?: { title: string | null } | null;
  department?: { name: string | null } | null;
}

interface Step2Props {
  workflow: WorkflowConfig;
  subScreen: Step2SubScreen;
  accent: string;
  error: string | null;
  submitting: boolean;
  users: UserOption[];
  loadingUsers: boolean;
  onChange: (next: WorkflowConfig) => void;
  onSubScreen: (next: Step2SubScreen) => void;
  onBack: () => void;
  onCreate: () => void;
}

export function SpaceWizardStep2(props: Step2Props) {
  const { workflow, subScreen } = props;

  if (subScreen === "owner") {
    return (
      <OwnerSubScreen
        accent={props.accent}
        users={props.users}
        loading={props.loadingUsers}
        ownerId={workflow.ownerId}
        onChange={(id) => props.onChange({ ...workflow, ownerId: id })}
        onClose={() => props.onSubScreen(null)}
      />
    );
  }

  if (subScreen === "views") {
    return (
      <ViewsSubScreen
        accent={props.accent}
        defaultViews={workflow.defaultViews}
        defaultViewKey={workflow.defaultViewKey}
        onChange={(views, defaultKey) =>
          props.onChange({
            ...workflow,
            defaultViews: views,
            defaultViewKey: defaultKey ?? workflow.defaultViewKey,
          })
        }
        onClose={() => props.onSubScreen(null)}
      />
    );
  }

  if (subScreen === "statuses") {
    return (
      <StatusesSubScreen
        accent={props.accent}
        statuses={workflow.statuses}
        onChange={(statuses) => props.onChange({ ...workflow, statuses })}
        onClose={() => props.onSubScreen(null)}
      />
    );
  }

  if (subScreen === "modules") {
    return (
      <ModulesSubScreen
        accent={props.accent}
        modules={workflow.modules}
        onChange={(modules) => props.onChange({ ...workflow, modules })}
        onClose={() => props.onSubScreen(null)}
      />
    );
  }

  return <Step2Main {...props} />;
}

// ────────────────────────────────────────────────────────────────────
// Main Step 2 view
// ────────────────────────────────────────────────────────────────────

function Step2Main({
  workflow,
  accent,
  error,
  submitting,
  users,
  onChange,
  onSubScreen,
  onBack,
  onCreate,
}: Step2Props) {
  const setPreset = (id: PresetId) => onChange(workflowFromPreset(id, workflow.ownerId));

  const viewLabels = useMemo(
    () =>
      workflow.defaultViews
        .map((k) => VIEW_CATALOG.find((v) => v.key === k)?.label)
        .filter(Boolean)
        .join(", "),
    [workflow.defaultViews],
  );

  const ownerLabel = useMemo(() => {
    if (!workflow.ownerId) return "Creator (you)";
    const u = users.find((x) => x.id === workflow.ownerId);
    if (!u) return "Selected";
    return userDisplayName(u);
  }, [workflow.ownerId, users]);

  const statusPreview = useMemo(() => workflow.statuses.slice(0, 3), [workflow.statuses]);
  const moduleCount = workflow.modules.length;
  const selectedPreset = PRESETS.find((p) => p.id === workflow.preset);

  return (
    <>
      <div className="px-6 pt-6 pb-3">
        <DialogTitle className="text-[15px] font-semibold">Define your workflow</DialogTitle>
        <DialogDescription className="mt-1">
          Choose a pre-configured solution or customize the views, statuses, and modules.
        </DialogDescription>
      </div>

      <div className="px-6 pb-2 space-y-4 max-h-[60vh] overflow-y-auto">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => {
            const isSelected = workflow.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className="text-left rounded-lg border bg-surface p-3 transition hover:bg-surface-2"
                style={{
                  borderColor: isSelected ? accent : "var(--border, #e4e4e7)",
                  boxShadow: isSelected ? `0 0 0 2px ${accent}20` : undefined,
                }}
              >
                <div className="text-[13px] font-semibold">{p.title}</div>
                <div className="text-[11.5px] text-muted mt-0.5 leading-snug">{p.blurb}</div>
              </button>
            );
          })}
        </div>

        <div className="pt-2">
          <div className="text-[12px] text-muted mb-2">
            Customize defaults for <span className="font-medium text-foreground">{selectedPreset?.title}</span>
          </div>
          <div className="space-y-2">
            <CustomizeRow
              icon={<Users className="h-3.5 w-3.5" />}
              label="Space owner"
              value={ownerLabel}
              onClick={() => onSubScreen("owner")}
            />
            <CustomizeRow
              icon={<Layers className="h-3.5 w-3.5" />}
              label="Default views"
              value={viewLabels || "List"}
              onClick={() => onSubScreen("views")}
            />
            <CustomizeRow
              icon={<Target className="h-3.5 w-3.5" />}
              label="Task statuses"
              value={
                <span className="inline-flex items-center gap-1.5">
                  {statusPreview.map((s, i) => (
                    <span key={s.key} className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                      <span>{s.label}</span>
                      {i < statusPreview.length - 1 ? <span className="text-muted-2">→</span> : null}
                    </span>
                  ))}
                </span>
              }
              onClick={() => onSubScreen("statuses")}
            />
            <CustomizeRow
              icon={<Settings2 className="h-3.5 w-3.5" />}
              label="Modules"
              value={`${moduleCount} enabled`}
              onClick={() => onSubScreen("modules")}
            />
          </div>
        </div>

        {error ? (
          <div className="text-[12px] text-red-500 bg-red-500/10 rounded-md px-3 py-2">{error}</div>
        ) : null}
      </div>

      <div className="px-6 py-4 mt-2 border-t border-border flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[13px] text-muted hover:text-foreground px-3 py-2"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={submitting}
          className="px-4 py-2 rounded-lg text-[13px] font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: accent }}
        >
          {submitting ? "Creating…" : "Create Space"}
        </button>
      </div>
    </>
  );
}

function CustomizeRow({
  icon,
  label,
  value,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-lg border border-border bg-surface px-3 py-2.5 flex items-center gap-3 transition ${
        disabled ? "cursor-default opacity-60" : "hover:bg-surface-2"
      }`}
    >
      <span className="h-7 w-7 rounded-md bg-surface-2 flex items-center justify-center text-muted shrink-0">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-medium">{label}</span>
        <span className="block text-[11.5px] text-muted truncate mt-0.5">{value}</span>
      </span>
      {!disabled ? <ChevronRight className="h-4 w-4 text-muted shrink-0" /> : null}
    </button>
  );
}

function userDisplayName(u: UserOption): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email;
}

// ────────────────────────────────────────────────────────────────────
// Sub-screen: Space owner
// ────────────────────────────────────────────────────────────────────

function OwnerSubScreen({
  accent,
  users,
  loading,
  ownerId,
  onChange,
  onClose,
}: {
  accent: string;
  users: UserOption[];
  loading: boolean;
  ownerId: string | null;
  onChange: (id: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      if (u.email.toLowerCase().includes(q)) return true;
      if (userDisplayName(u).toLowerCase().includes(q)) return true;
      if (u.role?.title?.toLowerCase().includes(q)) return true;
      if (u.department?.name?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [users, query]);

  return (
    <>
      <SubHeader title="Space owner" subtitle="Pick the person accountable for this Space. Defaults to you." onClose={onClose} />

      <div className="px-6 pb-2 max-h-[60vh] overflow-y-auto">
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
          <input
            type="text"
            placeholder="Search people…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-9 pl-8 pr-2 rounded-md border border-border bg-surface text-[12.5px] focus:outline-none focus:border-[color:var(--accent)]"
            autoFocus
          />
        </div>

        <button
          type="button"
          onClick={() => onChange(null)}
          className={`w-full text-left rounded-lg px-3 py-2 flex items-center gap-3 transition mb-2 ${
            ownerId === null ? "bg-surface-2" : "hover:bg-surface-2"
          }`}
        >
          <span className="h-7 w-7 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[10px] font-semibold text-muted">
            You
          </span>
          <span className="flex-1 text-[12.5px]">Creator (default)</span>
          {ownerId === null ? <Check className="h-4 w-4" style={{ color: accent }} /> : null}
        </button>

        {loading ? (
          <div className="text-[12px] text-muted py-6 text-center">Loading people…</div>
        ) : filtered.length === 0 ? (
          <div className="text-[12px] text-muted py-6 text-center">
            {query ? `No match for "${query}"` : "No people available"}
          </div>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border">
            {filtered.map((u) => {
              const selected = ownerId === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onChange(u.id)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-3 transition ${
                    selected ? "bg-surface-2" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="h-7 w-7 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[10px] font-semibold uppercase text-muted shrink-0">
                    {(u.firstName?.[0] ?? u.email[0] ?? "?").toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] font-medium truncate">{userDisplayName(u)}</span>
                    <span className="block text-[11px] text-muted truncate">
                      {u.role?.title ?? u.email}
                      {u.department?.name ? ` · ${u.department.name}` : ""}
                    </span>
                  </span>
                  {selected ? <Check className="h-4 w-4 shrink-0" style={{ color: accent }} /> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <SubFooter accent={accent} onDone={onClose} />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-screen: Default views
// ────────────────────────────────────────────────────────────────────

function ViewsSubScreen({
  accent,
  defaultViews,
  defaultViewKey,
  onChange,
  onClose,
}: {
  accent: string;
  defaultViews: ViewKey[];
  defaultViewKey: ViewKey;
  onChange: (views: ViewKey[], defaultKey: ViewKey | null) => void;
  onClose: () => void;
}) {
  const toggle = (k: ViewKey) => {
    const entry = VIEW_CATALOG.find((v) => v.key === k);
    if (!entry || entry.required || !entry.shipped) return;
    if (defaultViews.includes(k)) {
      const nextViews = defaultViews.filter((v) => v !== k);
      const nextDefault = defaultViewKey === k ? nextViews[0] ?? null : defaultViewKey;
      onChange(nextViews, nextDefault);
    } else {
      onChange([...defaultViews, k], defaultViewKey);
    }
  };

  const markDefault = (k: ViewKey) => {
    if (!defaultViews.includes(k)) return;
    onChange(defaultViews, k);
  };

  return (
    <>
      <SubHeader title="Default settings for views" subtitle="Pick which views appear in every Board inside this Space." onClose={onClose} />

      <div className="px-6 pb-2 max-h-[60vh] overflow-y-auto">
        <div className="rounded-lg border border-border divide-y divide-border">
          {VIEW_CATALOG.map((v) => {
            const enabled = defaultViews.includes(v.key);
            const isDefault = defaultViewKey === v.key;
            return (
              <div key={v.key} className="flex items-center gap-3 px-3 py-2.5">
                <span
                  className="h-6 w-6 rounded-md flex items-center justify-center text-white text-[10px] font-semibold"
                  style={{ backgroundColor: v.swatch }}
                >
                  {v.label[0]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium">
                    {v.label}
                    {v.required ? <span className="text-muted ml-1">– Required</span> : null}
                    {!v.shipped ? <span className="text-[10px] uppercase tracking-wide text-muted-2 ml-2">Coming soon</span> : null}
                  </div>
                </div>
                {enabled && !isDefault ? (
                  <button
                    type="button"
                    onClick={() => markDefault(v.key)}
                    className="text-[11px] text-muted hover:text-foreground"
                  >
                    Mark as default
                  </button>
                ) : null}
                {isDefault ? <span className="text-[11px] font-medium" style={{ color: accent }}>Default</span> : null}
                <Toggle
                  value={enabled}
                  onChange={() => toggle(v.key)}
                  accent={accent}
                  disabled={v.required || !v.shipped}
                />
              </div>
            );
          })}
        </div>
      </div>

      <SubFooter accent={accent} onDone={onClose} />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-screen: Task statuses
// ────────────────────────────────────────────────────────────────────

const STATUS_PALETTE = [
  "#71717A", "#6B7280", "#6366F1", "#3B82F6", "#06B6D4", "#10B981",
  "#F59E0B", "#F97316", "#EF4444", "#EC4899", "#A855F7", "#14B8A6",
];

let nextCustomStatusId = 1;
function generateCustomStatusKey(): string {
  return `STATUS_CUSTOM_${nextCustomStatusId++}`;
}

function StatusesSubScreen({
  accent,
  statuses,
  onChange,
  onClose,
}: {
  accent: string;
  statuses: StatusDef[];
  onChange: (statuses: StatusDef[]) => void;
  onClose: () => void;
}) {
  const groups: { id: StatusGroup; label: string; blurb: string }[] = [
    { id: "ACTIVE", label: "Active", blurb: "Work in flight" },
    { id: "DONE", label: "Done", blurb: "Completed" },
    { id: "CLOSED", label: "Closed", blurb: "Won't happen" },
  ];

  const addStatus = (group: StatusGroup) => {
    const key = generateCustomStatusKey();
    onChange([
      ...statuses,
      { key, label: "NEW STATUS", group, color: STATUS_PALETTE[statuses.length % STATUS_PALETTE.length] },
    ]);
  };

  const updateStatus = (key: string, patch: Partial<StatusDef>) => {
    onChange(statuses.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const removeStatus = (key: string) => {
    onChange(statuses.filter((s) => s.key !== key));
  };

  return (
    <>
      <SubHeader title="Edit task statuses" subtitle="Define how work flows from active → done → closed." onClose={onClose} />

      <div className="px-6 pb-2 max-h-[60vh] overflow-y-auto space-y-4">
        {groups.map((group) => {
          const rows = statuses.filter((s) => s.group === group.id);
          return (
            <div key={group.id}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-[12.5px] font-semibold">{group.label}</div>
                  <div className="text-[11px] text-muted">{group.blurb}</div>
                </div>
                <button
                  type="button"
                  onClick={() => addStatus(group.id)}
                  className="h-6 w-6 rounded-md border border-border hover:bg-surface-2 flex items-center justify-center"
                  aria-label={`Add status to ${group.label}`}
                >
                  <Plus className="h-3 w-3 text-muted" />
                </button>
              </div>
              <div className="rounded-lg border border-border divide-y divide-border">
                {rows.map((s) => (
                  <div key={s.key} className="flex items-center gap-2 px-3 py-2">
                    <GripVertical className="h-3.5 w-3.5 text-muted-2 shrink-0" />
                    <ColorSwatch
                      color={s.color}
                      onChange={(color) => updateStatus(s.key, { color })}
                    />
                    <input
                      type="text"
                      value={s.label}
                      onChange={(e) => updateStatus(s.key, { label: e.target.value.toUpperCase() })}
                      className="flex-1 bg-transparent text-[12.5px] font-medium uppercase tracking-wide focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeStatus(s.key)}
                      className="h-6 w-6 rounded-md hover:bg-surface-2 flex items-center justify-center text-muted hover:text-red-500"
                      aria-label="Remove status"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {rows.length === 0 ? (
                  <div className="px-3 py-3 text-[11.5px] text-muted-2">No statuses in this group yet.</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <SubFooter accent={accent} onDone={onClose} doneLabel="Apply changes" />
    </>
  );
}

function ColorSwatch({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-4 w-4 rounded-full border border-white/20 shadow-inner"
        style={{ backgroundColor: color }}
        aria-label="Pick color"
      />
      {open ? (
        <div
          className="absolute left-0 top-6 z-10 rounded-lg border border-border bg-surface p-2 shadow-xl grid grid-cols-6 gap-1"
          onMouseLeave={() => setOpen(false)}
        >
          {STATUS_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className="h-4 w-4 rounded-full hover:scale-110 transition-transform"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-screen: Modules
// ────────────────────────────────────────────────────────────────────

export function ModulesSubScreen({
  accent,
  modules,
  onChange,
  onClose,
}: {
  accent: string;
  modules: ModuleKey[];
  onChange: (modules: ModuleKey[]) => void;
  onClose: () => void;
}) {
  const visible = MODULE_CATALOG.filter((m) => m.shownInWizard);
  const native = visible.filter((m) => m.group === "WORKWRK_NATIVE");
  const pm = visible.filter((m) => m.group === "PROJECT_MGMT");

  const toggle = (k: ModuleKey) => {
    // "Soon" modules aren't toggleable (no backing feature yet).
    if (visible.find((m) => m.key === k)?.soon) return;
    if (modules.includes(k)) onChange(modules.filter((m) => m !== k));
    else onChange([...modules, k]);
  };

  const turnOffAll = modules.length > 0;

  return (
    <>
      <SubHeader title="Enable Modules" subtitle="Each module adds capabilities to this Space. Toggle on / off any time." onClose={onClose} />

      <div className="px-6 pb-2 max-h-[60vh] overflow-y-auto space-y-4">
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div>
            <div className="text-[12.5px] font-semibold">{turnOffAll ? "Turn off all Modules" : "Turn on starter modules"}</div>
            <div className="text-[11px] text-muted">Bulk toggle — you can fine-tune below</div>
          </div>
          <Toggle
            value={turnOffAll}
            onChange={(v) => onChange(v ? visible.filter((m) => !m.soon).map((m) => m.key) : [])}
            accent={accent}
          />
        </label>

        <ModuleGroup title="WorkwrK" entries={native} modules={modules} accent={accent} onToggle={toggle} />
        <ModuleGroup title="Project management" entries={pm} modules={modules} accent={accent} onToggle={toggle} />
      </div>

      <SubFooter accent={accent} onDone={onClose} />
    </>
  );
}

function ModuleGroup({
  title,
  entries,
  modules,
  accent,
  onToggle,
}: {
  title: string;
  entries: typeof MODULE_CATALOG;
  modules: ModuleKey[];
  accent: string;
  onToggle: (k: ModuleKey) => void;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-2 mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        {entries.map((m) => {
          const enabled = modules.includes(m.key) && !m.soon;
          return (
            <button
              key={m.key}
              type="button"
              disabled={m.soon}
              onClick={() => onToggle(m.key)}
              className={`text-left rounded-lg border bg-surface p-3 transition ${m.soon ? "opacity-60 cursor-not-allowed" : "hover:bg-surface-2"}`}
              style={{
                borderColor: enabled ? accent : "var(--border, #e4e4e7)",
                boxShadow: enabled ? `0 0 0 2px ${accent}20` : undefined,
              }}
            >
              <div className="flex items-start gap-2.5">
                <m.Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: m.color }} />
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold flex items-center gap-1.5">
                    {m.label}
                    {m.soon ? (
                      <span className="text-[9px] uppercase tracking-wide text-muted-2 border border-border rounded px-1 leading-4">Soon</span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5 leading-snug">{m.blurb}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Shared sub-screen chrome + small bits
// ────────────────────────────────────────────────────────────────────

function SubHeader({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) {
  return (
    <div className="px-6 pt-6 pb-3 border-b border-border flex items-start gap-3">
      <button
        type="button"
        onClick={onClose}
        className="h-7 w-7 rounded-md hover:bg-surface-2 flex items-center justify-center shrink-0 mt-0.5"
        aria-label="Back"
      >
        <ArrowLeft className="h-4 w-4 text-muted" />
      </button>
      <div className="flex-1">
        <DialogTitle className="text-[16px] font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-1">{subtitle}</DialogDescription>
      </div>
    </div>
  );
}

function SubFooter({
  accent,
  onDone,
  doneLabel = "Done",
}: {
  accent: string;
  onDone: () => void;
  doneLabel?: string;
}) {
  return (
    <div className="px-6 py-4 mt-2 border-t border-border flex justify-end">
      <button
        type="button"
        onClick={onDone}
        className="px-4 py-2 rounded-lg text-[13px] font-medium text-white shadow-sm transition hover:opacity-90"
        style={{ backgroundColor: accent }}
      >
        {doneLabel}
      </button>
    </div>
  );
}

function Toggle({
  value,
  onChange,
  accent,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  accent: string;
  disabled?: boolean;
}) {
  return (
    <span
      role="switch"
      aria-checked={value}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onChange(!value)}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!value);
        }
      }}
      className={`relative inline-flex w-7 h-4 rounded-full transition-colors shrink-0 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
      style={{ backgroundColor: value ? accent : "#d4d4d8" }}
    >
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
          value ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}
