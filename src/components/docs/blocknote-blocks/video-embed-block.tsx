"use client";

/*
 * VideoEmbedBlock — plays a video *link* inline (BlockNote).
 *
 * BlockNote's default `video` block uses a raw <video src> tag, which only
 * plays direct files (mp4/webm/…) — paste a YouTube/Vimeo/Loom link and it
 * shows nothing. This block detects the provider and renders the right player:
 * an iframe for YouTube / Vimeo / Loom / Google Drive, a <video> for direct
 * file URLs, and a plain link as a last resort.
 *
 *   props: { url }
 *   content: "none"
 */

import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";
import { Film } from "lucide-react";

type VideoProps = { url: string };

/** Pull the src URL out of a pasted <iframe …> embed snippet (Dadan, Loom, …). */
export function extractIframeSrc(raw: string): string | null {
  const m = raw.match(/<iframe[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return m && /^https?:\/\//i.test(m[1]) ? m[1] : null;
}

/** Convert a provider URL (or pasted iframe code) into an embeddable iframe src. */
export function videoEmbedSrc(raw: string): string | null {
  // If they pasted the whole <iframe> embed code, use its src.
  const iframeSrc = extractIframeSrc(raw);
  const candidate = (iframeSrc ?? raw).trim();
  let u: URL;
  try { u = new URL(candidate); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  // YouTube (watch, short link, shorts, embed)
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (v) return `https://www.youtube.com/embed/${v}`;
    const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]+)/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
  }
  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (id) return `https://www.youtube.com/embed/${id}`;
  }
  // Vimeo
  if (host === "vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
  }
  if (host === "player.vimeo.com") return candidate;
  // Loom
  if (host === "loom.com") {
    const m = u.pathname.match(/\/(?:share|embed)\/([\w-]+)/);
    if (m) return `https://www.loom.com/embed/${m[1]}`;
  }
  // Google Drive
  if (host === "drive.google.com") {
    const m = u.pathname.match(/\/file\/d\/([\w-]+)/);
    if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  }
  // Dadan (screen recordings) — its links are already embed URLs.
  if (host === "dadan.io" || host.endsWith(".dadan.io")) return candidate;
  // Any explicit embed/player URL (embed.html, /embed/, player.*, wistia…).
  if (/embed/i.test(u.pathname) || host.startsWith("player.") || host.startsWith("fast.")) return candidate;
  // Came straight from an <iframe> the user pasted → trust it.
  if (iframeSrc) return candidate;
  return null;
}

/** True for direct video files that a <video> tag can play. */
export function isDirectVideoUrl(raw: string): boolean {
  return /\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i.test(raw.trim());
}

/** True if this URL is something we can play inline (provider or file). */
export function isPlayableVideoUrl(raw: string): boolean {
  return !!videoEmbedSrc(raw) || isDirectVideoUrl(raw);
}

export const videoEmbedBlockSpec = createReactBlockSpec(
  {
    type: "videoEmbed",
    propSchema: { url: { default: "" as string } },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const props = block.props as VideoProps;
      if (props.url) return <VideoPlayer url={props.url} />;
      return (
        <VideoInput
          editable={editor.isEditable}
          onSubmit={(url) => editor.updateBlock(block, { props: { url } })}
        />
      );
    },
  },
);

function VideoPlayer({ url }: { url: string }) {
  const src = videoEmbedSrc(url);
  if (src) {
    return (
      <div className="my-1.5 relative w-full max-w-[720px] rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
        <iframe
          src={src}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          title="Embedded video"
        />
      </div>
    );
  }
  if (isDirectVideoUrl(url)) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <video src={url} controls className="my-1.5 w-full max-w-[720px] max-h-[480px] rounded-lg bg-black" />;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-[var(--os-brand)] underline break-all">
      {url}
    </a>
  );
}

function VideoInput({ editable, onSubmit }: { editable: boolean; onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState("");
  // Accept either a bare link or a full <iframe …> embed snippet.
  const submit = () => {
    const raw = url.trim();
    if (!raw) return;
    onSubmit(extractIframeSrc(raw) ?? raw);
  };
  if (!editable) return <div className="my-1 text-sm text-zinc-400">Empty video</div>;
  return (
    <div className="my-1.5 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <Film className="w-4 h-4 text-zinc-400 shrink-0" />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) { e.preventDefault(); submit(); } }}
        placeholder="Paste a video link or embed code (YouTube, Vimeo, Loom, Dadan…)"
        className="flex-1 bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!url.trim()}
        className="text-[12.5px] font-medium text-[var(--os-brand)] disabled:opacity-40"
      >
        Embed
      </button>
    </div>
  );
}
