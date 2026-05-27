"use client";

/* Topbar Kudos popover. Two-state UI:
 *   1. Compose — pick a teammate, write a short note, pick a company value
 *   2. Recent — show the last 6 kudos the user has given OR received
 *
 * POST /api/kudos               { receiverId, message, companyValue?, isPublic? }
 * GET  /api/kudos?limit=6       org-wide recent feed (fallback)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Heart, X, Search, Sparkles } from "lucide-react";
import { useOsToast } from "./toast";

type ApiUser = { id: string; firstName?: string | null; lastName?: string | null };
type ApiKudo = {
  id: string;
  message: string;
  companyValue?: string | null;
  createdAt: string;
  giver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  receiver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const VALUES = ["Customer obsession", "Bias for action", "Care deeply", "Be bold", "Tell it like it is"];
const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

export function OsKudosPopover({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"compose" | "recent">("compose");
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [recent, setRecent] = useState<ApiKudo[] | null>(null);
  const [search, setSearch] = useState("");
  const [pickedUser, setPickedUser] = useState<ApiUser | null>(null);
  const [message, setMessage] = useState("");
  const [value, setValue] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const { toast } = useOsToast();

  // Load users + recent kudos in parallel
  const load = useCallback(async () => {
    try {
      const [uRes, kRes] = await Promise.all([
        fetch("/api/users?limit=200"),
        fetch("/api/kudos?limit=6"),
      ]);
      if (uRes.ok) {
        const j = await uRes.json();
        const list: ApiUser[] = j?.data?.items ?? j?.data ?? (Array.isArray(j) ? j : []);
        setUsers(list);
      }
      if (kRes.ok) {
        const j = await kRes.json();
        setRecent(j?.data?.items ?? j?.data ?? (Array.isArray(j) ? j : []));
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = search.trim()
    ? users.filter((u) => `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8)
    : users.slice(0, 8);

  async function submit() {
    if (!pickedUser || !message.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/kudos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverId: pickedUser.id,
          message: message.trim(),
          companyValue: value || undefined,
          isPublic: true,
        }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast(`Kudos sent to ${pickedUser.firstName}`);
      setPickedUser(null); setMessage(""); setValue(""); setSearch("");
      setTab("recent"); void load();
    } catch { toast("Couldn't send kudos"); }
    finally { setBusy(false); }
  }

  return (
    <div className="kudos-pop" role="dialog" aria-label="Give kudos">
      <header className="kudos-pop__head">
        <span><Heart /> Kudos</span>
        <button type="button" onClick={onClose} aria-label="Close"><X /></button>
      </header>
      <div className="kudos-pop__tabs">
        <button type="button" className={tab === "compose" ? "is-active" : ""} onClick={() => setTab("compose")}>Give kudos</button>
        <button type="button" className={tab === "recent" ? "is-active" : ""} onClick={() => setTab("recent")}>Recent</button>
      </div>

      {tab === "compose" ? (
        <div className="kudos-pop__compose">
          {pickedUser ? (
            <div className="kudos-pop__chosen">
              <span className="kudos-pop__chosen-av" style={{ background: avColor(pickedUser.id) }}>{initials(pickedUser.firstName, pickedUser.lastName)}</span>
              <span className="kudos-pop__chosen-name">{[pickedUser.firstName, pickedUser.lastName].filter(Boolean).join(" ")}</span>
              <button type="button" onClick={() => setPickedUser(null)}>Change</button>
            </div>
          ) : (
            <>
              <div className="kudos-pop__search"><Search /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pick a teammate…" autoFocus /></div>
              <div className="kudos-pop__people">
                {filtered.map((u) => (
                  <button key={u.id} type="button" className="kudos-pop__person" onClick={() => setPickedUser(u)}>
                    <span className="kudos-pop__person-av" style={{ background: avColor(u.id) }}>{initials(u.firstName, u.lastName)}</span>
                    <span>{[u.firstName, u.lastName].filter(Boolean).join(" ")}</span>
                  </button>
                ))}
                {filtered.length === 0 && <div className="kudos-pop__empty">No one matches.</div>}
              </div>
            </>
          )}

          <textarea
            className="kudos-pop__note"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={pickedUser ? `Tell ${pickedUser.firstName} what they did…` : "Why are you giving kudos?"}
            rows={3}
            maxLength={500}
          />

          <div className="kudos-pop__values">
            {VALUES.map((v) => (
              <button key={v} type="button" className={value === v ? "is-active" : ""} onClick={() => setValue(value === v ? "" : v)}>{v}</button>
            ))}
          </div>

          <footer className="kudos-pop__foot">
            <Link href="/kudos" className="kudos-pop__link">See all kudos →</Link>
            <button type="button" className="kudos-pop__send" disabled={!pickedUser || !message.trim() || busy} onClick={submit}>
              <Sparkles /> {busy ? "Sending…" : "Send kudos"}
            </button>
          </footer>
        </div>
      ) : (
        <div className="kudos-pop__recent">
          {recent === null ? (
            <div className="kudos-pop__empty">Loading…</div>
          ) : recent.length === 0 ? (
            <div className="kudos-pop__empty">No kudos yet. Be the first to recognise someone!</div>
          ) : recent.map((k) => (
            <div key={k.id} className="kudos-pop__item">
              <span className="kudos-pop__item-av" style={{ background: avColor(k.giver?.id ?? k.id) }}>{initials(k.giver?.firstName, k.giver?.lastName)}</span>
              <div className="kudos-pop__item-body">
                <div className="kudos-pop__item-head">
                  <strong>{[k.giver?.firstName, k.giver?.lastName].filter(Boolean).join(" ")}</strong>
                  <span> → </span>
                  <strong>{[k.receiver?.firstName, k.receiver?.lastName].filter(Boolean).join(" ")}</strong>
                </div>
                <p className="kudos-pop__item-msg">{k.message}</p>
                {k.companyValue && <span className="kudos-pop__item-val">{k.companyValue}</span>}
              </div>
            </div>
          ))}
          <Link href="/kudos" className="kudos-pop__link kudos-pop__link--center">See all kudos →</Link>
        </div>
      )}
    </div>
  );
}
