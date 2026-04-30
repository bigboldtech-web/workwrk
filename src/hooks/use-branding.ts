"use client";

import { useEffect, useState } from "react";

export interface Branding {
  name: string | null;        // org legal/internal name
  logo: string | null;        // URL or data URL
  displayName: string | null; // override shown in topbar/sidebar; falls back to `name`
  primaryColor: string | null; // hex; falls back to lime
  whiteLabelEnabled: boolean;
}

let cache: Branding | null = null;
let inflight: Promise<Branding> | null = null;

async function fetchBranding(): Promise<Branding> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/organization/branding");
      if (!res.ok) throw new Error("bad status");
      const json = await res.json();
      cache = (json.data ?? json) as Branding;
      return cache;
    } catch {
      cache = { name: null, logo: null, displayName: null, primaryColor: null, whiteLabelEnabled: false };
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Public API: returns branding once fetched. Components render
 *  defaults until the value resolves. */
export function useBranding(): Branding | null {
  const [b, setB] = useState<Branding | null>(cache);
  useEffect(() => {
    if (cache) { setB(cache); return; }
    fetchBranding().then(setB);
  }, []);
  return b;
}

/** Force a re-fetch — use after the admin updates branding. */
export function invalidateBrandingCache() {
  cache = null;
}
