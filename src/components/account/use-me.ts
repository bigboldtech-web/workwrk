"use client";

// GET /api/me for the My settings pages, with the fetch-failure rule
// (settings-architecture 8.6): a failed read answers `status: "error"` and
// NO data, so a page renders OsEmptyView with Retry instead of a form over
// nothing, and nothing can Save empty strings over live values.

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { OrgRole } from "@/lib/access/types";
import type { PasswordPolicyView } from "@/lib/auth/password-rules";

export interface MeRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  emailVerifiedAt: string | null;
  passwordChangedAt: string | null;
  mfaEnabled: boolean;
  backupCodesLeft: number;
  createdAt: string;
  orgRole: OrgRole;
  isAgent: boolean;
  isLastAdmin: boolean;
  department: { id: string; name: string } | null;
  role: { id: string; title: string } | null;
  office: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  organization: { id: string; name: string };
  /** mfaRequired and mfaOrgName are the rule of the workspace this session
   *  acts in; the password rules and expiry are the anchored workspace's. */
  policy: { mfaRequired: boolean; mfaOrgName?: string; passwordMaxAgeDays: number | null; password: PasswordPolicyView };
}

export type MeState =
  | { status: "loading"; me: null }
  | { status: "ready"; me: MeRecord }
  | { status: "error"; me: null; error: string };

export function useMe() {
  const [state, setState] = useState<MeState>({ status: "loading", me: null });

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState({ status: "loading", me: null });
    const r = await apiFetch<{ user?: MeRecord }>("/api/me", { cache: "no-store" });
    if (r.ok && r.data?.user) setState({ status: "ready", me: r.data.user });
    else if (!quiet) setState({ status: "error", me: null, error: r.ok ? "Couldn't load your account" : r.error });
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  /** Re-read after a change without flashing the skeleton. */
  const refresh = useCallback(() => load(true), [load]);
  const retry = useCallback(() => { void load(); }, [load]);
  return { ...state, refresh, retry };
}
