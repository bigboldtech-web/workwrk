"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bell, HelpCircle, Sparkles } from "lucide-react";
import { useOsShell } from "./shell-context";
import { OsNotificationsPopover } from "./notifications-popover";

function humanize(seg: string) {
  return seg.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildCrumbs(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return [{ href: "/today", label: "Today", current: true }];
  const crumbs: { href: string; label: string; current: boolean }[] = [];
  let acc = "";
  parts.forEach((p, i) => {
    acc += `/${p}`;
    crumbs.push({
      href: acc,
      label: humanize(decodeURIComponent(p)),
      current: i === parts.length - 1,
    });
  });
  return crumbs;
}

export function OsTopbar() {
  const pathname = usePathname() || "/";
  const { openSidekick } = useOsShell();
  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  // Lightweight unread-count poll for the bell badge. 60s is more than
  // fast enough — the popover always loads fresh on open.
  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const res = await fetch("/api/notifications");
        if (!alive || !res.ok) return;
        const json = await res.json();
        setUnreadCount(json.unreadCount ?? 0);
      } catch { /* ignore */ }
    }
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [notifOpen]);

  return (
    <header className="os-top" role="banner">
      <nav className="os-top__crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={c.href} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 ? <span className="os-top__crumb-sep" aria-hidden>/</span> : null}
            {c.current ? (
              <span className="os-top__crumb-current">{c.label}</span>
            ) : (
              <Link href={c.href} className="os-top__crumb-link">{c.label}</Link>
            )}
          </span>
        ))}
      </nav>

      <div className="os-top__spacer" />

      <button type="button" className="os-top__ai" onClick={openSidekick}>
        <Sparkles />
        <span>Sidekick</span>
        <span className="os-top__ai-kbd">⌘J</span>
      </button>
      <button
        type="button"
        className="os-top__icon-btn"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        onClick={() => setNotifOpen((v) => !v)}
      >
        <Bell />
        {unreadCount > 0 ? <span className="os-top__icon-btn-dot" aria-hidden /> : null}
      </button>
      <Link href="/help" className="os-top__icon-btn" aria-label="Help">
        <HelpCircle />
      </Link>
      {notifOpen ? <OsNotificationsPopover onClose={() => setNotifOpen(false)} /> : null}
    </header>
  );
}
