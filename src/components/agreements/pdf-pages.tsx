"use client";

/* Renders every page of a PDF to a canvas at a fixed display width, and lets a
 * caller overlay content (field boxes, drop targets) on each page via the
 * `renderPage` render-prop. The fixed width means page pixel dimensions are
 * deterministic, so field coordinates round-trip between builder and signer.
 */

import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

// Worker from CDN matching the installed version (avoids Turbopack worker-bundling friction).
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

export type PageDims = { w: number; h: number };

export function PdfPages({
  url, width = 760, renderPage,
}: {
  url: string;
  width?: number;
  renderPage?: (pageIndex: number, dims: PageDims) => React.ReactNode;
}) {
  const [dims, setDims] = useState<PageDims[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    canvasRefs.current = [];
    (async () => {
      setDims([]); setErr(null);
      try {
        const doc = await pdfjsLib.getDocument({ url }).promise;
        const out: PageDims[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const vp = page.getViewport({ scale });
          out.push({ w: Math.round(vp.width), h: Math.round(vp.height) });
        }
        if (cancelled) return;
        setDims(out);
        // Second pass: canvases now exist in the DOM — paint each page.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const vp = page.getViewport({ scale });
          const canvas = canvasRefs.current[i - 1];
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) continue;
          canvas.width = vp.width;
          canvas.height = vp.height;
          await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        }
      } catch {
        if (!cancelled) setErr("Couldn't render this PDF.");
      }
    })();
    return () => { cancelled = true; };
  }, [url, width]);

  if (err) return <div className="mx-auto max-w-[760px] rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{err}</div>;
  if (dims.length === 0) return <div className="flex items-center justify-center py-16 text-sm text-zinc-400">Rendering PDF…</div>;

  return (
    <div className="space-y-4">
      {dims.map((d, i) => (
        <div key={i} className="relative mx-auto overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm" style={{ width: d.w, height: d.h }}>
          <canvas ref={(el) => { canvasRefs.current[i] = el; }} className="block" style={{ width: d.w, height: d.h }} />
          {renderPage ? <div className="absolute inset-0">{renderPage(i, d)}</div> : null}
        </div>
      ))}
    </div>
  );
}
