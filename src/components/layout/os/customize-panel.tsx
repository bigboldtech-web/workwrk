"use client";

// CustomizePanel (spec-shell 2.16): make the sidebar and the look yours. A
// 560 Radix dialog, header 56 with a title, a one-line description and a
// close; no footer, because every control writes immediately through
// PATCH /api/preferences and shows an inline "Saved" tick that fades. Body:
// three settings rows (Theme, Chrome, Density as segmented controls, each
// greyed with a lock when the workspace locked the key) and a SIDEBAR
// SECTIONS card listing the Work hub's sections with a switch and Move up /
// Move down. No accents, no icons-only, no Home cards tab, no coming-soon
// "Create section" row. The founder's "Customize Sidebar" footer button is
// the door.

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { SETTINGS_PAGES, settingsHrefToday } from "@/lib/settings-registry";
import { CHROME_CONTROL_EXPOSED } from "@/lib/nav/labels";
import type { DensityPref } from "@/lib/preferences";
import { useLayer, useOsShell } from "./shell-context";
import { useOsToast } from "./toast";

type Appearance = "LIGHT" | "DARK" | "AUTO";
type Chrome = "navy" | "light";

/** The Work hub's optional sections (the personal block is required and never listed). */
const SECTIONS: Array<{ key: string; label: string }> = [
  { key: "favorites", label: "Favorites" },
  { key: "spaces", label: "Spaces" },
];

function SavedTick({ at }: { at: number }) {
  // Shown from the moment of the save until 2s later.
  const [hiddenAt, setHiddenAt] = useState(0);
  useEffect(() => {
    if (!at) return;
    const t = window.setTimeout(() => setHiddenAt(at), 2000);
    return () => window.clearTimeout(t);
  }, [at]);
  const show = at > 0 && hiddenAt < at;
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-success-text" role="status">
      <Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Saved
    </span>
  );
}

function Row({ label, hint, children, savedAt }: { label: string; hint?: string; children: React.ReactNode; savedAt: number }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-line-soft py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="text-base font-medium text-ink">{label}</div>
        {hint ? <div className="text-sm text-ink-2">{hint}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <SavedTick at={savedAt} />
        {children}
      </div>
    </div>
  );
}

export function CustomizePanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { prefs, patchPrefs, closeTopLayer } = useOsShell();
  const { toast } = useOsToast();
  const { openSettings } = useSettingsNav();
  const [saved, setSaved] = useState<Record<string, number>>({});
  const closeRef = useRef(onOpenChange);
  useEffect(() => { closeRef.current = onOpenChange; }, [onOpenChange]);
  useLayer(open, { id: "customize-panel", kind: "dialog", close: () => closeRef.current(false) });

  const locked = new Set(prefs.lockedKeys ?? []);
  const appearance: Appearance = prefs.theme.appearance ?? "LIGHT";
  const chrome: Chrome = prefs.theme.chrome ?? "navy";
  const density: DensityPref = prefs.density ?? "comfortable";
  const order = prefs.sidebar.sectionsOrder?.length ? prefs.sidebar.sectionsOrder : SECTIONS.map((s) => s.key);
  const hidden = new Set(prefs.sidebar.hiddenSections ?? []);
  const visibleOrder = [...order.filter((k) => SECTIONS.some((s) => s.key === k)), ...SECTIONS.map((s) => s.key).filter((k) => !order.includes(k))];

  const write = async (key: string, patch: Parameters<typeof patchPrefs>[0]) => {
    const ok = await patchPrefs(patch);
    if (ok) setSaved((s) => ({ ...s, [key]: Date.now() }));
    else toast("Couldn't save. Try again", { action: { label: "Try again", onClick: () => { void write(key, patch); } } });
  };

  const move = (key: string, dir: -1 | 1) => {
    const idx = visibleOrder.indexOf(key);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= visibleOrder.length) return;
    const arr = [...visibleOrder];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    void write("sections", { sidebar: { sectionsOrder: arr } });
  };
  const toggle = (key: string, on: boolean) => {
    const nextHidden = on ? [...hidden].filter((k) => k !== key) : [...new Set([...hidden, key])];
    void write("sections", { sidebar: { hiddenSections: nextHidden } });
  };

  const preferencesHref = settingsHrefToday(SETTINGS_PAGES["account/preferences"]) ?? "/account/appearance";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[var(--os-scrim)]" />
        <DialogPrimitive.Content
          className="workwrk-os os-chrome fixed inset-x-0 mx-auto top-1/2 z-[61] flex max-h-[85vh] w-[560px] max-w-[calc(100vw-24px)] -translate-y-1/2 flex-col rounded-xl border border-line bg-raised text-ink shadow-[var(--os-shadow-modal)] outline-none"
          // Radix sees Esc first (a document capture listener) and would close
          // this dialog even when another layer sits on top of it. Hand the
          // key to the LayerStack instead: it closes the top layer only, which
          // is this panel when nothing else is open (spec-shell 1.5).
          onEscapeKeyDown={(e) => { e.preventDefault(); closeTopLayer(); }}
        >
          <div className="flex h-14 shrink-0 items-center gap-3 px-6">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-lg font-semibold text-ink">Customize</DialogPrimitive.Title>
              <DialogPrimitive.Description className="truncate text-sm text-ink-2">Changes save as you make them</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <div className="rounded-lg border border-line px-4">
              <Row label="Theme" savedAt={saved.theme ?? 0}>
                <SegmentedControl<Appearance>
                  label="Theme"
                  value={appearance}
                  locked={locked.has("theme.appearance")}
                  options={[{ value: "LIGHT", label: "Light" }, { value: "DARK", label: "Dark" }, { value: "AUTO", label: "System" }]}
                  onChange={(v) => { void write("theme", { theme: { appearance: v } }); }}
                />
              </Row>
              {CHROME_CONTROL_EXPOSED ? (
                <Row label="Chrome" hint="The rail and the bar" savedAt={saved.chrome ?? 0}>
                  <SegmentedControl<Chrome>
                    label="Chrome"
                    value={chrome}
                    locked={locked.has("theme.chrome")}
                    options={[{ value: "navy", label: "Navy" }, { value: "light", label: "Light" }]}
                    onChange={(v) => { void write("chrome", { theme: { chrome: v } }); }}
                  />
                </Row>
              ) : null}
              <Row label="Density" hint="Tables use Compact" savedAt={saved.density ?? 0}>
                <SegmentedControl<DensityPref>
                  label="Density"
                  value={density}
                  locked={locked.has("density")}
                  options={[{ value: "comfortable", label: "Comfortable" }, { value: "cozy", label: "Cozy" }, { value: "compact", label: "Compact" }]}
                  onChange={(v) => { void write("density", { density: v }); }}
                />
              </Row>
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-micro uppercase tracking-[0.06em] text-ink-2">Sidebar sections</span>
                <span className="h-px flex-1 bg-line" aria-hidden />
                <SavedTick at={saved.sections ?? 0} />
              </div>
              <ul className="rounded-lg border border-line">
                {visibleOrder.map((key, i) => {
                  const section = SECTIONS.find((s) => s.key === key);
                  if (!section) return null;
                  const on = !hidden.has(key);
                  return (
                    <li key={key} className="flex h-12 items-center gap-3 border-b border-line-soft px-4 last:border-b-0">
                      <span className="flex-1 text-base text-ink">{section.label}</span>
                      <button
                        type="button"
                        onClick={() => move(key, -1)}
                        disabled={i === 0}
                        aria-label={`Move ${section.label} up`}
                        title="Move up"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ArrowUp className="h-4 w-4" strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(key, 1)}
                        disabled={i === visibleOrder.length - 1}
                        aria-label={`Move ${section.label} down`}
                        title="Move down"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ArrowDown className="h-4 w-4" strokeWidth={1.5} />
                      </button>
                      <Switch checked={on} onChange={(v) => toggle(key, v)} aria-label={`Show ${section.label}`} />
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-sm text-ink-2">The personal rows at the top are always on.</p>
            </div>

            <div className="mt-6 text-sm">
              <button
                type="button"
                onClick={() => { onOpenChange(false); openSettings(preferencesHref); }}
                className="font-medium text-brand-deep hover:underline"
              >
                More in My settings › Preferences
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
