// The sheet menu bar's one pure rule (components/tables/sheet-menu-bar.tsx):
// rows the viewer cannot use are ABSENT, not disabled, so a menu built from a
// list of conditionally-present rows can end up with a separator at its top,
// its bottom, or two in a row. tidyMenu removes those, recursively.

export type TidyItem = { separator: true } | { submenu?: TidyItem[] };

export function tidyMenu<T extends TidyItem>(items: T[]): T[] {
  const out: T[] = [];
  for (const it of items) {
    if ("separator" in it) {
      const last = out[out.length - 1];
      if (out.length === 0 || (last && "separator" in last)) continue;
      out.push(it);
    } else {
      const sub = (it as { submenu?: T[] }).submenu;
      out.push(sub ? ({ ...it, submenu: tidyMenu(sub) } as T) : it);
    }
  }
  while (out.length && "separator" in out[out.length - 1]) out.pop();
  return out;
}
