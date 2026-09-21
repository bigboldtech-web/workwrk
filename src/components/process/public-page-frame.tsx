// PublicPageFrame (spec-process section 3): the 56px org strip, the 720
// column and the footer shared by the three public token pages (/run,
// /share/sop, /sign). No shell, no rail, no back affordance; the org name in
// the strip is not a link. Server-safe: no hooks, so the server-rendered
// public SOP page can use it directly.
//
// The token layer and the product stylesheet are imported HERE, once for the
// three public pages: these routes sit outside the dashboard layout, and
// without them every --os-* utility (bg-brand, border-line, text-ink, the
// skeleton pulse, the saving dot) resolves to transparent or the browser
// default. /share/doc/[token] does the same import for the same reason.

import "@/app/(dashboard)/tokens.css";
import "@/app/(dashboard)/os.css";
import { EntityTile } from "@/components/ui/entity-tile";

export interface PublicOrg {
  name: string;
  logo?: string | null;
}

export function PublicPageFrame({ org, label, right, children, footer }: {
  org: PublicOrg | null | undefined;
  /** "Run", "Shared SOP", "Sent by Anita". */
  label: string;
  /** Optional element at the right of the strip instead of the plain label. */
  right?: React.ReactNode;
  children: React.ReactNode;
  /** Defaults to "Shared from {org} · WorkwrK". */
  footer?: React.ReactNode;
}) {
  const name = org?.name?.trim() || "WorkwrK";
  return (
    <div className="os-chrome min-h-screen bg-app text-ink">
      <header className="flex h-14 items-center gap-3 border-b border-line bg-raised px-4 sm:px-6">
        <EntityTile size="sm" icon={org?.logo ?? null} name={name} fallback="folder" />
        <span className="min-w-0 flex-1 truncate text-row font-medium">{name}</span>
        {right ?? <span className="shrink-0 text-sm text-ink-2">{label}</span>}
      </header>
      {/* box-content: the 720 is the CONTENT column, and the 16 / 24px padding
          sits outside it, so a 720-wide document card is never clipped. */}
      <main className="mx-auto box-content max-w-[720px] px-4 pb-24 pt-8 sm:px-6">{children}</main>
      <footer className="mx-auto box-content max-w-[720px] px-4 pb-10 text-xs text-ink-3 sm:px-6">
        {footer ?? <>Shared from {name} · WorkwrK</>}
      </footer>
    </div>
  );
}
