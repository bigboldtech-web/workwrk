// One line of record tabs: which fit, which go into the More menu.
//
// Pure: no imports. Client safe.

/**
 * Which tabs fit on one line at `width` (0 = unmeasured: all of them). Pill
 * widths are estimated from the label (14px text, 10px padding a side, 4px
 * gap); the active tab always stays in view, swapped in for the last one.
 */
export function fitTabs<K extends string>(all: K[], active: K, width: number, chars: (k: K) => number): { shown: K[]; overflow: K[] } {
  if (width <= 0) return { shown: all, overflow: [] };
  const pill = (k: K) => Math.ceil(chars(k) * 7.6) + 24;
  const total = all.reduce((w, k) => w + pill(k), 0);
  if (total <= width) return { shown: all, overflow: [] };
  const more = 76;
  const shown: K[] = [];
  let used = more;
  for (const k of all) {
    if (used + pill(k) > width) break;
    shown.push(k);
    used += pill(k);
  }
  if (!shown.includes(active)) {
    if (shown.length) shown[shown.length - 1] = active; else shown.push(active);
  }
  const order = new Map(all.map((k, i) => [k, i]));
  shown.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { shown, overflow: all.filter((k) => !shown.includes(k)) };
}
