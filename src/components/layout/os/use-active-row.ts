"use client";

// The one answer to "which sidebar row is current", shared by every hub
// sidebar (spec-shell.md §1.1). It lives in its own module because the hub
// sidebars are split across apps-catalog.tsx, docs-sidebar.tsx,
// tables-sidebar.tsx and chat-sidebar.tsx, and a second hand-rolled copy of
// the rule is exactly how two rows used to light at once.

import { usePathname, useSearchParams } from "next/navigation";
import { resolveActiveRow } from "@/lib/nav/route-hub";

export type ActiveRow = { href: string; match?: "exact" | "prefix" };

/**
 * The href of the row the URL points at, or undefined when none does.
 *
 * One call per sidebar over ALL of its rows, never one call per row: the
 * longest-href rule only holds when every candidate is compared together, and
 * that is what guarantees exactly one row (or none) is active. The first row is
 * never a fallback.
 */
export function useActiveRowHref(rows: readonly ActiveRow[]): string | undefined {
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  return resolveActiveRow(rows, pathname, searchParams?.toString() ?? "")?.href;
}
