"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import * as React from "react";

export type BreadcrumbItem = {
  label: React.ReactNode;
  href?: string;
};

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav className={"dash-page-breadcrumbs " + (className ?? "")} aria-label="Breadcrumb">
      {items.map((it, i) => {
        const isLast = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            {it.href && !isLast ? (
              <Link href={it.href}>{it.label}</Link>
            ) : (
              <span className={isLast ? "dash-page-breadcrumbs-current" : undefined}>
                {it.label}
              </span>
            )}
            {!isLast && (
              <ChevronRight size={11} className="dash-page-breadcrumbs-sep" aria-hidden />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
