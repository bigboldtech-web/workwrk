// Keyboard registry (spec-shell.md section 1.8): ONE source for the shell's
// single window listener, every tooltip's kbd hint, the "?" overlay and the
// (later) /account/shortcuts page. A chord is advertised only because it is
// registered, and it is registered only with a working `run`, so "advertised
// equals working" holds by construction: the overlay lists `registry.list()`,
// nothing else.
//
// The canon (browser-safe on Chrome, Safari, Firefox, Edge, macOS + Windows):
//   mod+k          Search (works in inputs)
//   mod+shift+k    Create task
//   mod+j          Ask AI panel
//   mod+\          Collapse or expand the sidebar (replaces mod+b: bold in editors)
//   mod+/  and  ?  Keyboard shortcuts overlay (? not in inputs)
//   g 1..8         Jump to the Nth rail hub (1.5s window, not in inputs)
//   g i / g h      Inbox / Home
//   escape         Close the top layer (works in inputs)
// mod+t, mod+shift+n, mod+1..9, mod+w, mod+n are browser-reserved and never
// appear here.
//
// Pure core (parse, match, format, the registry class) + a thin React hook.
// The window listener itself is a shell component (shell-shortcuts.tsx) so
// this module stays loadable in vitest's node environment.

import { useEffect, useRef, useSyncExternalStore } from "react";

export type ShortcutScope = "global" | "page";

export interface ShortcutDef {
  /** Stable id, e.g. "search", "hub-3", "settings.close". */
  id: string;
  /** "mod+k", "mod+shift+k", "mod+\\", "?", "escape", "g 1" (a sequence). */
  keys: string;
  /** Sentence-case label for the overlay and tooltips. */
  label: string;
  scope: ShortcutScope;
  /** Overlay grouping ("Navigate", "Create", "View", "On this page"). */
  group?: string;
  /** Deliverable while an input, textarea, select or contentEditable has focus. */
  inInputs?: boolean;
  /** Extra runtime condition; false hides it from the overlay too. */
  when?: () => boolean;
  run: (e: KeyboardEvent) => void;
  /** Registered for dispatch but never listed (an alias chord). */
  hidden?: boolean;
}

export interface Chord {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Lowercase `KeyboardEvent.key` ("k", "1", "escape", "?", "\\"). */
  key: string;
}

export const PREFIX_WINDOW_MS = 1500;

const MODIFIER_KEYS = new Set(["shift", "meta", "control", "alt", "os"]);

/** Keys whose identity already encodes Shift on every layout we care about. */
function shiftIsImplicit(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/.test(key);
}

export function parseChord(token: string): Chord {
  const parts = token.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const chord: Chord = { mod: false, shift: false, alt: false, key: "" };
  for (const p of parts) {
    if (p === "mod" || p === "cmd" || p === "ctrl" || p === "meta") chord.mod = true;
    else if (p === "shift") chord.shift = true;
    else if (p === "alt" || p === "option") chord.alt = true;
    else if (p === "esc") chord.key = "escape";
    else chord.key = p;
  }
  return chord;
}

/** "g 1" is a two-chord sequence; "mod+shift+k" is one chord. */
export function parseKeys(keys: string): Chord[] {
  return keys.split(/\s+/).filter(Boolean).map(parseChord);
}

export function eventChord(e: KeyboardEvent): Chord {
  const key = (e.key ?? "").toLowerCase();
  return { mod: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey, key: key === "esc" ? "escape" : key };
}

export function chordEquals(a: Chord, b: Chord): boolean {
  if (a.key !== b.key || a.mod !== b.mod || a.alt !== b.alt) return false;
  if (shiftIsImplicit(a.key)) return true;
  return a.shift === b.shift;
}

export function isModifierOnly(e: Pick<KeyboardEvent, "key">): boolean {
  return MODIFIER_KEYS.has((e.key ?? "").toLowerCase());
}

/** Inputs, textareas, selects and contentEditable hosts swallow plain keys. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el !== "object") return false;
  if ((el as HTMLElement).isContentEditable) return true;
  const tag = (el as HTMLElement).tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export type Platform = "mac" | "other";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = (nav.userAgentData?.platform ?? nav.platform ?? "").toLowerCase();
  return p.includes("mac") || p.includes("iphone") || p.includes("ipad") ? "mac" : "other";
}

const KEY_LABELS: Record<string, string> = {
  escape: "Esc",
  enter: "↵",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  backspace: "⌫",
  " ": "Space",
};

function keyLabel(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
}

/** "⌘⇧K" on a Mac, "Ctrl+Shift+K" elsewhere; sequences read "G 1". */
export function formatKeys(keys: string, platform: Platform = "mac"): string {
  return parseKeys(keys)
    .map((c) => {
      if (platform === "mac") {
        return `${c.mod ? "⌘" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${keyLabel(c.key)}`;
      }
      const parts: string[] = [];
      if (c.mod) parts.push("Ctrl");
      if (c.alt) parts.push("Alt");
      if (c.shift) parts.push("Shift");
      parts.push(keyLabel(c.key));
      return parts.join("+");
    })
    .join(" ");
}

// ── The canon table: keys and labels the shell advertises ─────────

export interface ShortcutCanonEntry {
  id: string;
  keys: string;
  label: string;
  group: string;
  inInputs?: boolean;
}

export const SHORTCUTS: readonly ShortcutCanonEntry[] = [
  { id: "search", keys: "mod+k", label: "Search", group: "General", inInputs: true },
  { id: "create-task", keys: "mod+shift+k", label: "Create task", group: "Create" },
  { id: "ask-ai", keys: "mod+j", label: "Ask AI", group: "General" },
  { id: "toggle-sidebar", keys: "mod+\\", label: "Collapse or expand the sidebar", group: "View" },
  { id: "shortcuts-overlay", keys: "?", label: "Keyboard shortcuts", group: "General" },
  { id: "hub-1", keys: "g 1", label: "Go to the 1st hub", group: "Navigate" },
  { id: "hub-2", keys: "g 2", label: "Go to the 2nd hub", group: "Navigate" },
  { id: "hub-3", keys: "g 3", label: "Go to the 3rd hub", group: "Navigate" },
  { id: "hub-4", keys: "g 4", label: "Go to the 4th hub", group: "Navigate" },
  { id: "hub-5", keys: "g 5", label: "Go to the 5th hub", group: "Navigate" },
  { id: "hub-6", keys: "g 6", label: "Go to the 6th hub", group: "Navigate" },
  { id: "hub-7", keys: "g 7", label: "Go to the 7th hub", group: "Navigate" },
  { id: "hub-8", keys: "g 8", label: "Go to the 8th hub", group: "Navigate" },
  { id: "go-inbox", keys: "g i", label: "Go to Inbox", group: "Navigate" },
  { id: "go-home", keys: "g h", label: "Go to Home", group: "Navigate" },
  { id: "close-layer", keys: "escape", label: "Close", group: "General", inInputs: true },
];

const CANON_BY_ID: Record<string, ShortcutCanonEntry> = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s]));

/** The canon keys for an id, e.g. `shortcutKeys("hub-1")` = "g 1". */
export function shortcutKeys(id: string): string | undefined {
  return CANON_BY_ID[id]?.keys;
}

/** The hint a tooltip shows, e.g. "G 1" or "⌘⇧K". Empty when unknown. */
export function shortcutHint(id: string, platform: Platform = "mac"): string {
  const keys = shortcutKeys(id);
  return keys ? formatKeys(keys, platform) : "";
}

/** The hub-jump hint for a rail index (0-based); undefined past the 8th. */
export function hubShortcutHint(index: number, platform: Platform = "mac"): string | undefined {
  return index >= 0 && index < 8 ? shortcutHint(`hub-${index + 1}`, platform) : undefined;
}

// ── Registry ──────────────────────────────────────────────────────

export interface DispatchContext {
  /** Override typing detection (tests). Defaults to isTypingTarget(e.target). */
  typing?: boolean;
  now?: number;
}

export class ShortcutRegistry {
  private items = new Map<string, ShortcutDef>();
  private listeners = new Set<() => void>();
  private pending: { chord: Chord; at: number } | null = null;
  private snapshot: ShortcutDef[] = [];

  register(def: ShortcutDef): () => void {
    this.items.set(def.id, def);
    this.emit();
    return () => {
      if (this.items.get(def.id) === def) {
        this.items.delete(def.id);
        this.emit();
      }
    };
  }

  /** Every registered shortcut, page scope first (the overlay's order). */
  list(): ShortcutDef[] {
    return this.snapshot;
  }

  /** What the overlay shows: registered, visible, and currently applicable. */
  visible(): ShortcutDef[] {
    return this.snapshot.filter((d) => !d.hidden && (d.when ? d.when() : true));
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Test seam. */
  clear(): void {
    this.items.clear();
    this.pending = null;
    this.emit();
  }

  private emit() {
    const all = [...this.items.values()];
    this.snapshot = [...all.filter((d) => d.scope === "page"), ...all.filter((d) => d.scope !== "page")];
    for (const cb of this.listeners) cb();
  }

  private applicable(def: ShortcutDef, typing: boolean): boolean {
    if (typing && !def.inInputs) return false;
    if (def.when && !def.when()) return false;
    return true;
  }

  /**
   * Route one keydown. Returns true when a shortcut ran (the event was
   * consumed) or a prefix was armed. Never runs anything for an event some
   * component already handled (`defaultPrevented`), which is how a Radix
   * dialog's own Esc stays its own.
   */
  dispatch(e: KeyboardEvent, ctx: DispatchContext = {}): boolean {
    if (e.defaultPrevented) return false;
    if (isModifierOnly(e)) return false;
    const now = ctx.now ?? Date.now();
    const typing = ctx.typing ?? isTypingTarget(e.target);
    const chord = eventChord(e);
    const defs = this.snapshot;

    // Second key of a sequence, inside the window.
    if (this.pending) {
      const { chord: first, at } = this.pending;
      this.pending = null;
      if (now - at <= PREFIX_WINDOW_MS && !typing) {
        for (const def of defs) {
          const seq = parseKeys(def.keys);
          if (seq.length === 2 && chordEquals(seq[0], first) && chordEquals(seq[1], chord) && this.applicable(def, typing)) {
            e.preventDefault();
            def.run(e);
            return true;
          }
        }
      }
      // No match: fall through and treat this key on its own.
    }

    for (const def of defs) {
      const seq = parseKeys(def.keys);
      if (seq.length === 1 && chordEquals(seq[0], chord) && this.applicable(def, typing)) {
        e.preventDefault();
        def.run(e);
        return true;
      }
    }

    // First key of a sequence: arm the prefix. Plain keys only, never in inputs.
    if (!typing && !chord.mod && !chord.alt) {
      for (const def of defs) {
        const seq = parseKeys(def.keys);
        if (seq.length === 2 && chordEquals(seq[0], chord) && this.applicable(def, typing)) {
          this.pending = { chord, at: now };
          return true;
        }
      }
    }
    return false;
  }
}

/** The one registry the shell listener, tooltips and the overlay read. */
export const shortcuts = new ShortcutRegistry();

// ── React ─────────────────────────────────────────────────────────

/**
 * Register a shortcut for the lifetime of the component. `run` and `when`
 * are read through refs so callers pass fresh closures without re-registering.
 * Pages register with `scope: "page"`; they appear under "On this page".
 */
export function useShortcut(def: ShortcutDef, enabled: boolean = true): void {
  const runRef = useRef(def.run);
  runRef.current = def.run;
  const whenRef = useRef(def.when);
  whenRef.current = def.when;
  const { id, keys, label, scope, group, inInputs, hidden } = def;
  useEffect(() => {
    if (!enabled) return;
    return shortcuts.register({
      id,
      keys,
      label,
      scope,
      group,
      inInputs,
      hidden,
      when: () => (whenRef.current ? whenRef.current() : true),
      run: (e) => runRef.current(e),
    });
  }, [enabled, id, keys, label, scope, group, inInputs, hidden]);
}

const EMPTY: ShortcutDef[] = [];

/** The registered shortcuts, live (the overlay's data source). */
export function useShortcutList(): ShortcutDef[] {
  return useSyncExternalStore(
    (cb) => shortcuts.subscribe(cb),
    () => shortcuts.list(),
    () => EMPTY,
  );
}
