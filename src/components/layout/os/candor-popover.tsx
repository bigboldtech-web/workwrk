"use client";

/* Topbar Candor popover.
 * Shows ACTIVE anonymous-feedback sessions visible to the user. Each
 * row is a click-through to /candor/[sessionId] (or /candor) to respond.
 * The whole point of Candor is anonymity; we never let the popover hint
 * who answered what.
 *
 * GET /api/candor   (returns enriched sessions with responseCount)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare, X, ShieldCheck } from "lucide-react";

type ApiSession = {
  id: string;
  title: string;
  description?: string | null;
  status: "DRAFT" | "ACTIVE" | "CLOSED";
  responseCount?: number;
  launchedAt?: string | null;
};

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just launched";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}

export function OsCandorPopover({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<ApiSession[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/candor");
      if (!res.ok) return setSessions([]);
      const data = await res.json();
      const list: ApiSession[] = data.data ?? (Array.isArray(data) ? data : []);
      setSessions(list.filter((s) => s.status === "ACTIVE"));
    } catch { setSessions([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="candor-pop" role="dialog" aria-label="Candor sessions">
      <header className="candor-pop__head">
        <span><MessageSquare /> Candor — anonymous feedback</span>
        <button type="button" onClick={onClose} aria-label="Close"><X /></button>
      </header>
      <div className="candor-pop__shield">
        <ShieldCheck /> <span>Your responses are not linked to your account. Ever.</span>
      </div>

      <div className="candor-pop__list">
        {sessions === null ? (
          <div className="candor-pop__empty">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="candor-pop__empty">
            <p>No active Candor sessions for you right now.</p>
            <small>When your manager launches one, it shows up here so you can respond anonymously.</small>
          </div>
        ) : sessions.map((s) => (
          <Link key={s.id} href="/candor" className="candor-pop__item" onClick={onClose}>
            <div className="candor-pop__item-main">
              <div className="candor-pop__item-title">{s.title}</div>
              {s.description ? <p className="candor-pop__item-desc">{s.description}</p> : null}
              <div className="candor-pop__item-meta">
                <span>{timeAgo(s.launchedAt)}</span>
                {(s.responseCount ?? 0) > 0 && <span>· {s.responseCount} response{s.responseCount === 1 ? "" : "s"} so far</span>}
              </div>
            </div>
            <span className="candor-pop__item-cta">Respond →</span>
          </Link>
        ))}
      </div>

      <footer className="candor-pop__foot">
        <Link href="/candor" className="candor-pop__link" onClick={onClose}>Browse all sessions →</Link>
      </footer>
    </div>
  );
}
