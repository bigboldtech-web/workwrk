"use client";

// SpaceMoreMenu — the per-Space "..." popover that sits next to the
// SpaceCreateTrigger ("+") in the sidebar. Actions hit the existing
// PATCH/DELETE /api/spaces/[id] routes. Visible only on hover, same
// gesture as the "+" button.
//
// Actions wired:
//   Rename            → PATCH name (prompt-style inline editor inside the popover)
//   Change icon/color → opens SpaceIconPicker, PATCH icon+color on pick
//   Toggle privacy    → PATCH visibility WORKSPACE ↔ PRIVATE
//   Archive           → DELETE (soft-archive); confirm first
//
// Settings / Share / Permissions / Hide are intentional stubs until
// the corresponding flows land.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal, Edit2, Palette, Lock, Globe, Archive, Settings,
  Share2, EyeOff, Loader2, ChevronRight, Star, Link as LinkIcon,
  Plus, Zap, Tag, CircleDot, Download, Files, ArrowRightLeft, Copy, Trash2, Save,
} from "lucide-react";
import { SpaceIconPicker } from "./space-icon-picker";
import { useOsToast } from "./toast";
import { useOsShell } from "./shell-context";
import { MorePortal } from "./more-portal";

interface SpaceRowLike {
  id: string;
  slug?: string;
  name: string;
  icon: string | null;
  color: string | null;
  visibility: "PRIVATE" | "WORKSPACE" | "ORG";
}

interface Props {
  space: SpaceRowLike;
  onUpdated?: () => void;
  onRequestShare?: () => void;
}

export function SpaceMoreTrigger({ space, onUpdated, onRequestShare }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`p-0.5 rounded transition-colors ${
          open ? "text-zinc-900 bg-zinc-200" : "text-zinc-500 hover:bg-zinc-200"
        }`}
        aria-label="Space actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
      >
        <MoreHorizontal className="w-3 h-3" />
      </button>

      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={260} open={open} placement="right">
        <SpaceMoreMenu
          space={space}
          onClose={() => setOpen(false)}
          onUpdated={onUpdated}
          onRequestShare={onRequestShare}
        />
      </MorePortal>
    </span>
  );
}

type Mode = "menu" | "rename" | "icon";

function SpaceMoreMenu({
  space,
  onClose,
  onUpdated,
  onRequestShare,
}: {
  space: SpaceRowLike;
  onClose: () => void;
  onUpdated?: () => void;
  onRequestShare?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { openTemplateCenter } = useOsShell();
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState(space.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [iconName, setIconName] = useState(space.icon);
  const [color, setColor] = useState(space.color ?? "#71717A");
  const [starred, setStarred] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const ids: string[] = d?.effective?.home?.favoriteSpaceIds ?? [];
        setStarred(ids.includes(space.id));
      })
      .catch(() => { if (alive) setStarred(false); });
    return () => { alive = false; };
  }, [space.id]);

  const toggleFavorite = useCallback(async () => {
    if (starred === null) return;
    const next = !starred;
    setStarred(next);
    try {
      await fetch("/api/me/favorites/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, on: next }),
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      }
    } catch {
      setStarred(starred);
    }
  }, [space.id, starred]);

  const copyLink = useCallback(async () => {
    try {
      const url = `${window.location.origin}/spaces/${space.slug ?? space.id}`;
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Couldn't copy");
    }
  }, [space, toast]);

  const saveAsTemplate = useCallback(async () => {
    setBusy("save-template");
    try {
      const res = await fetch("/api/template-center/save-as", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "SPACE", spaceId: space.id }),
      });
      if (!res.ok) throw new Error();
      toast(`Saved “${space.name}” as a template`);
      onClose();
    } catch {
      toast("Couldn't save template");
    } finally {
      setBusy(null);
    }
  }, [space.id, space.name, toast, onClose]);

  const patch = async (body: Record<string, unknown>, kind: string) => {
    setBusy(kind);
    try {
      const res = await fetch(`/api/spaces/${space.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Update failed");
        return false;
      }
      onUpdated?.();
      router.refresh();
      return true;
    } catch {
      toast("Update failed");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const archive = async () => {
    if (!window.confirm(`Archive "${space.name}"? You can restore it later.`)) return;
    setBusy("archive");
    try {
      const res = await fetch(`/api/spaces/${space.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Archive failed");
        return;
      }
      toast(`${space.name} archived`);
      onUpdated?.();
      router.refresh();
      onClose();
    } catch {
      toast("Archive failed");
    } finally {
      setBusy(null);
    }
  };

  if (mode === "rename") {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 shadow-2xl p-3">
        <div className="text-[11px] uppercase tracking-wide text-zinc-400 font-semibold mb-2">
          Rename Space
        </div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = draft.trim();
              if (v && v !== space.name) {
                patch({ name: v }, "rename").then((ok) => { if (ok) onClose(); });
              } else {
                onClose();
              }
            }
            if (e.key === "Escape") onClose();
          }}
          className="w-full h-9 px-2.5 rounded-md border border-zinc-200 bg-white text-[13px] focus:outline-none focus:border-zinc-400"
          autoFocus
        />
        <div className="flex justify-end gap-1.5 mt-2.5">
          <button
            type="button"
            onClick={() => setMode("menu")}
            disabled={Boolean(busy)}
            className="h-7 px-2.5 rounded-md text-[12px] text-zinc-600 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              const v = draft.trim();
              if (!v || v === space.name) { onClose(); return; }
              const ok = await patch({ name: v }, "rename");
              if (ok) onClose();
            }}
            disabled={Boolean(busy) || !draft.trim()}
            className="h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy === "rename" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    );
  }

  if (mode === "icon") {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 shadow-2xl p-3">
        <div className="text-[11px] uppercase tracking-wide text-zinc-400 font-semibold mb-2">
          Change icon &amp; color
        </div>
        <div className="flex items-center gap-3">
          <SpaceIconPicker
            iconName={iconName}
            color={color}
            fallbackInitial={space.name[0]?.toUpperCase() ?? "S"}
            onChange={({ iconName: next, color: nextColor }) => {
              setIconName(next);
              setColor(nextColor);
            }}
          />
          <div className="text-[12px] text-zinc-500">Pick from the catalog or a custom color.</div>
        </div>
        <div className="flex justify-end gap-1.5 mt-3">
          <button
            type="button"
            onClick={() => setMode("menu")}
            disabled={Boolean(busy)}
            className="h-7 px-2.5 rounded-md text-[12px] text-zinc-600 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              const ok = await patch({ icon: iconName ?? null, color }, "icon");
              if (ok) onClose();
            }}
            disabled={Boolean(busy)}
            className="h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy === "icon" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    );
  }

  const isPrivate = space.visibility === "PRIVATE";

  return (
    <div role="menu" className="bg-white rounded-xl border border-zinc-200 shadow-2xl py-1.5">
      <MenuItem
        Icon={Star}
        label={starred ? "Unfavorite" : "Favorite"}
        onClick={toggleFavorite}
        iconFilled={!!starred}
      />
      <MenuItem Icon={Edit2}    label="Rename"      onClick={() => setMode("rename")} />
      <MenuItem Icon={LinkIcon} label="Copy link"   onClick={copyLink} />

      <MenuItem Icon={Plus}    label="Create new"  submenu disabled />
      <MenuItem Icon={Palette} label="Space color" onClick={() => setMode("icon")} submenu />

      <MenuItem
        Icon={isPrivate ? Globe : Lock}
        label={isPrivate ? "Make workspace-visible" : "Make Private"}
        busy={busy === "visibility"}
        onClick={() => patch({ visibility: isPrivate ? "WORKSPACE" : "PRIVATE" }, "visibility")}
      />

      <div className="h-px bg-zinc-100 my-1" />

      <MenuItem Icon={Zap}       label="Automations"   disabled />
      <MenuItem Icon={Tag}       label="Custom Fields" disabled />
      <MenuItem Icon={CircleDot} label="Task statuses" disabled />

      <MenuItem Icon={MoreHorizontal} label="More" submenu disabled />

      <div className="h-px bg-zinc-100 my-1" />

      <MenuItem Icon={Download}       label="Imports"   submenu disabled />
      <MenuItem Icon={Files}          label="Browse templates" onClick={() => { onClose(); openTemplateCenter({ applyContext: { spaceId: space.id } }); }} />
      <MenuItem Icon={Save}           label="Save as template" busy={busy === "save-template"} onClick={saveAsTemplate} />
      <MenuItem Icon={ArrowRightLeft} label="Move"      submenu disabled />
      <MenuItem Icon={Copy}           label="Duplicate" disabled />
      <MenuItem Icon={Settings}       label="Space settings" submenu disabled />
      <MenuItem Icon={EyeOff}         label="Hide from sidebar" onClick={() => toast("Hide coming soon")} />
      <MenuItem Icon={Archive}        label="Archive"   busy={busy === "archive"} onClick={archive} />
      <MenuItem Icon={Trash2}         label="Delete"    destructive disabled />

      <div className="h-px bg-zinc-100 my-1" />

      <MenuItem
        Icon={Share2}
        label="Sharing & Permissions"
        onClick={() => {
          if (onRequestShare) {
            onClose();
            onRequestShare();
          } else {
            toast("Share coming soon");
          }
        }}
      />
    </div>
  );
}

function MenuItem({
  Icon,
  label,
  trailing,
  busy,
  destructive,
  onClick,
  submenu,
  disabled,
  iconFilled,
}: {
  Icon: typeof Edit2;
  label: string;
  trailing?: ReactNode;
  busy?: boolean;
  destructive?: boolean;
  onClick?: () => void;
  submenu?: boolean;
  disabled?: boolean;
  iconFilled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={busy || disabled}
      title={disabled && !busy ? "Coming soon" : undefined}
      className={`w-full text-left flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] ${
        disabled
          ? "text-zinc-400 cursor-not-allowed"
          : destructive
            ? "text-red-600 hover:bg-red-50"
            : "text-zinc-800 hover:bg-zinc-50"
      } disabled:opacity-100`}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${
          disabled
            ? "text-zinc-300"
            : destructive
              ? "text-red-500"
              : iconFilled
                ? "text-amber-400"
                : "text-zinc-500"
        }`}
        style={iconFilled ? { fill: "currentColor" } : undefined}
      />
      <span className="flex-1">{label}</span>
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
      ) : submenu ? (
        <ChevronRight className="h-3 w-3 text-zinc-400 shrink-0" />
      ) : (
        trailing
      )}
    </button>
  );
}
