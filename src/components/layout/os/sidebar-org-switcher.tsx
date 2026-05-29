"use client";

/* Sidebar-styled org switcher.
 *
 * Matches the `.os-side__` design system (unlike the generic OrgSwitcher
 * which uses Tailwind). Single-org users get a static chip; multi-org
 * users get a click-to-open dropdown panel listing memberships +
 * "Workspace settings" + "Sign out" entries.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Building2, Check, ChevronDown, Settings as SettingsIcon, LogOut, Plus } from "lucide-react";

interface Membership {
  id: string;
  role: string;
  isPrimary: boolean;
  isCurrent: boolean;
  organization: { id: string; name: string; slug: string; logo: string | null };
}

export function SidebarOrgSwitcher() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const orgName = (session?.user as { organizationName?: string } | undefined)?.organizationName || "Workspace";
  const userName = (session?.user as { name?: string } | undefined)?.name || (session?.user as { email?: string } | undefined)?.email || "Signed in";

  // Lazy-load memberships only when the user opens the dropdown.
  useEffect(() => {
    if (!open || memberships !== null) return;
    fetch("/api/me/orgs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: Membership[] = d?.data?.memberships || d?.memberships || [];
        setMemberships(list);
      })
      .catch(() => setMemberships([]));
  }, [open, memberships]);

  // Close on outside click + ESC.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  async function switchTo(organizationId: string) {
    if (switching) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/me/switch-org", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) throw new Error();
      await update();
      router.refresh();
      setOpen(false);
    } catch { /* swallow — UI stays open with previous org */ }
    finally { setSwitching(false); }
  }

  const currentInitial = orgName.charAt(0).toUpperCase();

  return (
    <div ref={wrapRef} className="os-side__ws-wrap">
      <button type="button" className="os-side__ws" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="os-side__ws-mark">{currentInitial}</span>
        <span className="os-side__ws-info">
          <span className="os-side__ws-name">{orgName}</span>
          <span className="os-side__ws-tier">{userName}</span>
        </span>
        <span className="os-side__ws-chev" data-open={open}><ChevronDown /></span>
      </button>
      {open && (
        <div className="os-side__ws-pop">
          <div className="os-side__ws-pop-head">Workspaces</div>
          {memberships === null ? (
            <div className="os-side__ws-pop-loading">Loading…</div>
          ) : memberships.length === 0 ? (
            <div className="os-side__ws-pop-empty"><Building2 /> No other workspaces</div>
          ) : (
            <div className="os-side__ws-pop-list">
              {memberships.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`os-side__ws-pop-item ${m.isCurrent ? "is-current" : ""}`}
                  onClick={() => !m.isCurrent && switchTo(m.organization.id)}
                  disabled={switching}
                >
                  <span className="os-side__ws-pop-logo">
                    {m.organization.logo
                      ? <img src={m.organization.logo} alt="" />
                      : <span>{m.organization.name.charAt(0).toUpperCase()}</span>}
                  </span>
                  <span className="os-side__ws-pop-info">
                    <span className="os-side__ws-pop-name">{m.organization.name}</span>
                    <span className="os-side__ws-pop-role">{m.role}</span>
                  </span>
                  {m.isCurrent && <Check className="os-side__ws-pop-check" />}
                </button>
              ))}
            </div>
          )}
          <div className="os-side__ws-pop-sep" />
          <Link href="/settings" className="os-side__ws-pop-action" onClick={() => setOpen(false)}>
            <SettingsIcon /> Workspace settings
          </Link>
          <button type="button" className="os-side__ws-pop-action" onClick={() => setOpen(false)}>
            <Plus /> Create new workspace
          </button>
          <div className="os-side__ws-pop-sep" />
          <button type="button" className="os-side__ws-pop-action os-side__ws-pop-action--danger" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
