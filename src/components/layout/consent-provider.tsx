"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  DEFAULT_CONSENT,
  readConsentCookie,
  fetchGeo,
  saveConsent,
  withdrawConsent,
  type ConsentState,
  type GeoInfo,
} from "@/lib/compliance/consent-client";

interface ConsentContextValue {
  /** Current consent state. */
  consent: ConsentState;
  /** Geo + regime (populated after first fetch). */
  geo: GeoInfo | null;
  /** True once the banner decision has been made or skipped. */
  resolved: boolean;
  /** Is the banner currently shown? */
  showBanner: boolean;
  /** Save granular consent and dismiss the banner. */
  accept: (partial: Partial<ConsentState>) => Promise<void>;
  /** Quick-accept all non-essential categories. */
  acceptAll: () => Promise<void>;
  /** Quick-reject all non-essential categories. */
  rejectAll: () => Promise<void>;
  /** Re-open the banner (e.g. from footer link). */
  reopen: () => void;
  /** Fully withdraw — resets and logs. */
  withdraw: () => Promise<void>;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentState>(DEFAULT_CONSENT);
  const [geo, setGeo] = useState<GeoInfo | null>(null);
  const [resolved, setResolved] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = readConsentCookie();
      const g = await fetchGeo();
      if (cancelled) return;
      setGeo(g);

      if (existing && existing.v === g.policyVersion) {
        // Consent already given for the current policy version — do not prompt.
        setConsent({
          necessary: true,
          preferences: !!existing.preferences,
          analytics: !!existing.analytics,
          marketing: !!existing.marketing,
          doNotSell: !!existing.doNotSell,
        });
        setResolved(true);
        setShowBanner(false);
        return;
      }

      // No valid record — banner behaviour depends on regime.
      if (g.regime === "NOTICE_ONLY") {
        // Informational banner; can auto-enable preferences + analytics since
        // local law allows, but still show dismissible notice.
        setConsent({
          necessary: true,
          preferences: true,
          analytics: true,
          marketing: false,
          doNotSell: false,
        });
      }
      setShowBanner(true);
      setResolved(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = useCallback(
    async (partial: Partial<ConsentState>) => {
      const next = await saveConsent(partial, "banner");
      setConsent(next);
      setResolved(true);
      setShowBanner(false);
    },
    [],
  );

  const acceptAll = useCallback(
    () =>
      accept({
        preferences: true,
        analytics: true,
        marketing: true,
        doNotSell: false,
      }),
    [accept],
  );

  const rejectAll = useCallback(
    () =>
      accept({
        preferences: false,
        analytics: false,
        marketing: false,
        doNotSell: true,
      }),
    [accept],
  );

  const reopen = useCallback(() => setShowBanner(true), []);

  const withdraw = useCallback(async () => {
    await withdrawConsent();
    setConsent({ ...DEFAULT_CONSENT, doNotSell: true });
    setResolved(false);
    setShowBanner(true);
  }, []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      consent,
      geo,
      resolved,
      showBanner,
      accept,
      acceptAll,
      rejectAll,
      reopen,
      withdraw,
    }),
    [consent, geo, resolved, showBanner, accept, acceptAll, rejectAll, reopen, withdraw],
  );

  return (
    <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>
  );
}

export function useConsent() {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used within ConsentProvider");
  return ctx;
}
