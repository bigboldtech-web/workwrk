"use client";

/* Renders every page of a PDF to a canvas at a fixed display width, and lets a
 * caller overlay content (field boxes, drop targets) on each page via the
 * `renderPage` render-prop. The fixed width means page pixel dimensions are
 * deterministic, so field coordinates round-trip between builder and signer.
 */

import { useEffect, useRef, useState } from "react";
import { SkeletonLines } from "@/components/ui/skeleton";

// pdfjs-dist is loaded INSIDE the effect, never at module scope: its display
// layer evaluates `new DOMMatrix()` on import, which does not exist on the
// server, so a top-level import made the server render of every page that
// imports this file throw (the public /sign/[token] answered HTTP 500 for
// every token, including the 404 cases, and logged a React console error on
// the client). The worker comes from the CDN matching the installed version
// (avoids Turbopack worker-bundling friction).
type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsPromise;
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
        const pdfjsLib = await loadPdfJs();
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

  if (err) return <div role="alert" className="mx-auto max-w-[760px] rounded-md border border-line bg-danger-soft px-3 py-2 text-base text-danger-text">{err}</div>;
  if (dims.length === 0) return <div className="mx-auto max-w-[760px] rounded-lg border border-line bg-raised px-10 py-7" style={{ width }}><SkeletonLines lines={8} /></div>;

  return (
    <div className="space-y-4">
      {dims.map((d, i) => (
        <div key={i} className="relative mx-auto overflow-hidden rounded-lg border border-line bg-raised" style={{ width: d.w, height: d.h }}>
          <canvas ref={(el) => { canvasRefs.current[i] = el; }} className="block" style={{ width: d.w, height: d.h }} />
          {renderPage ? <div className="absolute inset-0">{renderPage(i, d)}</div> : null}
        </div>
      ))}
    </div>
  );
}
