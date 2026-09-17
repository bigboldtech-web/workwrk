// Client-side density helper. The dashboard layout applies the browser's
// last-known density on mount so the first paint has an attribute before
// ThemeApplier has fetched the stored preference; ThemeApplier then writes
// the effective value and wins. Comfortable (44) is the default
// (design-system 3.2); cozy is 36 and compact 32. tokens.css keys
// --os-row-h on html[data-density].
export type Density = "compact" | "cozy" | "comfortable";

const STORAGE_KEY = "workwrk:density";
const ATTR = "data-density";
const DEFAULT: Density = "comfortable";

function coerce(v: unknown): Density {
  return v === "cozy" || v === "compact" || v === "comfortable" ? v : DEFAULT;
}

export function getInitialDensity(): Density {
  if (typeof window === "undefined") return DEFAULT;
  return coerce(window.localStorage.getItem(STORAGE_KEY));
}

export function applyDensity(d: Density) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(ATTR, d);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, d);
    window.dispatchEvent(new CustomEvent("workwrk:density-change", { detail: d }));
  }
}

export function readDensity(): Density {
  if (typeof document === "undefined") return DEFAULT;
  return coerce(document.documentElement.getAttribute(ATTR));
}
