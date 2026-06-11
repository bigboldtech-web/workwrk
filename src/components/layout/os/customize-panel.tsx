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
  Check, X, GripVertical, Plus, EyeOff, Eye,
  Inbox, MessageSquare, CheckSquare, Send, Globe, ListTodo,
  Layers, Star,
} from "lucide-react";
import { CATALOG_APPS, isAlwaysPinned } from "./apps-catalog";
import { useOsShell } from "./shell-context";
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

/* ─────────────── Catalog: home + section keys ─────────────── */

// The Navigation tab pulls its app list from CATALOG_APPS in
// apps-catalog.tsx — same source of truth the rail uses for pinning.

const HOME_CARDS: Array<{ key: string; label: string; Icon: React.ComponentType<{ className?: string }>; alwaysOn?: boolean }> = [
  { key: "inbox",             label: "Inbox",             Icon: Inbox, alwaysOn: true },
  { key: "assigned-comments", label: "Assigned Comments", Icon: MessageSquare },
  { key: "my-tasks",          label: "My Wrk",          Icon: CheckSquare },
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
      className={`group flex items-center gap-2 px-2 py-0.5 rounded-md transition-colors ${
        disabled || locked ? "opacity-60 cursor-not-allowed" : "hover:bg-zinc-50 cursor-pointer"
      }`}
    >
      <span
        className={`inline-flex items-center justify-center w-[16px] h-[16px] rounded border-[1.5px] transition-colors ${
          checked
            ? "bg-[var(--os-brand)] border-[var(--os-brand)] text-white"
            : "bg-white border-zinc-300 text-transparent"
        }`}
        aria-hidden
      >
        <Check className="w-2.5 h-2.5" strokeWidth={3.5} />
      </span>
      <Icon className="w-[14px] h-[14px] text-zinc-500" />
      <span className="text-[12px] text-zinc-800 flex-1">{label}</span>
      {locked ? (
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Locked</span>
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

/** Mini rail illustration: a column of icon-sized rectangles. Drives the
 *  appearance cards in the Navigation tab so the user can see what the
 *  rail will look like before committing. */
function AppearancePreview({ iconsOnly }: { iconsOnly: boolean }) {
  // Match the ShellPreview proportions so the two appearance pickers
  // (Nav-tab "Icons only / Icons & Labels" and Themes-tab "Light/Dark/Auto")
  // read as the same shell from a distance — same rail, sidebar, canvas.
  const railW = iconsOnly ? 10 : 18;
  const sbX = 2 + railW + 2;
  const sbW = 24;
  const cvX = sbX + sbW + 2;
  return (
    <svg viewBox="0 0 120 68" className="w-full h-[48px]" aria-hidden role="img">
      <rect x="0" y="0" width="120" height="68" rx="6" fill="#F4F4F5" />
      {/* Rail */}
      <rect
        x="2"
        y="2"
        width={railW}
        height="64"
        rx="3"
        fill="var(--os-brand-rail)"
      />
      {/* Rail icons (5 dots, evenly spaced) */}
      {[8, 19, 30, 41, 52].map((y) => (
        <g key={y}>
          <rect
            x={2 + (railW - 5) / 2}
            y={y}
            width="5"
            height="5"
            rx="1"
            fill="rgba(255,255,255,0.92)"
          />
          {!iconsOnly ? (
            <rect
              x={2 + (railW - 7) / 2}
              y={y + 6}
              width="7"
              height="0.8"
              rx="0.3"
              fill="rgba(255,255,255,0.6)"
            />
          ) : null}
        </g>
      ))}
      {/* Secondary sidebar */}
      <rect x={sbX} y="2" width={sbW} height="64" rx="2" fill="#FFFFFF" stroke="#E4E4E7" strokeWidth="0.5" />
      <rect x={sbX + 3} y="6" width="13" height="1.6" rx="0.4" fill="#3F3F46" />
      {[12, 19, 26, 33, 40, 47, 54, 61].map((y) => (
        <rect key={`s-${y}`} x={sbX + 3} y={y} width={y % 14 === 0 ? 16 : 13} height="1.4" rx="0.3" fill="#D4D4D8" />
      ))}
      {/* Canvas — with two fake task tiles so the card reads as "an app"
          and not just empty space. */}
      <rect x={cvX} y="2" width={120 - cvX - 2} height="64" rx="2" fill="#FFFFFF" stroke="#E4E4E7" strokeWidth="0.5" />
      <rect x={cvX + 3} y="6" width="40" height="2" rx="0.5" fill="#27272A" />
      <rect x={cvX + 3} y="13" width={120 - cvX - 8} height="14" rx="2" fill="#FAFAFA" stroke="#E4E4E7" strokeWidth="0.4" />
      <rect x={cvX + 6} y="17" width="20" height="1.6" rx="0.4" fill="#52525B" />
      <rect x={cvX + 6} y="21" width="32" height="1.2" rx="0.3" fill="#D4D4D8" />
      <rect x={cvX + 3} y="30" width={120 - cvX - 8} height="14" rx="2" fill="#FAFAFA" stroke="#E4E4E7" strokeWidth="0.4" />
      <rect x={cvX + 6} y="34" width="24" height="1.6" rx="0.4" fill="#52525B" />
      <rect x={cvX + 6} y="38" width="28" height="1.2" rx="0.3" fill="#D4D4D8" />
      <circle cx={cvX + (120 - cvX - 8) - 4} cy="20" r="1.8" fill="var(--os-brand)" />
      <circle cx={cvX + (120 - cvX - 8) - 4} cy="37" r="1.8" fill="#A1A1AA" />
    </svg>
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
    <div className="grid grid-cols-2 gap-3">
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
            className={`p-2 rounded-lg border-[1.5px] text-left transition-all ${
              active
                ? "border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_6%,transparent)]"
                : "border-zinc-200 hover:border-zinc-300"
            } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <AppearancePreview iconsOnly={opt.value} />
            <div className="text-[12px] mt-1.5 font-medium text-zinc-800">{opt.label}</div>
          </button>
        );
      })}
    </div>
  );
}

/** Mini OS-shell illustration used inside the Light/Dark/Auto cards.
 *  Shows a rail (brand-rail color), a secondary sidebar, and a canvas
 *  panel populated with fake task tiles — so the user sees the actual
 *  theme applied to a tiny replica of their app, not just empty bands. */
function ShellPreview({ mode }: { mode: "LIGHT" | "DARK" | "AUTO" }) {
  const isDark = mode === "DARK";
  const split = mode === "AUTO";
  // Token set per mode. AUTO uses a vertical gradient so both halves
  // render their respective surfaces — the rail stays brand on both.
  const tokens = isDark
    ? { bg: "#0F1115", sb: "#181B22", card: "#1E222B", border: "#2A2F38", primary: "#E5E7EB", muted: "#6B7280" }
    : { bg: "#FFFFFF", sb: "#FAFAFA", card: "#FFFFFF", border: "#E4E4E7", primary: "#27272A", muted: "#D4D4D8" };
  return (
    <svg viewBox="0 0 120 68" className="w-full h-[48px]" aria-hidden role="img">
      <defs>
        {split ? (
          <linearGradient id="autoGrad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="50%" stopColor="#FFFFFF" />
            <stop offset="50%" stopColor="#0F1115" />
          </linearGradient>
        ) : null}
      </defs>
      <rect x="0" y="0" width="120" height="68" rx="6" fill={split ? "url(#autoGrad)" : tokens.bg} />
      {/* Rail — always brand-rail */}
      <rect x="2" y="2" width="10" height="64" rx="3" fill="var(--os-brand-rail)" />
      {[8, 19, 30, 41, 52].map((y) => (
        <rect key={y} x="4.5" y={y} width="5" height="5" rx="1" fill="rgba(255,255,255,0.92)" />
      ))}
      {/* Secondary sidebar */}
      <rect
        x="14"
        y="2"
        width="24"
        height="64"
        rx="2"
        fill={split ? "rgba(0,0,0,0)" : tokens.sb}
        stroke={tokens.border}
        strokeWidth="0.4"
      />
      <rect x="17" y="6" width="13" height="1.6" rx="0.4" fill={tokens.primary} />
      {[12, 19, 26, 33, 40, 47, 54, 61].map((y) => (
        <rect key={`s-${y}`} x="17" y={y} width="14" height="1.4" rx="0.3" fill={tokens.muted} />
      ))}
      {/* Canvas with two fake task tiles */}
      <rect
        x="40"
        y="2"
        width="78"
        height="64"
        rx="2"
        fill={split ? "rgba(0,0,0,0)" : tokens.bg}
        stroke={tokens.border}
        strokeWidth="0.4"
      />
      <rect x="43" y="6" width="40" height="2" rx="0.5" fill={tokens.primary} />
      <rect x="43" y="13" width="72" height="14" rx="2" fill={tokens.card} stroke={tokens.border} strokeWidth="0.4" />
      <rect x="46" y="17" width="20" height="1.6" rx="0.4" fill={tokens.primary} />
      <rect x="46" y="21" width="32" height="1.2" rx="0.3" fill={tokens.muted} />
      <circle cx="111" cy="20" r="1.8" fill="var(--os-brand)" />
      <rect x="43" y="30" width="72" height="14" rx="2" fill={tokens.card} stroke={tokens.border} strokeWidth="0.4" />
      <rect x="46" y="34" width="24" height="1.6" rx="0.4" fill={tokens.primary} />
      <rect x="46" y="38" width="28" height="1.2" rx="0.3" fill={tokens.muted} />
      <circle cx="111" cy="37" r="1.8" fill={tokens.muted} />
    </svg>
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
    <div className="grid grid-cols-3 gap-2">
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
            className={`p-1.5 rounded-lg border text-left transition-all ${
              active
                ? "border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_6%,transparent)]"
                : "border-zinc-200 hover:border-zinc-300"
            } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <ShellPreview mode={opt.value as "LIGHT" | "DARK" | "AUTO"} />
            <div className="text-[12px] mt-1.5 font-medium text-zinc-800">{opt.label}</div>
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
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors ${
              active
                ? "border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_10%,transparent)]"
                : "border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300"
            } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {/* Active: small accent chip with the check inside (ClickUp
                pattern). Inactive: just the swatch dot. */}
            {active ? (
              <span
                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                style={{ background: a.swatch, color: "#fff" }}
              >
                <Check className="w-3 h-3" strokeWidth={3.5} />
              </span>
            ) : (
              <span
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ background: a.swatch }}
              />
            )}
            <span className="text-[12.5px] text-zinc-800 font-medium truncate">{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SectionRow({
  Icon,
  label,
  onHide,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dragging,
  dropIndicator,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  onHide: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  dragging: boolean;
  dropIndicator: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
      className={`relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border bg-white mb-1.5 transition ${
        dragging ? "opacity-40" : "border-zinc-200 hover:border-zinc-300"
      } cursor-grab active:cursor-grabbing`}
    >
      {dropIndicator ? (
        <div aria-hidden className="absolute -top-1 left-2 right-2 h-0.5 rounded bg-[var(--os-brand)]" />
      ) : null}
      <GripVertical className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
      <Icon className="w-4 h-4 text-zinc-500 flex-shrink-0" />
      <span className="text-[12.5px] flex-1 text-zinc-800">{label}</span>
      <button
        type="button"
        onClick={onHide}
        className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
        aria-label={`Hide ${label}`}
        title={`Hide ${label}`}
      >
        <EyeOff className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function HiddenSectionRow({
  Icon,
  label,
  onShow,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  onShow: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md bg-zinc-50 mb-1.5">
      <Icon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
      <span className="text-[12px] flex-1 text-zinc-500">{label}</span>
      <button
        type="button"
        onClick={onShow}
        className="text-[11px] font-medium px-2 py-0.5 rounded text-zinc-700 hover:bg-zinc-200"
      >
        <span className="flex items-center gap-1">
          <Eye className="w-3 h-3" />
          Show
        </span>
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
  const { iconsOnly: railIconsOnly, setIconsOnly } = useOsShell();

  // ── Sections drag state ──────────────────────────────────────
  const [sectionDragKey, setSectionDragKey] = useState<string | null>(null);
  const [sectionDropKey, setSectionDropKey] = useState<string | null>(null);

  const lockedSet = useMemo(
    () => new Set(effective?.lockedKeys ?? []),
    [effective?.lockedKeys],
  );

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] p-0 gap-0 overflow-hidden rounded-xl shadow-xl [&>button:has(>span.sr-only)]:hidden">
        {/* Header with X close button. The default DialogContent ships
            its own Close button — ours sits in the same spot but uses the
            larger ClickUp-style chip, so we hide the built-in one via the
            wrapper's CSS (Radix's Close still works through Escape). */}
        <div className="px-4 pt-3 pb-2 relative">
          <DialogTitle className="text-[14px] font-semibold text-zinc-900 leading-tight">Customize</DialogTitle>
          <DialogDescription className="text-[11.5px] text-zinc-500 mt-0.5">
            Personalize and organize your WorkwrK interface
          </DialogDescription>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute top-2.5 right-3 w-5 h-5 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        <Tabs defaultValue="navigation" className="w-full">
          {/* Pill-style segmented tabs (matches ClickUp ref) */}
          <div className="px-4 pb-2">
            <TabsList className="w-full bg-zinc-100 p-0.5 rounded-lg h-7">
              <TabsTrigger value="navigation" className="flex-1 rounded-md text-[11.5px] font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-zinc-900 text-zinc-600">Navigation</TabsTrigger>
              <TabsTrigger value="home" className="flex-1 rounded-md text-[11.5px] font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-zinc-900 text-zinc-600">Home</TabsTrigger>
              <TabsTrigger value="sections" className="flex-1 rounded-md text-[11.5px] font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-zinc-900 text-zinc-600">Sections</TabsTrigger>
              <TabsTrigger value="themes" className="flex-1 rounded-md text-[11.5px] font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-zinc-900 text-zinc-600">Themes</TabsTrigger>
            </TabsList>
          </div>

          {/* Navigation tab is fully driven by shell-context (localStorage),
              so it works even when /api/preferences is unavailable. By
              default it shows just the Core apps (the dense ClickUp
              layout); the "Show more apps" toggle reveals the full
              catalog if the user wants to pin one of the extras. */}
          <TabsContent value="navigation" className="px-3 pb-3 max-h-[66vh] overflow-y-auto">
            <NavigationList />
            <div className="border-t border-zinc-200 my-3 mx-2" />
            <div className="px-2">
              <h3 className="text-[12px] font-medium text-zinc-600 mb-2">Appearance</h3>
              <AppearanceToggle
                iconsOnly={railIconsOnly}
                onChange={(v) => {
                  // Update local state immediately, persist to the server
                  // in the background so the choice syncs across devices.
                  setIconsOnly(v);
                  void patch({ sidebar: { iconsOnly: v } });
                }}
              />
            </div>
          </TabsContent>

          {/* Home / Sections / Themes need /api/preferences. Show a small
              inline notice if the fetch is still pending or failed. */}
          <TabsContent value="home" className="px-3 pb-3 max-h-[66vh] overflow-y-auto">
            {loading ? (
              <div className="px-2 py-4 text-sm text-zinc-500">Loading…</div>
            ) : !effective ? (
              <PrefsUnavailable />
            ) : (
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
            )}
          </TabsContent>

          <TabsContent value="sections" className="px-4 pb-3 max-h-[66vh] overflow-y-auto">
            {loading ? (
              <div className="px-2 py-4 text-sm text-zinc-500">Loading…</div>
            ) : !effective ? (
              <PrefsUnavailable />
            ) : (
              <>
                <div className="flex flex-col">
                  {effective.sidebar.sectionsOrder.map((key) => {
                    const opt = SECTION_OPTIONS.find((s) => s.key === key);
                    if (!opt) return null;
                    const order = effective.sidebar.sectionsOrder;
                    return (
                      <SectionRow
                        key={key}
                        Icon={opt.Icon}
                        label={opt.label}
                        dragging={sectionDragKey === key}
                        dropIndicator={sectionDropKey === key && sectionDragKey !== null && sectionDragKey !== key}
                        onDragStart={() => setSectionDragKey(key)}
                        onDragOver={() => { if (sectionDragKey && sectionDragKey !== key) setSectionDropKey(key); }}
                        onDrop={() => {
                          if (!sectionDragKey || sectionDragKey === key) {
                            setSectionDragKey(null);
                            setSectionDropKey(null);
                            return;
                          }
                          const next = [...order];
                          const fromIdx = next.indexOf(sectionDragKey);
                          const toIdx = next.indexOf(key);
                          if (fromIdx === -1 || toIdx === -1) {
                            setSectionDragKey(null);
                            setSectionDropKey(null);
                            return;
                          }
                          next.splice(fromIdx, 1);
                          next.splice(toIdx, 0, sectionDragKey);
                          void patch({ sidebar: { sectionsOrder: next } });
                          setSectionDragKey(null);
                          setSectionDropKey(null);
                        }}
                        onDragEnd={() => {
                          setSectionDragKey(null);
                          setSectionDropKey(null);
                        }}
                        onHide={() => {
                          const next = order.filter((k) => k !== key);
                          void patch({ sidebar: { sectionsOrder: next } });
                        }}
                      />
                    );
                  })}
                </div>

                {/* Add (placeholder) — custom sections is a larger feature.
                    For now the button is here for visual parity with the ref. */}
                <button
                  type="button"
                  disabled
                  title="Custom sections coming soon"
                  className="w-full flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-md border border-dashed border-zinc-300 text-[12px] text-zinc-500 hover:bg-zinc-50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create section
                </button>

                {(() => {
                  const hidden = SECTION_OPTIONS.filter(
                    (s) => !effective.sidebar.sectionsOrder.includes(s.key),
                  );
                  return (
                    <>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mt-5 mb-2">
                        Hidden sections
                      </div>
                      {hidden.length === 0 ? (
                        <div className="text-[12px] text-zinc-400 px-2">All sections shown</div>
                      ) : (
                        hidden.map((s) => (
                          <HiddenSectionRow
                            key={s.key}
                            Icon={s.Icon}
                            label={s.label}
                            onShow={() => {
                              const next = [...effective.sidebar.sectionsOrder, s.key];
                              void patch({ sidebar: { sectionsOrder: next } });
                            }}
                          />
                        ))
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </TabsContent>

          <TabsContent value="themes" className="px-4 pb-3 max-h-[66vh] overflow-y-auto">
            {loading ? (
              <div className="px-2 py-4 text-sm text-zinc-500">Loading…</div>
            ) : !effective ? (
              <PrefsUnavailable />
            ) : (
              <>
                <h3 className="text-[12px] font-medium text-zinc-600 mb-2">Appearance</h3>
                <ThemeAppearancePicker
                  value={effective.theme.appearance}
                  locked={lockedSet.has("theme.appearance")}
                  onChange={(v) => void patch({ theme: { appearance: v } })}
                />
                <div className="h-3" />
                <h3 className="text-[12px] font-medium text-zinc-600 mb-2">WorkwrK theme</h3>
                <AccentPicker
                  value={effective.theme.accent}
                  locked={lockedSet.has("theme.accent")}
                  onChange={(v) => void patch({ theme: { accent: v } })}
                />
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* Navigation tab list — Core apps by default, full catalog behind an
 * expander. Keeps the dialog visually tight (ClickUp matches this) but
 * still lets users reach the full 38-app catalog without leaving the
 * customize panel. */
function NavigationList() {
  const { pinnedAppKeys, togglePinned } = useOsShell();
  const [showAll, setShowAll] = useState(false);
  const coreApps = CATALOG_APPS.filter((a) => a.category === "Core");
  const extras = CATALOG_APPS.filter((a) => a.category !== "Core");
  const apps = showAll ? CATALOG_APPS : coreApps;
  return (
    <div className="flex flex-col">
      {apps.map((app) => {
        const checked = pinnedAppKeys.includes(app.key);
        const always = isAlwaysPinned(app.key);
        return (
          <CheckRow
            key={app.key}
            Icon={app.Icon}
            label={app.label.replace(/\.\.$/, "")}
            checked={checked || always}
            disabled={always}
            onChange={() => { if (!always) togglePinned(app.key); }}
          />
        );
      })}
      {extras.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1 px-2 py-1.5 text-[12px] font-medium text-left text-zinc-500 hover:text-zinc-800"
        >
          {showAll ? "Show fewer" : `Show ${extras.length} more apps`}
        </button>
      ) : null}
    </div>
  );
}

function PrefsUnavailable() {
  return (
    <div className="px-3 py-6 text-xs text-zinc-500 leading-relaxed">
      Couldn&apos;t load your saved preferences from the server. The Navigation
      tab still works — your pin changes save locally. Try reloading the
      page if this persists.
    </div>
  );
}
