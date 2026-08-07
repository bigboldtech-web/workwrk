"use client";

// CreateSprintModal — the "Create Sprint" dialog (ClickUp Sprints parity,
// migration-free Lego path: a Sprint is a Board with settings.sprint).
// Structurally cloned from CreateListModal so the two dialogs read as one
// system: same overlay/panel chrome, same Space picker, same footer.
//
// The name preview is display-only ("Sprint N (M/D - M/D)") — the server
// recomputes the sprint number authoritatively inside createBoard.

import { useEffect, useRef, useState } from "react";
import { X, ChevronDown, Check, Loader2, Boxes, IterationCw } from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { EntityTile } from "@/components/ui/entity-tile";
import { sprintBoardName } from "@/lib/sprint";
import { useOsShell } from "./shell-context";
import { refreshSidebar } from "./sidebar-refresh";
import { useRouter } from "next/navigation";

type SpaceRow = { id: string; slug?: string; name: string; icon: string | null; color: string | null };

const DURATIONS = [
  { weeks: 1, label: "1 week" },
  { weeks: 2, label: "2 weeks" },
  { weeks: 3, label: "3 weeks" },
  { weeks: 4, label: "4 weeks" },
];

/** Default the sprint start to the upcoming Monday (always in the future). */
function nextMondayISO(): string {
  const now = new Date();
  const delta = (8 - now.getDay()) % 7 || 7;
  return format(new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta), "yyyy-MM-dd");
}

const INPUT_CLASSES =
  "w-full h-8 px-3 text-[13px] bg-white border border-zinc-200 rounded-md focus:outline-none focus:border-[var(--os-brand)] focus:ring-2 focus:ring-[var(--os-brand)]/20 transition-all placeholder:text-zinc-400";

export function CreateSprintModal() {
  const { createSprintOpen, closeCreateSprint, createSprintPreselect } = useOsShell();
  const router = useRouter();
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [spaceId, setSpaceId] = useState<string>("");
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);
  const [startDate, setStartDate] = useState<string>(nextMondayISO);
  const [weeks, setWeeks] = useState(2);
  // Loaded next-sprint-number tagged with the Space it was computed for, so
  // switching Spaces shows the loading placeholder without an in-effect reset.
  const [numberFor, setNumberFor] = useState<{ spaceId: string; n: number } | null>(null);
  const nextNumber = numberFor && numberFor.spaceId === spaceId ? numberFor.n : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // Load spaces once on first open; default the location to the preselect,
  // else the current route's space, else the first space.
  useEffect(() => {
    if (!createSprintOpen || loadedRef.current) return;
    loadedRef.current = true;
    void fetch("/api/spaces", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { spaces: [] }))
      .then((d) => {
        const rows: SpaceRow[] = Array.isArray(d.spaces) ? d.spaces : [];
        setSpaces(rows);
        const preId = createSprintPreselect?.spaceId;
        const fromPreselect = preId ? rows.find((s) => s.id === preId) : null;
        const slug = typeof window !== "undefined" ? window.location.pathname.match(/\/spaces\/([^/?#]+)/)?.[1] : null;
        const fromRoute = slug ? rows.find((s) => s.slug === decodeURIComponent(slug)) : null;
        setSpaceId(fromPreselect?.id ?? fromRoute?.id ?? rows[0]?.id ?? "");
      })
      .catch(() => {});
  }, [createSprintOpen, createSprintPreselect]);

  // Display-only next sprint number: count "Sprint N" names in the target
  // Space. The server recomputes authoritatively (from settings.sprint).
  useEffect(() => {
    if (!createSprintOpen || !spaceId) return;
    let cancelled = false;
    void fetch(`/api/boards?spaceId=${encodeURIComponent(spaceId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { boards: [] }))
      .then((d) => {
        if (cancelled) return;
        const rows: { name?: string }[] = Array.isArray(d.boards) ? d.boards : [];
        let maxN = 0;
        for (const b of rows) {
          const m = typeof b.name === "string" ? b.name.match(/^Sprint (\d+)/) : null;
          if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
        }
        setNumberFor({ spaceId, n: maxN + 1 });
      })
      .catch(() => { if (!cancelled) setNumberFor({ spaceId, n: 1 }); });
    return () => { cancelled = true; };
  }, [createSprintOpen, spaceId]);

  if (!createSprintOpen) return null;

  // Reset transient state and close (the component stays mounted).
  const doClose = () => {
    loadedRef.current = false;
    setSpaceId(""); setSpaceMenuOpen(false); setStartDate(nextMondayISO());
    setWeeks(2); setNumberFor(null); setError(null); setBusy(false);
    closeCreateSprint();
  };

  const selectedSpace = spaces.find((s) => s.id === spaceId) ?? null;
  const endDate = startDate ? format(addDays(parseISO(startDate), weeks * 7 - 1), "yyyy-MM-dd") : "";
  const canCreate = !!spaceId && !!startDate && !!endDate && !busy;
  const previewName =
    startDate && endDate
      ? nextNumber !== null
        ? sprintBoardName(nextNumber, startDate, endDate)
        : "Sprint —"
      : "Sprint —";

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
          ...(createSprintPreselect?.folderId ? { folderId: createSprintPreselect.folderId } : {}),
          name: "",
          sprint: { startDate, endDate },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? "Couldn't create sprint"); setBusy(false); return; }
      const slug = data?.board?.slug;
      doClose();
      refreshSidebar();
      if (slug) router.push(`/boards/${slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create sprint");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 transition-opacity" onClick={doClose} aria-hidden="true" />

      <div
        className="relative w-full max-w-[480px] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-sprint-title"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-start justify-between">
          <div>
            <h2 id="create-sprint-title" className="flex items-center gap-2 text-[16px] font-semibold text-zinc-900">
              <IterationCw className="w-4 h-4 text-[#0073EA]" />
              Create Sprint
            </h2>
            <p className="text-[12.5px] text-zinc-500 mt-1">A Sprint is a time-boxed List. Tasks get a Sprint Points field automatically.</p>
          </div>
          <button type="button" onClick={doClose} className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error ? <div className="mx-5 mb-2 text-[12px] text-red-500 bg-red-500/10 rounded-md px-3 py-2">{error}</div> : null}

        {/* Form Body */}
        <div className="px-5 py-3 flex flex-col gap-4">
          {/* Space (location) picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-medium text-zinc-700">Space (location)</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setSpaceMenuOpen((o) => !o)}
                className="w-full flex items-center justify-between h-8 px-3 bg-white border border-zinc-200 rounded-md hover:bg-zinc-50 transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {selectedSpace ? (
                    <>
                      <SpaceGlyph space={selectedSpace} />
                      <span className="text-[13px] text-zinc-900 font-medium truncate">{selectedSpace.name}</span>
                    </>
                  ) : (
                    <span className="text-[13px] text-zinc-400">{spaces.length ? "Select a Space…" : "No Spaces available"}</span>
                  )}
                </span>
                <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
              </button>
              {spaceMenuOpen ? (
                <div className="absolute z-10 mt-1 left-0 right-0 max-h-[240px] overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg py-1">
                  {spaces.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-zinc-400">No Spaces yet.</div>
                  ) : (
                    spaces.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setSpaceId(s.id); setSpaceMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-50"
                      >
                        <SpaceGlyph space={s} />
                        <span className="flex-1 text-[13px] text-zinc-800 truncate">{s.name}</span>
                        {s.id === spaceId ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : null}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {/* Start date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-medium text-zinc-700">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={INPUT_CLASSES}
            />
          </div>

          {/* Duration */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-medium text-zinc-700">Duration</label>
            <select
              value={weeks}
              onChange={(e) => setWeeks(parseInt(e.target.value, 10))}
              className={INPUT_CLASSES}
            >
              {DURATIONS.map((d) => (
                <option key={d.weeks} value={d.weeks}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Name preview (server names authoritatively) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-medium text-zinc-700">Name</label>
            <div className="h-8 px-3 flex items-center text-[13px] text-zinc-500 bg-zinc-100 rounded-md">{previewName}</div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pt-3 pb-4 mt-1 border-t border-zinc-100 flex items-center justify-end bg-white">
          <button type="button" onClick={() => void handleCreate()} disabled={!canCreate} className="px-4 h-8 text-[12.5px] font-medium rounded-md inline-flex items-center gap-1.5 text-white bg-[#0073EA] hover:bg-[#0060B9] disabled:opacity-50">
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
