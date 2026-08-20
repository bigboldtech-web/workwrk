"use client";

/* Public read-only doc page (no auth) — anyone with a live share link
 * opens /share/doc/[token] and reads the doc. Mirrors the /sign/[token]
 * pattern: client component, token from the URL, fetch /api/public/...,
 * no dashboard chrome. This page never issues writes — zero autosave
 * surface, zero data-integrity risk.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { BlockNoteCanvas, type BnDocJSON } from "@/components/docs/blocknote-canvas";
import type { Block } from "@/components/docs/block-editor";

type ShareData = {
  title: string;
  content: { bnDoc?: BnDocJSON; blocks?: Block[] } | null;
  updatedAt: string;
};

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

  if (err) {
    return (
      <Centered>
        <p className="text-sm text-zinc-500">This link is invalid or has been turned off.</p>
      </Centered>
    );
  }
  if (!data) {
    return (
      <Centered>
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </Centered>
    );
  }

  const content = data.content ?? {};

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto w-full max-w-[820px] px-6 py-10">
        <h1 className="text-[22px] font-bold text-zinc-900">{data.title || "Untitled note"}</h1>
        <p className="mt-1 text-[13.5px] text-zinc-500">Shared read-only</p>
        <div className="mt-6">
          <BlockNoteCanvas
            initialBnDoc={content.bnDoc ?? null}
            legacyBlocks={content.blocks ?? []}
            readonly
            onChange={() => {}}
          />
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-white p-6">{children}</div>;
}
