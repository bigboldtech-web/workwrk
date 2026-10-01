// Group a shortcut list for display (the ? overlay and My settings >
// Keyboard shortcuts read the SAME live registry, src/lib/shortcuts.ts, and
// group it the same way). Pure; tested.
import type { ShortcutDef } from "./shortcuts";

export const SHORTCUT_GROUP_ORDER = ["General", "Navigate", "Create", "View", "On this page"];

export function groupShortcuts(list: readonly ShortcutDef[], opts: { includePage?: boolean } = {}): { name: string; items: ShortcutDef[] }[] {
  const byGroup = new Map<string, ShortcutDef[]>();
  const seen = new Set<string>();
  for (const d of list) {
    if (d.hidden) continue;
    if (d.when && !d.when()) continue;
    if (d.scope === "page" && !opts.includePage) continue;
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const g = d.scope === "page" ? "On this page" : d.group ?? "General";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(d);
  }
  const names = [...byGroup.keys()].sort((a, b) => {
    const ia = SHORTCUT_GROUP_ORDER.indexOf(a);
    const ib = SHORTCUT_GROUP_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return names.map((name) => ({ name, items: byGroup.get(name)! }));
}
