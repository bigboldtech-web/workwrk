export type Density = "compact" | "cozy";

const STORAGE_KEY = "workwrk:density";
const ATTR = "data-density";

export function getInitialDensity(): Density {
  if (typeof window === "undefined") return "compact";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "cozy" ? "cozy" : "compact";
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
  if (typeof document === "undefined") return "compact";
  const attr = document.documentElement.getAttribute(ATTR);
  return attr === "cozy" ? "cozy" : "compact";
}
