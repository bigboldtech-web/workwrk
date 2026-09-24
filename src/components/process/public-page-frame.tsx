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
import { LogoMark } from "@/components/brand/logo";

export interface PublicOrg {
  name: string;
  logo?: string | null;
}

export function PublicPageFrame({ org, label, right, children, footer, width = 720, brand = false }: {
  org: PublicOrg | null | undefined;
  /** "Run", "Shared SOP", "Sent by Anita". */
  label: string;
  /** Optional element at the right of the strip instead of the plain label. */
  right?: React.ReactNode;
  children: React.ReactNode;
  /** Defaults to "Shared from {org} · WorkwrK". */
  footer?: React.ReactNode;
  /** The content column. 640 is the form responder's (spec-tables-forms
   *  /forms/[id]/respond); every other public page keeps 720. */
  width?: 640 | 720;
  /** The strip carries the WorkwrK four dots and wordmark instead of an org
   *  tile and name: the responder never names the org to a stranger. */
  brand?: boolean;
}) {
  const name = org?.name?.trim() || "WorkwrK";
  const col = width === 640 ? "max-w-[640px]" : "max-w-[720px]";
  return (
    <div className="os-chrome min-h-screen bg-app text-ink">
      <header className="flex h-14 items-center gap-3 border-b border-line bg-raised px-4 sm:px-6">
        {brand ? (
          <>
            <LogoMark size={24} />
            <span className="min-w-0 flex-1 truncate text-row font-semibold">WorkwrK</span>
          </>
        ) : (
          <>
            <EntityTile size="sm" icon={org?.logo ?? null} name={name} fallback="folder" />
            <span className="min-w-0 flex-1 truncate text-row font-medium">{name}</span>
          </>
        )}
        {right ?? <span className="shrink-0 text-sm text-ink-2">{label}</span>}
      </header>
      {/* box-content: the 720 is the CONTENT column, and the 16 / 24px padding
          sits outside it, so a 720-wide document card is never clipped. */}
      <main className={`mx-auto box-content ${col} px-4 pb-24 sm:px-6 ${width === 640 ? "pt-12" : "pt-8"}`}>{children}</main>
      <footer className={`mx-auto box-content ${col} px-4 pb-10 text-xs text-ink-3 sm:px-6`}>
        {footer ?? <>Shared from {name} · WorkwrK</>}
      </footer>
    </div>
  );
}
