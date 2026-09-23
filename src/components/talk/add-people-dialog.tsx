"use client";

// Add people to a group chat or channel, lean people picker over the
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
      // /api/people/pick, not /api/users?scope=all: the latter team-scopes
      // everybody below an org-wide level, so Add people offered a Member
      // nobody but themselves.
      const params = new URLSearchParams({ limit: "20" });
      if (search.trim()) params.set("q", search.trim());
      fetch(`/api/people/pick?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((d) => { if (active) setPeople(Array.isArray(d?.people) ? d.people : []); })
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
      <DialogContent className="w-full" style={{ maxWidth: 560 }}>
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
        </DialogHeader>

        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 h-6 pl-1 pr-1.5 rounded-full bg-hover text-sm text-ink">
                <TeamAvatar name={`${p.firstName} ${p.lastName}`} avatar={p.avatar} size={18} />
                {p.firstName} {p.lastName}
                <button type="button" onClick={() => toggle(p)} className="text-ink-3 hover:text-ink" aria-label={`Remove ${p.firstName}`}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 h-9 px-2.5 rounded-md border border-line bg-raised">
          <Search className="w-4 h-4 text-ink-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            className="flex-1 min-w-0 bg-transparent outline-none text-base text-ink placeholder:text-ink-3"
          />
        </div>

        <ul className="mt-2 max-h-56 overflow-y-auto flex flex-col gap-0.5">
          {candidates.length === 0 ? (
            <li className="px-2 py-4 text-center text-sm text-ink-3">Everyone matching is already here</li>
          ) : candidates.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-subtle text-left"
              >
                <TeamAvatar name={`${p.firstName} ${p.lastName}`} avatar={p.avatar} size={28} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-base text-ink">{p.firstName} {p.lastName}</span>
                  {p.role?.title && <span className="block truncate text-xs text-ink-3">{p.role.title}</span>}
                </span>
                <Plus className="w-4 h-4 text-ink-4" />
              </button>
            </li>
          ))}
        </ul>

        {error && <p className="mt-2 text-sm text-danger-text">{error}</p>}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-md text-base text-ink-2 hover:bg-subtle border border-line">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void add()}
            disabled={picked.length === 0 || saving}
            className="h-8 px-3 rounded-md text-base font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
          >
            {saving ? "Adding…" : `Add ${picked.length || ""}`.trim()}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
