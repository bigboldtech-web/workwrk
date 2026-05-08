"use client";

// Mobile-friendly clock-in screen. Big targets, tap-to-punch, captures
// geolocation if the user grants it (stored on the TimeEntry as a
// note for now — full geo-fence enforcement is a follow-up).
//
// Talks to the existing /api/time-entries/punch endpoint so the
// data flows into the same Timesheets that managers approve.

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Play, Square, Clock, MapPin } from "lucide-react";

type Active = {
  id: string;
  clockedInAt: string;
  description: string | null;
  task: { id: string; title: string } | null;
};

function fmtElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function ClockPage() {
  const { toast } = useToast();
  const [active, setActive] = useState<Active | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracyM: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/time-entries/punch");
      if (res.ok) {
        const data = await res.json();
        setActive(data?.active ?? null);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live timer for active punch.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Capture geolocation once on mount. Permission is asked in-place;
  // a denial is not fatal — we just skip the location field.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
      }),
      (err) => setGeoError(err.message),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  async function startPunch() {
    setBusy(true);
    try {
      const note = geo ? `geo:${geo.lat.toFixed(5)},${geo.lng.toFixed(5)}±${Math.round(geo.accuracyM)}m` : null;
      const res = await fetch("/api/time-entries/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", description: note }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't clock in", description: data?.error });
        return;
      }
      setActive(data?.active ?? null);
      toast({ type: "success", title: "Clocked in" });
    } finally { setBusy(false); }
  }

  async function stopPunch() {
    setBusy(true);
    try {
      const res = await fetch("/api/time-entries/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't clock out", description: data?.error });
        return;
      }
      setActive(null);
      toast({ type: "success", title: `Logged ${data?.closed?.hours ?? "—"}h` });
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center justify-center gap-2">
          <Clock size={20} /> Clock
        </h1>
        <p className="text-muted text-sm mt-2">Tap to punch in or out.</p>
      </div>

      {loading ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted">Loading…</CardContent></Card>
      ) : active ? (
        <Card>
          <CardContent className="p-6 text-center">
            <div className="text-xs uppercase tracking-widest text-emerald-500 mb-2 flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Clocked in
            </div>
            <div className="text-5xl font-mono font-bold tabular-nums my-4">
              {fmtElapsed((now - new Date(active.clockedInAt).getTime()) / 1000)}
            </div>
            <div className="text-xs text-muted mb-4">
              Started {new Date(active.clockedInAt).toLocaleTimeString()}
              {active.task && <> · {active.task.title}</>}
            </div>
            <Button
              onClick={stopPunch}
              disabled={busy}
              variant="outline"
              className="h-14 text-base px-8 text-red-400 w-full"
            >
              <Square size={18} className="mr-2" /> Stop
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 text-center">
            <div className="text-xs uppercase tracking-widest text-muted mb-4">Not clocked in</div>
            <Button onClick={startPunch} disabled={busy} className="h-14 text-base px-8 w-full">
              <Play size={18} className="mr-2" /> Clock in
            </Button>
            {geo && (
              <div className="text-[11px] text-muted mt-3 flex items-center justify-center gap-1">
                <MapPin size={11} /> Location captured · ±{Math.round(geo.accuracyM)}m
              </div>
            )}
            {!geo && geoError && (
              <div className="text-[11px] text-muted mt-3">
                Location not captured ({geoError}). You can still clock in.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
