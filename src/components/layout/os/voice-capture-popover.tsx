"use client";

// VoiceCapturePopover — on-device voice-to-text using the browser Web Speech
// API. Opened from the topbar "Voice to text" quick-tool (workwrk:tool event,
// detail "voice"). Records, transcribes live, and on stop offers Copy text /
// Retry. Copy writes the transcript to the clipboard.

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, X, Copy, RotateCcw, Square } from "lucide-react";
import { useOsToast } from "./toast";

/* Minimal typing for the non-standard SpeechRecognition API. */
interface SREvent { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }
interface SR { continuous: boolean; interimResults: boolean; lang: string; onresult: (e: SREvent) => void; onend: () => void; onerror: (e: unknown) => void; start: () => void; stop: () => void }

function getSR(): (new () => SR) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceCapturePopover() {
  const { toast } = useOsToast();
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const recRef = useRef<SR | null>(null);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    setRecording(false);
  }, []);

  const start = useCallback(() => {
    const SRClass = getSR();
    if (!SRClass) { toast("Voice input is not supported in this browser"); return; }
    setFinalText(""); setInterim("");
    const rec = new SRClass();
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    rec.onresult = (e: SREvent) => {
      let interimStr = "";
      let finalStr = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalStr += r[0].transcript;
        else interimStr += r[0].transcript;
      }
      if (finalStr) setFinalText((prev) => (prev ? prev + " " : "") + finalStr.trim());
      setInterim(interimStr);
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => { setRecording(false); };
    recRef.current = rec;
    try { rec.start(); setRecording(true); setOpen(true); }
    catch { toast("Couldn't start the microphone"); }
  }, [toast]);

  useEffect(() => {
    function onTool(e: Event) { if ((e as CustomEvent).detail === "voice") start(); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { stop(); setOpen(false); } }
    window.addEventListener("workwrk:tool", onTool as EventListener);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("workwrk:tool", onTool as EventListener);
      window.removeEventListener("keydown", onKey);
    };
  }, [start, stop]);

  if (!open) return null;
  const text = (finalText + (interim ? " " + interim : "")).trim();

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
    catch { toast("Couldn't copy"); }
  }

  return (
    <div className="fixed top-12 right-4 z-[95] w-[360px] max-w-[92vw] rounded-xl bg-white dark:bg-[#181C22] border border-zinc-200 dark:border-[#2A2F38] shadow-2xl">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-zinc-100 dark:border-[#2A2F38]">
        <span className={`relative flex h-2.5 w-2.5 ${recording ? "" : "opacity-40"}`}>
          {recording ? <span className="absolute inline-flex h-full w-full rounded-full bg-[#FB5A6F] opacity-70 animate-ping" /> : null}
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#FB5A6F]" />
        </span>
        <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100 flex-1">{recording ? "Listening…" : "Voice to text"}</div>
        <button type="button" onClick={() => { stop(); setOpen(false); }} className="w-7 h-7 rounded-full hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center text-zinc-500 dark:text-zinc-400" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>

      <div className="p-4">
        <div className="min-h-[88px] max-h-[200px] overflow-y-auto rounded-lg border border-zinc-200 dark:border-[#2A2F38] bg-zinc-50 dark:bg-[#14171D] px-3 py-2.5 text-[13.5px] leading-relaxed text-zinc-800 dark:text-zinc-100">
          {text ? text : <span className="text-zinc-400 dark:text-zinc-500">{recording ? "Speak now…" : "No speech captured."}</span>}
        </div>

        <div className="mt-3 flex items-center gap-2">
          {recording ? (
            <button type="button" onClick={stop} className="flex-1 h-9 rounded-md bg-[#FB5A6F] text-white text-[13px] font-medium inline-flex items-center justify-center gap-1.5 hover:opacity-90">
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          ) : (
            <>
              <button type="button" onClick={() => void copy()} disabled={!text} className="flex-1 h-9 rounded-md bg-[#0073EA] text-white text-[13px] font-medium inline-flex items-center justify-center gap-1.5 hover:bg-[#0060B9] disabled:opacity-40">
                <Copy className="w-3.5 h-3.5" /> Copy text
              </button>
              <button type="button" onClick={start} className="h-9 px-3 rounded-md border border-zinc-200 dark:border-[#2A2F38] text-zinc-700 dark:text-zinc-200 text-[13px] inline-flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-white/10">
                <RotateCcw className="w-3.5 h-3.5" /> Retry
              </button>
            </>
          )}
        </div>
        {!recording && !text ? (
          <button type="button" onClick={start} className="mt-2 w-full h-9 rounded-md border border-dashed border-zinc-300 dark:border-[#2A2F38] text-zinc-600 dark:text-zinc-300 text-[13px] inline-flex items-center justify-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-white/10">
            <Mic className="w-3.5 h-3.5" /> Start again
          </button>
        ) : null}
      </div>
    </div>
  );
}
