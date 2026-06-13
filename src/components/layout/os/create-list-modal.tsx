"use client";

import { useEffect, useRef, useState } from "react";
import { X, Trophy, Rocket, Timer, ChevronDown, Check, Loader2, Boxes } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { EntityTile } from "@/components/ui/entity-tile";
import { useOsShell } from "./shell-context";
import { useRouter } from "next/navigation";
import { taupeButton } from "@/components/ui/accent";

type SpaceRow = { id: string; slug?: string; name: string; icon: string | null; color: string | null };

export function CreateListModal() {
  const { createListOpen, closeCreateList, openTemplateCenter } = useOsShell();
  const router = useRouter();
  const [listName, setListName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [spaceId, setSpaceId] = useState<string>("");
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // Load spaces once on first open; default the location to the current
  // route's space when we can derive it, else the first space.
  useEffect(() => {
    if (!createListOpen || loadedRef.current) return;
    loadedRef.current = true;
    void fetch("/api/spaces", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { spaces: [] }))
      .then((d) => {
        const rows: SpaceRow[] = Array.isArray(d.spaces) ? d.spaces : [];
        setSpaces(rows);
        const slug = typeof window !== "undefined" ? window.location.pathname.match(/\/spaces\/([^/?#]+)/)?.[1] : null;
        const fromRoute = slug ? rows.find((s) => s.slug === decodeURIComponent(slug)) : null;
        setSpaceId(fromRoute?.id ?? rows[0]?.id ?? "");
      })
      .catch(() => {});
  }, [createListOpen]);

  if (!createListOpen) return null;

  // Reset transient state and close. Routed through every close path so
  // the form is clean on the next open (the component stays mounted).
  const doClose = () => {
    loadedRef.current = false;
    setListName(""); setIsPrivate(false); setSpaceId(""); setError(null); setBusy(false); setSpaceMenuOpen(false);
    closeCreateList();
  };

  const selectedSpace = spaces.find((s) => s.id === spaceId) ?? null;
  const canCreate = listName.trim().length > 0 && !!spaceId && !busy;

  const handleCreate = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          name: listName.trim(),
          visibility: isPrivate ? "PRIVATE" : "WORKSPACE",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? "Couldn't create list"); setBusy(false); return; }
      const slug = data?.board?.slug;
      doClose();
      if (slug) router.push(`/boards/${slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create list");
      setBusy(false);
    }
  };

  const browseTemplates = () => { doClose(); openTemplateCenter({ kind: "LIST" }); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 transition-opacity" onClick={doClose} aria-hidden="true" />

      <div
        className="relative w-full max-w-[500px] bg-white rounded-[14px] shadow-xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-list-title"
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between">
          <div className="flex flex-col gap-3">
            <h2 id="create-list-title" className="text-xl font-bold text-zinc-900">Create List</h2>
            <div className="flex items-center gap-2">
              {/* Quick-start template chips → Template Center (List filter). */}
              <button type="button" onClick={browseTemplates} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-200 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 transition-colors">
                <Trophy className="w-3.5 h-3.5" /> Goals
              </button>
              <button type="button" onClick={browseTemplates} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-200 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 transition-colors">
                <Rocket className="w-3.5 h-3.5" /> Roadmap
              </button>
              <button type="button" onClick={browseTemplates} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-200 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 transition-colors">
                <Timer className="w-3.5 h-3.5" /> Tracker
              </button>
            </div>
          </div>
          <button type="button" onClick={doClose} className="w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 hover:bg-zinc-200 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error ? <div className="mx-5 mb-2 text-[12.5px] text-red-500 bg-red-500/10 rounded-md px-3 py-2">{error}</div> : null}

        {/* Form Body */}
        <div className="px-5 py-4 flex flex-col gap-5">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-zinc-700">Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
              placeholder="Your list or project name"
              autoFocus
              className="w-full px-3 py-2 text-[14px] bg-white border border-[#c39b8c] rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c39b8c]/20 transition-all placeholder:text-zinc-400"
            />
          </div>

          {/* Space (location) picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-zinc-700">Space (location) <span className="text-red-500">*</span></label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setSpaceMenuOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {selectedSpace ? (
                    <>
                      <SpaceGlyph space={selectedSpace} />
                      <span className="text-[14px] text-zinc-900 font-medium truncate">{selectedSpace.name}</span>
                    </>
                  ) : (
                    <span className="text-[14px] text-zinc-400">{spaces.length ? "Select a Space…" : "No Spaces available"}</span>
                  )}
                </span>
                <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
              </button>
              {spaceMenuOpen ? (
                <div className="absolute z-10 mt-1 left-0 right-0 max-h-[240px] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg py-1">
                  {spaces.length === 0 ? (
                    <div className="px-3 py-2 text-[12.5px] text-zinc-400">No Spaces yet.</div>
                  ) : (
                    spaces.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setSpaceId(s.id); setSpaceMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50"
                      >
                        <SpaceGlyph space={s} />
                        <span className="flex-1 text-[13.5px] text-zinc-800 truncate">{s.name}</span>
                        {s.id === spaceId ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : null}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {/* Privacy */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex flex-col">
              <span className="text-[14px] font-medium text-zinc-800">Make private</span>
              <span className="text-[13px] text-zinc-500">Only you and invited members have access</span>
            </div>
            <Switch checked={isPrivate} onChange={setIsPrivate} aria-label="Make list private" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex items-center justify-between bg-white mt-2 pb-6">
          <button type="button" onClick={browseTemplates} className="px-4 py-2 text-[13px] font-medium text-zinc-600 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors">
            Use Templates
          </button>
          <button type="button" onClick={() => void handleCreate()} disabled={!canCreate} className={`px-6 py-2 text-[13px] rounded-lg shadow-sm inline-flex items-center gap-1.5 disabled:opacity-50 ${taupeButton}`}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Create
          </button>
        </div>
      </div>
    </div>
  );
}

function SpaceGlyph({ space }: { space: SpaceRow }) {
  return (
    <EntityTile
      size="sm"
      icon={space.icon ? Boxes : null}
      color={space.color}
      name={space.name}
    />
  );
}
