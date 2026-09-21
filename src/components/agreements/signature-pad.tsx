"use client";

// SignaturePad (spec-process section 3): the Signature pad modal (560) of the
// public signing page. A 32px segmented control Draw · Type; Draw = a 600×200
// canvas with a "Clear" text link; Type = an input "Type your name" with a
// preview in a script face; footer Cancel / the one blue "Apply". Returns a
// PNG data URL either way, so the field and the evidence row carry one shape.

import { useCallback, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";

const SCRIPT_FACE = "'Brush Script MT', 'Snell Roundhand', 'Segoe Script', cursive";

export function SignaturePad({ open, kind = "signature", onDone, onCancel }: {
  open: boolean;
  kind?: "signature" | "initials";
  onDone: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [drawn, setDrawn] = useState(false);
  const [tab, setTab] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) { setSeenOpen(open); if (open) { setTab("draw"); setTyped(""); setDrawn(false); } }

  const ctx = useCallback(() => {
    const c = canvasRef.current; if (!c) return null;
    const g = c.getContext("2d"); if (!g) return null;
    g.lineWidth = 2.5; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#111827";
    return g;
  }, []);
  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function down(e: React.PointerEvent) { const g = ctx(); if (!g) return; (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId); drawing.current = true; setDrawn(true); const p = pos(e); g.beginPath(); g.moveTo(p.x, p.y); }
  function move(e: React.PointerEvent) { if (!drawing.current) return; const g = ctx(); if (!g) return; const p = pos(e); g.lineTo(p.x, p.y); g.stroke(); }
  function up() { drawing.current = false; }
  function clear() { const c = canvasRef.current, g = ctx(); if (c && g) g.clearRect(0, 0, c.width, c.height); setDrawn(false); }

  function apply() {
    if (tab === "type") {
      if (!typed.trim()) return;
      const c = document.createElement("canvas"); c.width = 600; c.height = 200;
      const g = c.getContext("2d")!;
      g.fillStyle = "#111827"; g.textBaseline = "middle"; g.font = `${kind === "initials" ? 96 : 64}px ${SCRIPT_FACE}`;
      g.fillText(typed.trim(), 24, 100);
      onDone(c.toDataURL("image/png"));
      return;
    }
    if (!drawn || !canvasRef.current) return;
    onDone(canvasRef.current.toDataURL("image/png"));
  }
  const canApply = tab === "type" ? typed.trim().length > 0 : drawn;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>{kind === "initials" ? "Add your initials" : "Add your signature"}</DialogTitle>
        <DialogDescription>Draw it, or type your name and use the script version.</DialogDescription>
        <div className="mt-2 flex flex-col gap-3">
          <SegmentedControl<"draw" | "type"> label="Signature style" value={tab} onChange={setTab} options={[{ value: "draw", label: "Draw" }, { value: "type", label: "Type" }]} />
          {tab === "draw" ? (
            <div className="flex flex-col gap-2">
              <canvas ref={canvasRef} width={600} height={200} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                className="aspect-[3/1] w-full cursor-crosshair touch-none rounded-md border border-line-strong bg-raised" aria-label="Signature canvas" />
              <button type="button" onClick={clear} className="self-start text-sm font-medium text-ink-2 hover:text-ink">Clear</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={kind === "initials" ? "Type your initials" : "Type your name"} autoFocus aria-label={kind === "initials" ? "Type your initials" : "Type your name"} className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" />
              <div className="flex h-[120px] items-center justify-center rounded-md border border-line bg-subtle text-3xl text-ink" style={{ fontFamily: SCRIPT_FACE }} aria-live="polite">{typed || <span className="text-base text-ink-3" style={{ fontFamily: "inherit" }}>Preview</span>}</div>
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={apply} disabled={!canApply} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">Apply</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
