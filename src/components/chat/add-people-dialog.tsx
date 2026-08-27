"use client";

// Add people to a group chat or channel — lean people picker over the
// same /api/users search contract every picker in the app uses.

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TeamAvatar } from "@/components/team/ui";

type PersonRow = { id: string; firstName: string; lastName: string; avatar?: string | null; role?: { title: string } | null };

export function AddPeopleDialog({ conversationId, existingMemberIds, onClose, onAdded }: {
  conversationId: string;
  existingMemberIds: string[];
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [picked, setPicked] = useState<PersonRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ scope: "all", limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      fetch(`/api/users?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((d) => { if (active) setPeople(Array.isArray(d?.data) ? d.data : []); })
        .catch(() => { if (active) setPeople([]); });
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [search]);

  const excluded = useMemo(
    () => new Set([...existingMemberIds, ...picked.map((p) => p.id)]),
    [existingMemberIds, picked],
  );
  const candidates = people.filter((p) => !excluded.has(p.id));

  const toggle = (p: PersonRow) => {
    setError(null);
    setPicked((prev) => (prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : [...prev, p]));
  };

  const add = async () => {
    if (picked.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: picked.map((p) => p.id) }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error || "Couldn't add people. Try again.");
        setSaving(false);
        return;
      }
      onAdded(d?.added ?? picked.length);
    } catch {
      setError("Couldn't add people. Check your connection and try again.");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
        </DialogHeader>

        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 h-6 pl-1 pr-1.5 rounded-full bg-zinc-100 text-[13px] text-zinc-700">
                <TeamAvatar name={`${p.firstName} ${p.lastName}`} avatar={p.avatar} size={18} />
                {p.firstName} {p.lastName}
                <button type="button" onClick={() => toggle(p)} className="text-zinc-400 hover:text-zinc-700" aria-label={`Remove ${p.firstName}`}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 h-9 px-2.5 rounded-md border border-zinc-200 bg-white">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-zinc-800 placeholder:text-zinc-400"
          />
        </div>

        <ul className="mt-2 max-h-56 overflow-y-auto flex flex-col gap-0.5">
          {candidates.length === 0 ? (
            <li className="px-2 py-4 text-center text-[13px] text-zinc-400">Everyone matching is already here</li>
          ) : candidates.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-zinc-50 text-left"
              >
                <TeamAvatar name={`${p.firstName} ${p.lastName}`} avatar={p.avatar} size={28} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[14px] text-zinc-800">{p.firstName} {p.lastName}</span>
                  {p.role?.title && <span className="block truncate text-[12px] text-zinc-400">{p.role.title}</span>}
                </span>
                <Plus className="w-4 h-4 text-zinc-300" />
              </button>
            </li>
          ))}
        </ul>

        {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-md text-[14px] text-zinc-600 hover:bg-zinc-50 border border-zinc-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void add()}
            disabled={picked.length === 0 || saving}
            className="h-8 px-3 rounded-md text-[14px] font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
          >
            {saving ? "Adding…" : `Add ${picked.length || ""}`.trim()}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
