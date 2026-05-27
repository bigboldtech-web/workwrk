"use client";

/* Screen-recording SOP editor.
 *
 * Uses navigator.mediaDevices.getDisplayMedia + MediaRecorder to capture
 * screen (with optional mic + system audio). Records to a WebM/MP4 blob,
 * shows a preview, lets you download. The blob is base64-stored on the
 * SOP record for small clips; longer captures use the existing S3 path
 * surfaced by the optional Cashkr browser extension.
 *
 * URL: /sops/new/record?id=<sopId>
 *
 * Note: getDisplayMedia is desktop-only on Chrome/Edge/Firefox; Safari
 * support is partial. The page surfaces the support state up-front so
 * recording users aren't surprised.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Video, Circle, Square, Mic, MicOff, Download, Send, ArrowLeft, AlertTriangle } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "DRAFT" | "PUBLISHED" | "ARCHIVED" | "IN_REVIEW" | "APPROVED";
type Recording = { id: string; blob: Blob; url: string; durationSec: number; size: number; createdAt: number };

function fmtSize(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}
function fmtDur(s: number): string {
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function ScreenRecordSopEditor() {
  const router = useRouter();
  const search = useSearchParams();
  const id = search.get("id");
  const { toast } = useOsToast();

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("DRAFT");
  const [withMic, setWithMic] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [supported, setSupported] = useState<boolean>(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const startedAt = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices || !("getDisplayMedia" in navigator.mediaDevices)) {
      setSupported(false);
    }
  }, []);

  // Load SOP title (recordings aren't loaded from the server in this
  // session — only the active capture session lives in state; saved
  // recordings would be in sop.content.recordings as base64).
  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/sops/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        const sop = data.data ?? data;
        setTitle(sop.title ?? "");
        setStatus(sop.status ?? "DRAFT");
      } catch { /* ignore */ }
    })();
  }, [id]);

  const stopAll = useCallback(() => {
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  async function startRecording() {
    try {
      const displayStream = await (navigator.mediaDevices as MediaDevices).getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      } as DisplayMediaStreamOptions);
      streamsRef.current.push(displayStream);

      let combined: MediaStream = displayStream;
      if (withMic) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamsRef.current.push(micStream);
          // Merge: keep the display video + add mic audio track
          const tracks = [...displayStream.getVideoTracks(), ...displayStream.getAudioTracks(), ...micStream.getAudioTracks()];
          combined = new MediaStream(tracks);
        } catch { toast("Mic permission denied — recording without voiceover"); }
      }

      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : (MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "video/webm");
      const rec = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
      mediaRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        const url = URL.createObjectURL(blob);
        const dur = startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;
        setRecordings((r) => [...r, {
          id: Math.random().toString(36).slice(2),
          blob, url, durationSec: dur, size: blob.size, createdAt: Date.now(),
        }]);
        stopAll();
      };

      // If user clicks the browser's "Stop sharing" prompt
      displayStream.getVideoTracks()[0].onended = () => { if (rec.state !== "inactive") rec.stop(); setRecording(false); };

      rec.start(1000); // 1s chunks
      startedAt.current = Date.now();
      setElapsedSec(0);
      tickRef.current = setInterval(() => {
        if (startedAt.current) setElapsedSec((Date.now() - startedAt.current) / 1000);
      }, 250);
      setRecording(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't start recording");
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setRecording(false);
  }

  function discard(recId: string) {
    setRecordings((r) => r.filter((x) => { if (x.id !== recId) return true; URL.revokeObjectURL(x.url); return false; }));
  }
  function download(rec: Recording) {
    const a = document.createElement("a");
    a.href = rec.url; a.download = `${title || "sop"}-${rec.id}.webm`;
    a.click();
  }

  async function publish() {
    if (!id) return;
    if (recordings.length === 0) { toast("Record at least one clip first"); return; }
    // For now persist metadata only (no upload of the binary). Clips
    // remain available for download; future versions will push to S3.
    try {
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Screen recording",
          content: {
            type: "RECORDED",
            clipCount: recordings.length,
            durations: recordings.map((r) => r.durationSec),
            sizes: recordings.map((r) => r.size),
          },
          status: "PUBLISHED",
        }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      setStatus("PUBLISHED");
      toast("SOP published. Don't forget to download clips you want to share.");
    } catch { toast("Couldn't publish"); }
  }

  useEffect(() => () => { stopAll(); recordings.forEach((r) => URL.revokeObjectURL(r.url)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!id) return <div className="sop-edit__error">Missing SOP id. <a href="/sops">Back to SOPs</a></div>;
  if (!supported) {
    return (
      <div className="rec">
        <div className="rec__unsupported">
          <AlertTriangle />
          <div>
            <h3>Screen recording isn&apos;t supported in this browser</h3>
            <p>Try Chrome, Edge, or Firefox on desktop. Mobile and Safari have limited / partial support for getDisplayMedia.</p>
            <button type="button" onClick={() => router.push("/sops")} className="rec__back-btn">Back to SOPs</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rec">
      <header className="rec__head">
        <div className="rec__head-l">
          <button type="button" className="sop-edit__back" onClick={() => router.push("/sops")} aria-label="Back"><ArrowLeft /></button>
          <div className="sop-edit__type"><Video /> Screen recording</div>
          {recording && <span className="rec__live"><span className="rec__live-dot" /> Live · {fmtDur(elapsedSec)}</span>}
        </div>
        <div className="sop-edit__actions">
          {status !== "PUBLISHED" && (
            <button type="button" onClick={publish} className="sop-edit__btn sop-edit__btn--primary" disabled={recordings.length === 0}>
              <Send /> Publish
            </button>
          )}
          {status === "PUBLISHED" && <span className="sop-edit__pub">Published</span>}
        </div>
      </header>

      <input type="text" className="sop-edit__title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What does this SOP show?" />

      <div className="rec__stage">
        {!recording ? (
          <>
            <button type="button" className="rec__big-btn" onClick={startRecording}>
              <Circle /> <span>Start recording</span>
            </button>
            <label className="rec__mic">
              <input type="checkbox" checked={withMic} onChange={(e) => setWithMic(e.target.checked)} />
              {withMic ? <Mic /> : <MicOff />} <span>Include mic voiceover</span>
            </label>
            <p className="rec__note">When you click Start, your browser will ask which window or screen to share. Choose carefully — anything you show will be recorded.</p>
          </>
        ) : (
          <button type="button" className="rec__big-btn rec__big-btn--stop" onClick={stopRecording}>
            <Square /> <span>Stop recording</span>
          </button>
        )}
      </div>

      {recordings.length > 0 && (
        <section className="rec__clips">
          <h2>Clips · {recordings.length}</h2>
          {recordings.map((r, i) => (
            <article key={r.id} className="rec__clip">
              <header>
                <strong>Clip {i + 1}</strong>
                <span>{fmtDur(r.durationSec)} · {fmtSize(r.size)}</span>
              </header>
              <video src={r.url} controls preload="metadata" />
              <footer>
                <button type="button" onClick={() => download(r)} className="rec__clip-btn"><Download /> Download</button>
                <button type="button" onClick={() => discard(r.id)} className="rec__clip-btn rec__clip-btn--danger">Discard</button>
              </footer>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
