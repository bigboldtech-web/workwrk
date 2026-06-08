"use client";

/*
 * BookmarkBlock — Notion-style web bookmark card for BlockNote.
 *
 *   props: { url, title, description, image, favicon, siteName }
 *   content: "none"
 *
 * Unconfigured (empty url): a paste-a-link input. On submit we unfurl via
 * /api/link-preview and write the metadata back to the block's props.
 * Configured: a rich card linking out to the URL in a new tab.
 */

import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";

type BookmarkProps = {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
};

export const bookmarkBlockSpec = createReactBlockSpec(
  {
    type: "bookmark",
    propSchema: {
      url: { default: "" as string },
      title: { default: "" as string },
      description: { default: "" as string },
      image: { default: "" as string },
      favicon: { default: "" as string },
      siteName: { default: "" as string },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const props = block.props as BookmarkProps;
      if (props.url) {
        return <BookmarkCard {...props} />;
      }
      return (
        <BookmarkInput
          editable={editor.isEditable}
          onResolved={(next) => editor.updateBlock(block, { props: next })}
        />
      );
    },
  },
);

// ───────── Configured card ─────────

function BookmarkCard({ url, title, description, image, favicon, siteName }: BookmarkProps) {
  return (
    <a
      className="bn-bookmark"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      contentEditable={false}
    >
      <div className="bn-bookmark__body">
        <div className="bn-bookmark__title">{title || url}</div>
        {description && <div className="bn-bookmark__desc">{description}</div>}
        <div className="bn-bookmark__foot">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="bn-bookmark__favicon" src={favicon} alt="" />
          ) : (
            <Link2 className="bn-bookmark__favicon" />
          )}
          <span className="bn-bookmark__host">{siteName || hostOf(url)}</span>
        </div>
      </div>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="bn-bookmark__thumb" src={image} alt="" />
      )}
    </a>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// ───────── Unconfigured input ─────────

function BookmarkInput({
  editable,
  onResolved,
}: {
  editable: boolean;
  onResolved: (props: BookmarkProps) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function resolve() {
    let url = value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      const p = (d.data ?? d) as Partial<BookmarkProps>;
      onResolved({
        url: p.url ?? url,
        title: p.title ?? url,
        description: p.description ?? "",
        image: p.image ?? "",
        favicon: p.favicon ?? "",
        siteName: p.siteName ?? "",
      });
    } catch {
      setErr("Couldn't fetch that link. Check the URL and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bn-bookmark bn-bookmark--input" contentEditable={false}>
      <div className="bn-bookmark__input-row">
        <Link2 className="bn-bookmark__input-icon" />
        <input
          type="url"
          placeholder="Paste a link to create a bookmark…"
          value={value}
          autoFocus
          disabled={!editable || busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolve(); } }}
        />
        <button type="button" disabled={!editable || busy || !value.trim()} onClick={() => void resolve()}>
          {busy ? <Loader2 className="bn-bookmark__spin" /> : "Create"}
        </button>
      </div>
      {err && <div className="bn-bookmark__err">{err}</div>}
    </div>
  );
}
