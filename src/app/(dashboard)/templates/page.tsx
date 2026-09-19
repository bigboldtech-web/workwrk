// /templates: start something from a template instead of from blank.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/templates).
//
// WHAT THIS REPLACES. The route existed and held the wrong thing: a 109-line
// client page over `/api/workspace-templates` with gradient card heads, a
// button reading "Applied - apply again?", a hint pointing at three raw paths,
// and a catch that turned every failure into the sentence "No templates
// configured." The real Template Center was a modal with no full-size home, so
// the product had six things called Templates and this URL led to the one that
// knew the least.
//
// NOTHING DISAPPEARS. The workspace bundles that page listed are the "Starter
// kits" kind of this one, applied through the same POST
// /api/workspace-templates/apply. Every "Browse templates" menu row across the
// product opens this same component as a modal scoped to a kind.
//
// The server half is the gate plus the stored view options the first paint
// needs; `?kind=` is read here so a link can scope the page.

import { gatePage } from "@/lib/access/gate";
import { getEffectivePreferences } from "@/lib/preferences";
import { kindFromParam } from "@/lib/templates/kinds";
import { TemplatesClient } from "./templates-client";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string }>;
}) {
  // The `templates` app key (access section 5.2.1 plus spec-spaces-lists
  // section 1's one added row): every Member, Guests never. gatePage 404s a
  // Guest in the shell, which is the same answer their missing sidebar row
  // gives, so no row ever leads somewhere that denies.
  const { viewer } = await gatePage("view", { type: "app", key: "templates" }, { callbackUrl: "/templates" });

  const sp = await searchParams;
  const prefs = await getEffectivePreferences(viewer.userId, viewer.organizationId).catch(() => null);
  const work = (prefs?.home?.work ?? {}) as { surface?: Record<string, unknown> };
  const stored = (work.surface?.templates ?? {}) as { viewOptions?: { showBuiltIn?: unknown; layout?: unknown } };

  return (
    <TemplatesClient
      initialKind={kindFromParam(sp.kind)}
      // `?q=` is part of this route's contract (spec-spaces-lists section 0)
      // and was declared here and then dropped, so /templates?q=ideas (where
      // spec-work-home lands /ideas) showed the whole unfiltered library.
      initialQuery={(sp.q ?? "").trim()}
      initialShowBuiltIn={stored.viewOptions?.showBuiltIn !== false}
      initialLayout={stored.viewOptions?.layout === "list" ? "list" : "grid"}
    />
  );
}
