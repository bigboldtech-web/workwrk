"use client";

import { useState } from "react";

/**
 * A signature or initials image drawn in a field. An unreadable data URL (a
 * truncated upload, a blocked image) falls back to the signer's name in a
 * script face, or "Signed", instead of the browser's broken-image glyph.
 */
export function SignatureImage({ src, alt, fallback }: { src: string; alt: string; fallback?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="truncate px-1 font-serif italic text-ink">{fallback || "Signed"}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} onError={() => setBroken(true)} className="max-h-full max-w-full object-contain" />;
}
