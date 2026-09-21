"use client";

/* The public read-only doc page (spec-docs-knowledge section 2,
 * /(public)/share/doc/[token]): read a doc someone shared with a link,
 * without signing in.
 *
 * No shell, no viewer, and no exit affordance by design: a client-facing
 * page opened from a link by someone who may have no account, so the
 * browser's own back is the way out. A 56px header with the four-dot mark
 * and the org name; a 720 column with the cover, icon, title, "Shared
 * read-only · Updated {date}" and the body on the same prose tokens as the
 * editor; a 44px footer "Shared from {org} with WorkwrK".
 *
 * Every non-ok answer, an unknown token included, is the one sentence
 * "This link is invalid or has been turned off." (access invariant 14).
 * This page never writes.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
// The token layer and the product stylesheet: this route is outside the
// dashboard layout, and the prose column, the skeleton pulse and the
// --os-* colours the classes below read live there.
import "@/app/(dashboard)/tokens.css";
import "@/app/(dashboard)/os.css";
import { BlockNoteCanvas, type BnDocJSON } from "@/components/docs/blocknote-canvas";
import type { Block } from "@/components/docs/block-types";
import { renderNoteIcon } from "@/components/docs/note-icon";
import { DotsArt } from "@/components/ui/dots-art";
import { LogoMark } from "@/components/brand/logo";
import { formatDate, formatDateTitle } from "@/lib/format/date";

type ShareData = {
  title: string;
  content: { bnDoc?: BnDocJSON; blocks?: Block[]; meta?: { icon?: string; coverUrl?: string; coverGradient?: string } } | null;
  updatedAt: string;
  org?: { name: string; logo: string | null } | null;
};

const LEGACY_COVER_KEY: Record<string, string> = { indigo: "hue-1", blue: "hue-1", teal: "hue-2", amber: "hue-4", pink: "hue-6", slate: "hue-7" };
function coverCss(key?: string): string {
  const k = key && LEGACY_COVER_KEY[key] ? LEGACY_COVER_KEY[key] : key;
  const n = /^hue-(\d)$/.exec(k ?? "")?.[1] ?? "1";
  return `var(--os-status-user-${n}-bg)`;
}

export default function PublicDocPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [data, setData] = useState<ShareData | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const res = await fetch(`/api/public/docs/${token}`);
        if (!res.ok) { setErr(true); return; }
        setData((await res.json()) as ShareData);
      } catch { setErr(true); }
    })();
  }, [token]);

  const orgName = data?.org?.name ?? "";
  const meta = data?.content?.meta ?? {};
  const hasCover = !!(meta.coverUrl || meta.coverGradient);

  return (
    <div className="workwrk-os os-chrome flex min-h-screen flex-col bg-raised text-ink" data-public-doc>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <LogoMark size={28} />
        {data?.org?.logo ? <img src={data.org.logo} alt="" className="h-6 w-6 rounded-md object-cover" /> : null}
        <span className="text-row font-medium text-ink">{orgName || (data ? "Shared doc" : "")}</span>
      </header>

      <main className="flex-1">
        {err ? (
          <div className="mx-auto mt-16 flex max-w-md flex-col items-center px-6 text-center">
            <DotsArt arrangement="stack" className="mb-4" />
            <p className="text-row text-ink-2">This link is invalid or has been turned off.</p>
          </div>
        ) : !data ? (
          <div className="os-prose-col flex flex-col gap-3 px-6 pt-10" aria-busy="true" aria-label="Loading">
            <span className="h-6 w-[60%] rounded bg-skeleton os-skeleton-pulse" />
            {["80%", "60%", "40%", "80%", "60%"].map((w, i) => <span key={i} className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />)}
          </div>
        ) : (
          <article className="os-prose-col px-6 pb-16 pt-6">
            {hasCover ? (
              <div className="-mx-6 mb-4 h-40 rounded-lg" style={meta.coverUrl ? { backgroundImage: `url(${meta.coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : { background: coverCss(meta.coverGradient) }} aria-hidden />
            ) : null}
            {meta.icon ? <div className={`bdoc__emoji-static mb-2 leading-none [&_svg]:h-10 [&_svg]:w-10 [&_img]:h-10 [&_img]:w-10 ${hasCover ? "-mt-9" : ""}`}>{renderNoteIcon(meta.icon)}</div> : null}
            <h1 className="text-xl font-semibold text-ink">{data.title || "Untitled doc"}</h1>
            <p className="mt-1 text-xs font-medium text-ink-2">
              Shared read-only · <span title={formatDateTitle(data.updatedAt)}>Updated {formatDate(data.updatedAt)}</span>
            </p>
            <div className="os-prose mt-6">
              <BlockNoteCanvas
                initialBnDoc={data.content?.bnDoc ?? null}
                legacyBlocks={data.content?.blocks ?? []}
                readonly
                onChange={() => {}}
              />
            </div>
          </article>
        )}
      </main>

      <footer className="flex h-11 shrink-0 items-center border-t border-line px-6 text-xs font-medium text-ink-2">
        <a href="https://workwrk.com" className="hover:text-ink hover:underline">{orgName ? `Shared from ${orgName} with WorkwrK` : "Shared with WorkwrK"}</a>
      </footer>
    </div>
  );
}
