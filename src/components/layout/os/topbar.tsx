"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bell, HelpCircle, Sparkles, Heart, MessageSquare, Megaphone } from "lucide-react";
import { useOsShell } from "./shell-context";
import { OsNotificationsPopover } from "./notifications-popover";
import { OsKudosPopover } from "./kudos-popover";
import { OsCandorPopover } from "./candor-popover";
import { OsAnnouncementsPopover } from "./announcements-popover";

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

type PopId = "notif" | "kudos" | "candor" | "announce" | null;

export function OsTopbar() {
  const pathname = usePathname() || "/";
  const { openSidekick } = useOsShell();
  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname]);
  const [openPop, setOpenPop] = useState<PopId>(null);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [candorActive, setCandorActive] = useState<number>(0);
  const [annAckPending, setAnnAckPending] = useState<number>(0);

  // Poll all three lightweight badge counts every 60s.
  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const [n, c, a] = await Promise.all([
          fetch("/api/notifications").then((r) => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/candor").then((r) => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/announcements").then((r) => r.ok ? r.json() : null).catch(() => null),
        ]);
        if (!alive) return;
        if (n) setUnreadCount(n.unreadCount ?? 0);
        if (c) {
          const list = c.data ?? (Array.isArray(c) ? c : []);
          setCandorActive(list.filter((s: { status?: string }) => s.status === "ACTIVE").length);
        }
        if (a) {
          const list = a.data ?? (Array.isArray(a) ? a : []);
          setAnnAckPending(list.filter((x: { mustAcknowledge?: boolean; acknowledged?: boolean }) => x.mustAcknowledge && !x.acknowledged).length);
        }
      } catch { /* ignore */ }
    }
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [openPop]);

  const toggle = (id: PopId) => setOpenPop((cur) => cur === id ? null : id);

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

      <button type="button" className="os-top__icon-btn" aria-label="Give kudos" onClick={() => toggle("kudos")}>
        <Heart />
      </button>

      <button
        type="button"
        className="os-top__icon-btn"
        aria-label={`Candor${candorActive > 0 ? ` (${candorActive} active)` : ""}`}
        onClick={() => toggle("candor")}
      >
        <MessageSquare />
        {candorActive > 0 ? <span className="os-top__icon-btn-dot" aria-hidden /> : null}
      </button>

      <button
        type="button"
        className="os-top__icon-btn"
        aria-label={`Announcements${annAckPending > 0 ? ` (${annAckPending} need ack)` : ""}`}
        onClick={() => toggle("announce")}
      >
        <Megaphone />
        {annAckPending > 0 ? <span className="os-top__icon-btn-dot" aria-hidden /> : null}
      </button>

      <button
        type="button"
        className="os-top__icon-btn"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        onClick={() => toggle("notif")}
      >
        <Bell />
        {unreadCount > 0 ? <span className="os-top__icon-btn-dot" aria-hidden /> : null}
      </button>
      <Link href="/help" className="os-top__icon-btn" aria-label="Help">
        <HelpCircle />
      </Link>

      {openPop === "notif"    ? <OsNotificationsPopover  onClose={() => setOpenPop(null)} /> : null}
      {openPop === "kudos"    ? <OsKudosPopover          onClose={() => setOpenPop(null)} /> : null}
      {openPop === "candor"   ? <OsCandorPopover         onClose={() => setOpenPop(null)} /> : null}
      {openPop === "announce" ? <OsAnnouncementsPopover  onClose={() => setOpenPop(null)} /> : null}
    </header>
  );
}
