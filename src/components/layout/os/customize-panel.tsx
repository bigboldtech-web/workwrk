"use client";

// CustomizePanel — the ClickUp-style "personalize your interface" modal.
// Four tabs (Navigation / Home / Sections / Themes) that read and write
// the user's UserPreference row via /api/preferences. Org-level locked
// keys (OrgPreference.lockedKeys) disable their controls so the user
// can't override what admin has frozen.
//
// Design rules from the 2026-06-02 screenshots:
//   - Whitespace > color. One accent (mint). No hue-keyed chrome.
//   - Items: icon + label, flat hover background, no badges/dots.
//   - Modal layout: header → tabs row → content block. Save is silent.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Home as HomeIcon,
  Inbox,
  MessageSquare,
  CheckSquare,
  Send,
  Globe,
  ListTodo,
  Calendar as CalendarIcon,
  Sparkles,
  Users,
  FileText,
  BarChart3,
  Brush,
  ClipboardCheck,
  Video,
  Trophy,
  Clock,
  PanelsLeftBottom,
  Layers,
  Star,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type {
  EffectivePreferences,
  SidebarPref,
  HomePref,
  ThemePref,
  DensityPref,
} from "@/lib/preferences";

/* ─────────────── Catalog: nav + home + section keys ─────────────── */

// Matches the screenshots — every key here is a nav surface the user
// can toggle. Order is the default order; user can reorder via the
// "Sections" tab or future drag-reorder in the sidebar itself.
const NAV_ITEMS: Array<{ key: string; label: string; Icon: React.ComponentType<{ className?: string }>; alwaysOn?: boolean }> = [
  { key: "home",        label: "Home",        Icon: HomeIcon, alwaysOn: true },
  { key: "spaces",      label: "Spaces",      Icon: Layers },
  { key: "planner",     label: "Planner",     Icon: CalendarIcon },
  { key: "ai",          label: "AI",          Icon: Sparkles },
  { key: "teams",       label: "Teams",       Icon: Users },
  { key: "docs",        label: "Docs",        Icon: FileText },
  { key: "dashboards",  label: "Dashboards",  Icon: BarChart3 },
  { key: "whiteboards", label: "Whiteboards", Icon: Brush },
  { key: "forms",       label: "Forms",       Icon: ClipboardCheck },
  { key: "clips",       label: "Clips",       Icon: Video },
  { key: "goals",       label: "Goals",       Icon: Trophy },
  { key: "timesheets",  label: "Timesheets",  Icon: Clock },
];

const HOME_CARDS: Array<{ key: string; label: string; Icon: React.ComponentType<{ className?: string }>; alwaysOn?: boolean }> = [
  { key: "inbox",             label: "Inbox",             Icon: Inbox, alwaysOn: true },
  { key: "assigned-comments", label: "Assigned Comments", Icon: MessageSquare },
  { key: "my-tasks",          label: "My Tasks",          Icon: CheckSquare },
  { key: "drafts-sent",       label: "Drafts & Sent",     Icon: Send },
  { key: "all-spaces",        label: "All Spaces",        Icon: Globe },
  { key: "all-tasks",         label: "All Tasks",         Icon: ListTodo },
];

const SECTION_OPTIONS: Array<{ key: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { key: "favorites", label: "Favorites", Icon: Star },
  { key: "spaces",    label: "Spaces",    Icon: Layers },
];

const ACCENT_OPTIONS: Array<{ key: string; label: string; swatch: string }> = [
  { key: "black",  label: "Black",  swatch: "#1f2024" },
  { key: "purple", label: "Purple", swatch: "#7c3aed" },
  { key: "blue",   label: "Blue",   swatch: "#3b82f6" },
  { key: "pink",   label: "Pink",   swatch: "#ec4899" },
  { key: "violet", label: "Violet", swatch: "#a855f7" },
  { key: "indigo", label: "Indigo", swatch: "#6366f1" },
  { key: "orange", label: "Orange", swatch: "#f59e0b" },
  { key: "teal",   label: "Teal",   swatch: "#14b8a6" },
  { key: "bronze", label: "Bronze", swatch: "#a78b6c" },
  { key: "mint",   label: "Mint",   swatch: "#3ab39e" },
];

/* ─────────────── Hook: read + patch /api/preferences ─────────────── */

function useCustomizePrefs() {
  const [effective, setEffective] = useState<EffectivePreferences | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/preferences", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { effective: EffectivePreferences };
      setEffective(data.effective);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patch = useCallback(
    async (body: {
      sidebar?: Partial<SidebarPref>;
      home?: Partial<HomePref>;
      theme?: Partial<ThemePref>;
      density?: DensityPref;
    }) => {
      // Optimistic update so the UI snaps; reconcile on response.
      setEffective((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sidebar: { ...prev.sidebar, ...(body.sidebar ?? {}) },
          home: { ...prev.home, ...(body.home ?? {}) },
          theme: { ...prev.theme, ...(body.theme ?? {}) },
          density: body.density ?? prev.density,
        };
      });
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // On failure, reload truth from server.
        void reload();
        return;
      }
      const data = (await res.json()) as { effective: EffectivePreferences };
      setEffective(data.effective);
      // Notify ThemeApplier (and any other listeners) so they re-fetch
      // their copy of effective preferences and re-apply.
      window.dispatchEvent(new CustomEvent("workwrk:prefs-changed"));
    },
    [reload],
  );

  return { effective, loading, patch };
}

/* ─────────────── Subcomponents ─────────────── */

function CheckRow({
  Icon,
  label,
  checked,
  disabled,
  locked,
  onChange,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  checked: boolean;
  disabled?: boolean;
  locked?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`group flex items-center gap-3 px-2 py-1.5 rounded-md ${
        disabled || locked ? "opacity-50 cursor-not-allowed" : "hover:bg-surface-2 cursor-pointer"
      }`}
    >
      <span
        className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded border ${
          checked
            ? "bg-[var(--os-brand)] border-[var(--os-brand)] text-white"
            : "border-border text-transparent"
        }`}
        aria-hidden
      >
        <Check className="w-3 h-3" />
      </span>
      <Icon className="w-[18px] h-[18px] text-muted" />
      <span className="text-sm flex-1">{label}</span>
      {locked ? (
        <span className="text-[10px] uppercase tracking-wide text-muted">Locked</span>
      ) : null}
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled || locked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function AppearanceToggle({
  iconsOnly,
  onChange,
  locked,
}: {
  iconsOnly: boolean;
  onChange: (v: boolean) => void;
  locked?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 mt-2">
      {[
        { value: true,  label: "Icons only" },
        { value: false, label: "Icons & Labels" },
      ].map((opt) => {
        const active = iconsOnly === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            disabled={locked}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-4 rounded-lg border text-left transition-colors ${
              active
                ? "border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_8%,transparent)]"
                : "border-border hover:border-[var(--os-brand-soft,var(--os-brand))]"
            } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <PanelsLeftBottom className="w-5 h-5 text-muted mb-2" />
            <div className="text-sm">{opt.label}</div>
          </button>
        );
      })}
    </div>
  );
}

function ThemeAppearancePicker({
  value,
  onChange,
  locked,
}: {
  value: "LIGHT" | "DARK" | "AUTO";
  onChange: (v: "LIGHT" | "DARK" | "AUTO") => void;
  locked?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { value: "LIGHT", label: "Light" },
        { value: "DARK",  label: "Dark"  },
        { value: "AUTO",  label: "Auto"  },
      ].map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={locked}
            onClick={() => onChange(opt.value as "LIGHT" | "DARK" | "AUTO")}
            className={`px-3 py-4 rounded-lg border text-left transition-colors ${
              active
                ? "border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_8%,transparent)]"
                : "border-border hover:border-[var(--os-brand-soft,var(--os-brand))]"
            } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <div
              className={`w-full h-12 rounded mb-2 ${
                opt.value === "LIGHT" ? "bg-white border border-border" :
                opt.value === "DARK"  ? "bg-[#1f2024]" :
                "bg-gradient-to-r from-white to-[#1f2024]"
              }`}
              aria-hidden
            />
            <div className="text-sm">{opt.label}</div>
          </button>
        );
      })}
    </div>
  );
}

function AccentPicker({
  value,
  onChange,
  locked,
}: {
  value: string;
  onChange: (v: string) => void;
  locked?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ACCENT_OPTIONS.map((a) => {
        const active = value === a.key;
        return (
          <button
            key={a.key}
            type="button"
            disabled={locked}
            onClick={() => onChange(a.key)}
            className={`flex items-center gap-2 px-3 py-2 rounded-md border text-left ${
              active
                ? "border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_8%,transparent)]"
                : "border-border hover:bg-surface-2"
            } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span className="w-4 h-4 rounded-sm" style={{ background: a.swatch }} />
            <span className="text-sm">{a.label}</span>
            {active ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function SectionRow({
  Icon,
  label,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-surface mb-2">
      <span className="text-muted">⋮⋮</span>
      <Icon className="w-[18px] h-[18px] text-muted" />
      <span className="text-sm flex-1">{label}</span>
      <button
        type="button"
        className="text-xs text-muted px-2 py-1 rounded hover:bg-surface-2 disabled:opacity-40"
        disabled={!canMoveUp}
        onClick={onMoveUp}
      >
        ↑
      </button>
      <button
        type="button"
        className="text-xs text-muted px-2 py-1 rounded hover:bg-surface-2 disabled:opacity-40"
        disabled={!canMoveDown}
        onClick={onMoveDown}
      >
        ↓
      </button>
    </div>
  );
}

/* ─────────────── Main component ─────────────── */

export function CustomizePanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { effective, loading, patch } = useCustomizePrefs();

  const lockedSet = useMemo(
    () => new Set(effective?.lockedKeys ?? []),
    [effective?.lockedKeys],
  );

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] p-0 gap-0">
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold">Customize</DialogTitle>
          <DialogDescription className="text-xs text-muted mt-1">
            Personalize and organize your WorkwrK interface
          </DialogDescription>
        </div>

        {loading || !effective ? (
          <div className="px-5 pb-6 text-sm text-muted">Loading…</div>
        ) : (
          <Tabs defaultValue="navigation" className="w-full">
            <div className="px-5 pb-3">
              <TabsList className="w-full">
                <TabsTrigger value="navigation" className="flex-1">Navigation</TabsTrigger>
                <TabsTrigger value="home" className="flex-1">Home</TabsTrigger>
                <TabsTrigger value="sections" className="flex-1">Sections</TabsTrigger>
                <TabsTrigger value="themes" className="flex-1">Themes</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="navigation" className="px-3 pb-5 max-h-[60vh] overflow-y-auto">
              <div className="flex flex-col">
                {NAV_ITEMS.map((it) => {
                  const hidden = effective.sidebar.hidden.includes(it.key);
                  const checked = !hidden;
                  return (
                    <CheckRow
                      key={it.key}
                      Icon={it.Icon}
                      label={it.label}
                      checked={checked}
                      disabled={it.alwaysOn}
                      locked={lockedSet.has(`sidebar.hidden.${it.key}`)}
                      onChange={(next) => {
                        const hiddenSet = new Set(effective.sidebar.hidden);
                        if (next) hiddenSet.delete(it.key);
                        else hiddenSet.add(it.key);
                        void patch({ sidebar: { hidden: Array.from(hiddenSet) } });
                      }}
                    />
                  );
                })}
              </div>
              <div className="border-t border-border my-4" />
              <div className="px-2">
                <h3 className="text-sm font-medium mb-2">Appearance</h3>
                <AppearanceToggle
                  iconsOnly={effective.sidebar.iconsOnly}
                  locked={lockedSet.has("sidebar.iconsOnly")}
                  onChange={(v) => void patch({ sidebar: { iconsOnly: v } })}
                />
              </div>
            </TabsContent>

            <TabsContent value="home" className="px-3 pb-5 max-h-[60vh] overflow-y-auto">
              <div className="flex flex-col">
                {HOME_CARDS.map((c) => {
                  const checked = effective.home.cards.includes(c.key);
                  return (
                    <CheckRow
                      key={c.key}
                      Icon={c.Icon}
                      label={c.label}
                      checked={checked}
                      disabled={c.alwaysOn}
                      locked={lockedSet.has(`home.cards.${c.key}`)}
                      onChange={(next) => {
                        const set = new Set(effective.home.cards);
                        if (next) set.add(c.key);
                        else set.delete(c.key);
                        void patch({ home: { cards: Array.from(set) } });
                      }}
                    />
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="sections" className="px-5 pb-5 max-h-[60vh] overflow-y-auto">
              <div className="flex flex-col">
                {effective.sidebar.sectionsOrder.map((key, idx) => {
                  const opt = SECTION_OPTIONS.find((s) => s.key === key);
                  if (!opt) return null;
                  const order = effective.sidebar.sectionsOrder;
                  return (
                    <SectionRow
                      key={key}
                      Icon={opt.Icon}
                      label={opt.label}
                      canMoveUp={idx > 0}
                      canMoveDown={idx < order.length - 1}
                      onMoveUp={() => {
                        const next = [...order];
                        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                        void patch({ sidebar: { sectionsOrder: next } });
                      }}
                      onMoveDown={() => {
                        const next = [...order];
                        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                        void patch({ sidebar: { sectionsOrder: next } });
                      }}
                    />
                  );
                })}
              </div>
              <div className="border-t border-border my-3" />
              <div className="text-xs text-muted">
                Hidden sections
                <div className="mt-1">
                  {SECTION_OPTIONS.filter((s) => !effective.sidebar.sectionsOrder.includes(s.key)).length === 0
                    ? "All sections shown"
                    : "Some sections hidden"}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="themes" className="px-5 pb-5 max-h-[60vh] overflow-y-auto">
              <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Appearance</h3>
              <ThemeAppearancePicker
                value={effective.theme.appearance}
                locked={lockedSet.has("theme.appearance")}
                onChange={(v) => void patch({ theme: { appearance: v } })}
              />
              <div className="border-t border-border my-4" />
              <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Accent</h3>
              <AccentPicker
                value={effective.theme.accent}
                locked={lockedSet.has("theme.accent")}
                onChange={(v) => void patch({ theme: { accent: v } })}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
