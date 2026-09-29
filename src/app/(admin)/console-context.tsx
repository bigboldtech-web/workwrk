"use client";

// The Staff console's client context (spec-admin-backoffice section 1
// "Console preferences", section 3 items 1 and 3). One provider in
// AdminShell holds:
//
//   - who is signed in (staff email and name) and the absolute app URL,
//   - the console-local layout state from PlatformAdmin.consolePrefs, with an
//     optimistic `patchPrefs` that saves through PATCH /api/admin/me/console
//     debounced 500ms (never localStorage),
//   - Search's RECENT companies and `noteCompanyOpened`, which the company
//     page calls so the list follows the staff member between machines,
//   - the person's own date preferences (My settings > Language & region),
//     so every console date renders through formatDate with them,
//   - the company name for the breadcrumb, declared by the company page.
//
// No product context is used: the admin host serves only /admin, /login,
// /api/auth and /api/admin/*, so nothing here may call a product API.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { mergeConsolePrefs, pushRecent, type ConsolePrefs, type ConsolePrefsPatch } from "@/lib/admin/console-prefs";
import type { RecentCompany } from "@/lib/admin/console-me";
import type { DateFormatPrefs } from "@/lib/format/date";
import { useOsToast } from "@/components/layout/os/toast";

export interface ConsoleStaff {
  email: string;
  name: string | null;
}

interface ConsoleValue {
  staff: ConsoleStaff;
  prefs: ConsolePrefs;
  recents: RecentCompany[];
  /** False when this staff member has no PlatformAdmin row (local bootstrap only). */
  persisted: boolean;
  datePrefs: DateFormatPrefs;
  /** NEXT_PUBLIC_APP_URL without a trailing slash; "" when unset. */
  appUrl: string;
  patchPrefs: (patch: Omit<ConsolePrefsPatch, "openedCompany" | "recent">) => void;
  noteCompanyOpened: (company: RecentCompany) => void;
  companyCrumb: string | null;
  setCompanyCrumb: (name: string | null) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

const Ctx = createContext<ConsoleValue | null>(null);

export function useConsole(): ConsoleValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConsole must be used inside the Staff console (AdminShell)");
  return v;
}

/** The company page names itself in the breadcrumb while it is mounted. */
export function useCompanyCrumb(name: string | null | undefined): void {
  const { setCompanyCrumb } = useConsole();
  useEffect(() => {
    setCompanyCrumb(name ?? null);
    return () => setCompanyCrumb(null);
  }, [name, setCompanyCrumb]);
}

type SavedPayload = { prefs: ConsolePrefs; recents: RecentCompany[] };

const SAVE_DEBOUNCE_MS = 500;

/** Fold a second pending patch into the first (later keys win). */
function foldPatch(a: ConsolePrefsPatch, b: ConsolePrefsPatch): ConsolePrefsPatch {
  return {
    ...(a.sidebar || b.sidebar ? { sidebar: { ...a.sidebar, ...b.sidebar } } : {}),
    ...(a.companies || b.companies ? { companies: { ...a.companies, ...b.companies } } : {}),
    ...(a.audit || b.audit ? { audit: { ...a.audit, ...b.audit } } : {}),
  };
}

export function ConsoleProvider({
  staff,
  initialPrefs,
  initialRecents,
  persisted,
  datePrefs,
  appUrl,
  children,
}: {
  staff: ConsoleStaff;
  initialPrefs: ConsolePrefs;
  initialRecents: RecentCompany[];
  persisted: boolean;
  datePrefs: DateFormatPrefs;
  appUrl: string;
  children: React.ReactNode;
}) {
  const { toast } = useOsToast();
  const [prefs, setPrefs] = useState<ConsolePrefs>(initialPrefs);
  const [recents, setRecents] = useState<RecentCompany[]>(initialRecents);
  const [companyCrumb, setCompanyCrumb] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const pending = useRef<ConsolePrefsPatch | null>(null);
  const timer = useRef<number | null>(null);
  const warnedUnpersisted = useRef(false);

  const send = useCallback(
    async (patch: ConsolePrefsPatch): Promise<void> => {
      if (!persisted) {
        // A bootstrap staff member (local only) has no row to save into. Say
        // so once instead of failing on every sidebar toggle.
        if (!warnedUnpersisted.current) {
          warnedUnpersisted.current = true;
          toast("Console settings are not kept until you add yourself on Staff");
        }
        return;
      }
      // One named attempt, so "Try again" can re-run exactly this save.
      const attempt = async (): Promise<void> => {
        const r = await apiFetch<SavedPayload>("/api/admin/me/console", { method: "PATCH", json: patch });
        if (r.ok) {
          setRecents(r.data.recents);
          return;
        }
        // 401 is the session-expired dialog's to show; anything else is ours.
        if (r.status === 401) return;
        toast("Couldn't save your console settings", {
          action: { label: "Try again", onClick: () => { void attempt(); } },
        });
      };
      await attempt();
    },
    [persisted, toast],
  );

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    pending.current = null;
    if (p) void send(p);
  }, [send]);

  // A pending save still goes out when the tab closes or navigates away.
  useEffect(() => {
    const onHide = () => {
      const p = pending.current;
      if (!p || !persisted) return;
      pending.current = null;
      void apiFetch("/api/admin/me/console", { method: "PATCH", json: p, keepalive: true });
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [persisted]);

  const patchPrefs = useCallback<ConsoleValue["patchPrefs"]>(
    (patch) => {
      setPrefs((cur) => mergeConsolePrefs(cur, patch));
      pending.current = pending.current ? foldPatch(pending.current, patch) : { ...patch };
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const noteCompanyOpened = useCallback<ConsoleValue["noteCompanyOpened"]>(
    (company) => {
      setPrefs((cur) => ({ ...cur, recent: pushRecent(cur.recent, company.id) }));
      setRecents((cur) => [company, ...cur.filter((c) => c.id !== company.id)].slice(0, 5));
      // Sent at once, not debounced: two companies opened in quick succession
      // are two server-side pushes, so neither is lost.
      void send({ openedCompany: company.id });
    },
    [send],
  );

  const value = useMemo<ConsoleValue>(
    () => ({
      staff, prefs, recents, persisted, datePrefs, appUrl, patchPrefs, noteCompanyOpened,
      companyCrumb, setCompanyCrumb, searchOpen, setSearchOpen,
    }),
    [staff, prefs, recents, persisted, datePrefs, appUrl, patchPrefs, noteCompanyOpened, companyCrumb, searchOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
