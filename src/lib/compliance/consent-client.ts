"use client";

import type { ConsentRegime } from "./regions";

export const CONSENT_COOKIE = "wwrk_consent";

export interface ConsentState {
  necessary: boolean;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
  doNotSell: boolean;
}

export const DEFAULT_CONSENT: ConsentState = {
  necessary: true,
  preferences: false,
  analytics: false,
  marketing: false,
  doNotSell: false,
};

export function readConsentCookie(): (ConsentState & { v: string; t: string; ts: number }) | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]+)`),
  );
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export interface GeoInfo {
  regime: ConsentRegime;
  country: string | null;
  region: string | null;
  policyVersion: string;
}

export async function fetchGeo(): Promise<GeoInfo> {
  const res = await fetch("/api/consent", { method: "GET", cache: "no-store" });
  if (!res.ok) {
    return { regime: "OPT_IN_STRICT", country: null, region: null, policyVersion: "unknown" };
  }
  return res.json();
}

export async function saveConsent(
  state: Partial<ConsentState>,
  method: "banner" | "settings" | "api" = "banner",
): Promise<ConsentState> {
  const res = await fetch("/api/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...state, method }),
  });
  const data = await res.json();
  return data.consent as ConsentState;
}

export async function withdrawConsent(): Promise<void> {
  await fetch("/api/consent", { method: "DELETE" });
}
