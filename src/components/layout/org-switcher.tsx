"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Building2, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";

interface Membership {
  id: string;
  role: string;
  isPrimary: boolean;
  isCurrent: boolean;
  organization: { id: string; name: string; slug: string; logo: string | null };
}

/**
 * Surfaces every Organization the user can act inside. Single-membership
 * users see a read-only chip (no dropdown chevron). Multi-membership
 * users get the full switcher.
 *
 * Switching strategy: POST `/api/me/switch-org`, then call
 * `useSession().update()` so the JWT picks up the new org without a
 * full page refresh, then `router.refresh()` so any server components
 * re-render against the new tenant scope.
 */
export function OrgSwitcher() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const { error: toastError } = useToast();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [switching, setSwitching] = useState(false);

  const orgName = (session?.user as any)?.organizationName || "Workspace";

  useEffect(() => {
    if (loaded) return;
    fetch("/api/me/orgs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: Membership[] = d?.data?.memberships || d?.memberships || [];
        setMemberships(list);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [loaded]);

  // Single-org users — render a static chip; no dropdown. Matches the
  // pre-switcher UX, plus the building icon as visual anchor.
  if (loaded && memberships.length <= 1) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted px-2 py-1 rounded-md bg-surface-2">
        <Building2 size={12} />
        <span className="max-w-[140px] truncate">{orgName}</span>
      </span>
    );
  }

  async function switchTo(organizationId: string) {
    if (switching) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/me/switch-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to switch organization");
      }
      // Force JWT refresh so the rest of the app sees the new org
      // immediately. Then re-render any server components against
      // the new tenant scope.
      await update();
      router.refresh();
    } catch (e: any) {
      toastError(e?.message || "Failed to switch organization");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs text-foreground px-2 py-1 rounded-md bg-surface-2 hover:bg-surface-3 transition-colors"
          aria-label="Switch organization"
          disabled={switching}
        >
          <Building2 size={12} />
          <span className="max-w-[140px] truncate">{orgName}</span>
          <ChevronDown size={11} className="text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        <DropdownMenuLabel>Switch organization</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => !m.isCurrent && switchTo(m.organization.id)}
            className="flex items-center justify-between gap-3 cursor-pointer"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-6 h-6 rounded bg-surface-3 inline-flex items-center justify-center shrink-0">
                {m.organization.logo ? (
                  <img src={m.organization.logo} alt="" className="w-full h-full rounded object-cover" />
                ) : (
                  <Building2 size={12} className="text-muted" />
                )}
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-sm truncate">{m.organization.name}</span>
                <span className="text-[10px] text-muted-2 uppercase tracking-wide">{m.role}</span>
              </span>
            </span>
            {m.isCurrent && <Check size={14} className="text-[color:var(--accent-strong)] shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
