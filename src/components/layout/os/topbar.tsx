"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Star, Bell, Share2, Sparkles, Settings2 } from "lucide-react";
import { useOsShell } from "./shell-context";

function humanize(seg: string) {
  return seg
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
  const { lens, setLens, openSidekick, openPalette } = useOsShell();
  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname]);

  return (
    <header className="os-top" role="banner">
      <nav className="os-crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={c.href} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {i > 0 ? <span className="os-crumbs__sep" aria-hidden>/</span> : null}
            {c.current ? (
              <span className="os-crumbs__current">{c.label}</span>
            ) : (
              <Link href={c.href} className="os-crumbs__item">
                {c.label}
              </Link>
            )}
          </span>
        ))}
        <button type="button" className="os-crumbs__star" aria-label="Pin to favorites">
          <Star />
        </button>
      </nav>

      <div className="os-top__right">
        <div className="os-mewe" role="tablist" aria-label="View as">
          <button
            type="button"
            role="tab"
            aria-selected={lens === "me"}
            className={`os-mewe__btn ${lens === "me" ? "is-active" : ""}`}
            onClick={() => setLens("me")}
          >
            Me
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={lens === "we"}
            className={`os-mewe__btn ${lens === "we" ? "is-active" : ""}`}
            onClick={() => setLens("we")}
          >
            We
          </button>
        </div>

        <button type="button" className="os-icon-btn" aria-label="Notifications">
          <Bell />
          <span className="os-icon-btn__dot" aria-hidden />
        </button>
        <button type="button" className="os-icon-btn" aria-label="View settings" onClick={openPalette}>
          <Settings2 />
        </button>
        <button type="button" className="os-top__share">
          <Share2 />
          <span>Share</span>
        </button>
        <button type="button" className="os-top__ai" onClick={openSidekick}>
          <Sparkles />
          <span>Sidekick</span>
          <kbd>⌘J</kbd>
        </button>
      </div>
    </header>
  );
}
