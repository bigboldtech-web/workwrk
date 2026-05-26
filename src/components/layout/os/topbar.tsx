"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Bell, HelpCircle, Sparkles } from "lucide-react";
import { useOsShell } from "./shell-context";

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
      <button type="button" className="os-top__icon-btn" aria-label="Notifications">
        <Bell />
        <span className="os-top__icon-btn-dot" aria-hidden />
      </button>
      <button type="button" className="os-top__icon-btn" aria-label="Help">
        <HelpCircle />
      </button>
    </header>
  );
}
