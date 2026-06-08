"use client";

/*
 * NoteIconPicker — Notion-style icon picker for a doc's icon.
 *
 * Three tabs:
 *   - Emoji:  full searchable emoji set (from @emoji-mart/data) with Recent +
 *             per-category sections and a bottom category jump bar; a Random
 *             button picks one at random.
 *   - Icons:  a curated grid of lucide icons (stored as "lucide:<Name>").
 *   - Upload: upload an image to use as the icon (stored as its URL).
 *
 * The chosen value is one of:
 *   - an emoji native string ("💡")
 *   - "lucide:<Name>"  (rendered via the icon map below)
 *   - an "http(s)://…" image URL
 * Use `renderNoteIcon(value)` anywhere a doc icon needs to be displayed.
 */

import emojiData from "@emoji-mart/data";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Search, Shuffle, Loader2, ImagePlus, Clock,
  Smile, Leaf, Apple, Dumbbell, Plane, Lightbulb, Hash, Flag,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { LUCIDE_MAP, LUCIDE_NAMES, renderNoteIcon } from "./note-icon";

export { renderNoteIcon };

type EmojiDef = { id: string; name: string; keywords: string[]; skins: { native: string }[] };
const DATA = emojiData as unknown as {
  categories: { id: string; emojis: string[] }[];
  emojis: Record<string, EmojiDef>;
};

const CATEGORY_META: Record<string, { label: string; icon: ReactNode }> = {
  people:   { label: "Smileys & People", icon: <Smile /> },
  nature:   { label: "Animals & Nature", icon: <Leaf /> },
  foods:    { label: "Food & Drink",     icon: <Apple /> },
  activity: { label: "Activity",         icon: <Dumbbell /> },
  places:   { label: "Travel & Places",  icon: <Plane /> },
  objects:  { label: "Objects",          icon: <Lightbulb /> },
  symbols:  { label: "Symbols",          icon: <Hash /> },
  flags:    { label: "Flags",            icon: <Flag /> },
};

const RECENTS_KEY = "workwrk:icon-recents";

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}
function pushRecent(native: string) {
  try {
    const next = [native, ...readRecents().filter((x) => x !== native)].slice(0, 18);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

type Tab = "emoji" | "icons" | "upload";

export function NoteIconPicker({
  current,
  onPick,
  onClear,
}: {
  current?: string;
  onPick: (value: string) => void;
  onClear: () => void;
}) {
  const [tab, setTab] = useState<Tab>("emoji");
  return (
    <div className="nipick" onClick={(e) => e.stopPropagation()}>
      <header className="nipick__tabs">
        <button type="button" className={tab === "emoji" ? "is-on" : ""} onClick={() => setTab("emoji")}>Emoji</button>
        <button type="button" className={tab === "icons" ? "is-on" : ""} onClick={() => setTab("icons")}>Icons</button>
        <button type="button" className={tab === "upload" ? "is-on" : ""} onClick={() => setTab("upload")}>Upload</button>
        <button type="button" className="nipick__remove" onClick={onClear}>Remove</button>
      </header>
      {tab === "emoji" && <EmojiTab current={current} onPick={onPick} />}
      {tab === "icons" && <IconsTab current={current} onPick={onPick} />}
      {tab === "upload" && <UploadTab onPick={onPick} />}
    </div>
  );
}

// ───────── Emoji tab ─────────

function EmojiTab({ current, onPick }: { current?: string; onPick: (v: string) => void }) {
  const [query, setQuery] = useState("");
  // Lazy init from localStorage. Safe because this picker is only ever
  // mounted on click (never during SSR), so there's no hydration mismatch.
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const allEmojis = useMemo(() => Object.values(DATA.emojis), []);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return null;
    return allEmojis
      .filter((e) => e.name.toLowerCase().includes(q) || e.keywords.some((k) => k.includes(q)))
      .slice(0, 90);
  }, [q, allEmojis]);

  const choose = (native: string) => {
    pushRecent(native);
    setRecents(readRecents());
    onPick(native);
  };
  const random = () => {
    const e = allEmojis[Math.floor(Math.random() * allEmojis.length)];
    if (e?.skins?.[0]?.native) choose(e.skins[0].native);
  };
  const jump = (id: string) => sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
      <div className="nipick__toolbar">
        <div className="nipick__search">
          <Search />
          <input
            type="text"
            placeholder="Filter…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="button" className="nipick__shuffle" onClick={random} title="Random emoji" aria-label="Random emoji">
          <Shuffle />
        </button>
      </div>

      <div className="nipick__scroll" ref={scrollRef}>
        {filtered ? (
          filtered.length === 0 ? (
            <div className="nipick__empty">No emoji found</div>
          ) : (
            <div className="nipick__grid">
              {filtered.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={`nipick__cell ${current === e.skins[0]?.native ? "is-on" : ""}`}
                  onClick={() => choose(e.skins[0].native)}
                  title={e.name}
                >
                  {e.skins[0]?.native}
                </button>
              ))}
            </div>
          )
        ) : (
          <>
            {recents.length > 0 && (
              <section className="nipick__section">
                <div className="nipick__section-label"><Clock /> Recent</div>
                <div className="nipick__grid">
                  {recents.map((native, i) => (
                    <button key={`${native}-${i}`} type="button" className={`nipick__cell ${current === native ? "is-on" : ""}`} onClick={() => choose(native)}>
                      {native}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {DATA.categories.map((cat) => {
              const meta = CATEGORY_META[cat.id];
              if (!meta) return null;
              return (
                <section
                  key={cat.id}
                  className="nipick__section"
                  ref={(el) => { sectionRefs.current[cat.id] = el; }}
                >
                  <div className="nipick__section-label">{meta.label}</div>
                  <div className="nipick__grid">
                    {cat.emojis.map((id) => {
                      const e = DATA.emojis[id];
                      const native = e?.skins?.[0]?.native;
                      if (!native) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`nipick__cell ${current === native ? "is-on" : ""}`}
                          onClick={() => choose(native)}
                          title={e.name}
                        >
                          {native}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>

      {!filtered && (
        <div className="nipick__catbar">
          {recents.length > 0 && (
            <button type="button" onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })} title="Recent"><Clock /></button>
          )}
          {DATA.categories.map((cat) =>
            CATEGORY_META[cat.id] ? (
              <button key={cat.id} type="button" onClick={() => jump(cat.id)} title={CATEGORY_META[cat.id].label}>
                {CATEGORY_META[cat.id].icon}
              </button>
            ) : null,
          )}
        </div>
      )}
    </>
  );
}

// ───────── Icons tab ─────────

function IconsTab({ current, onPick }: { current?: string; onPick: (v: string) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const names = q ? LUCIDE_NAMES.filter((n) => n.toLowerCase().includes(q)) : LUCIDE_NAMES;
  return (
    <>
      <div className="nipick__toolbar">
        <div className="nipick__search">
          <Search />
          <input type="text" placeholder="Filter icons…" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="nipick__scroll">
        <div className="nipick__grid nipick__grid--icons">
          {names.map((name) => {
            const Cmp = LUCIDE_MAP[name];
            const value = `lucide:${name}`;
            return (
              <button
                key={name}
                type="button"
                className={`nipick__cell nipick__cell--icon ${current === value ? "is-on" : ""}`}
                onClick={() => onPick(value)}
                title={name}
              >
                <Cmp />
              </button>
            );
          })}
          {names.length === 0 && <div className="nipick__empty">No icons found</div>}
        </div>
      </div>
    </>
  );
}

// ───────── Upload tab ─────────

function UploadTab({ onPick }: { onPick: (v: string) => void }) {
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) { toast("Not an image"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) { toast("Upload failed"); return; }
      const d = await res.json();
      if (d.url) onPick(d.url);
    } catch { toast("Upload failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="nipick__upload-wrap">
      <div
        className={`nipick__upload ${busy ? "is-busy" : ""}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); }}
      >
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        {busy ? <><Loader2 className="nipick__spin" /> Uploading…</> : <><ImagePlus /> Upload an image</>}
      </div>
      <p className="nipick__upload-hint">Recommended: square image, at least 280×280px.</p>
    </div>
  );
}
