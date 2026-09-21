"use client";

// PartiesPanel (spec-process section 3): the 272 right panel of the contract
// page's Place-fields mode, the FilterPanel primitive rendered on the RIGHT
// (a named deviation, section 1: the tools must sit beside the document they
// are dropped onto). Two sections:
//
//   Parties  36px rows: the party's colour dot (one of the eight muted hues
//            by order), name (inline rename), email (required before Send),
//            role picker (Signer / Client / Third party / Internal), the
//            order arrows, "…" Remove; "+ Add party"; "Add a teammate" (a
//            directory picker that fills name, email and userId)
//   Fields   the seven tools as 36px rows: click one, then click the
//            document to place it (or drag it on)
//
// The panel is inert for a party who has signed (their row is read-only).

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Calendar, CheckSquare, ChevronDown, Mail, PenLine, Plus, Signature, Trash2, Type, UserPlus } from "lucide-react";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { RowMoreButton } from "@/components/ui/table-card";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { apiFetch } from "@/lib/api-fetch";
import { PARTY_ROLE_LABEL, isValidEmail, partyHue, type PartyRole } from "@/lib/contracts";
import type { BuilderParty, FieldType } from "@/components/agreements/field-builder";
import { cn } from "@/lib/utils";

const FIELD_TOOLS: Array<{ type: FieldType; label: string; Icon: typeof Type }> = [
  { type: "signature", label: "Signature", Icon: Signature },
  { type: "initials", label: "Initials", Icon: PenLine },
  { type: "text", label: "Text", Icon: Type },
  { type: "email", label: "Email", Icon: Mail },
  { type: "date", label: "Date", Icon: Calendar },
  { type: "checkbox", label: "Checkbox", Icon: CheckSquare },
  { type: "dropdown", label: "Dropdown", Icon: ChevronDown },
];
const ROLES: PartyRole[] = ["SIGNER", "CLIENT", "THIRD_PARTY", "INTERNAL"];

export function PartiesPanel({ parties, activePartyId, onActiveParty, pendingTool, onPendingTool, onAddParty, onAddTeammate, onRenameParty, onEmailParty, onRoleParty, onReorder, onRemoveParty, sendErrors }: {
  parties: BuilderParty[];
  activePartyId: string | null;
  onActiveParty: (id: string) => void;
  pendingTool: FieldType | null;
  onPendingTool: (t: FieldType | null) => void;
  onAddParty: () => void;
  onAddTeammate: (person: PersonRef) => void;
  onRenameParty: (id: string, name: string) => void;
  onEmailParty: (id: string, email: string) => void;
  onRoleParty: (id: string, role: PartyRole) => void;
  onReorder: (ids: string[]) => void;
  onRemoveParty: (id: string) => void;
  /** Inline errors from partySendErrors, keyed by party id. */
  sendErrors?: Record<string, string>;
}) {
  const [teamOpen, setTeamOpen] = useState(false);
  const [people, setPeople] = useState<PersonRef[]>([]);
  useEffect(() => {
    if (!teamOpen || people.length) return;
    void apiFetch<{ data?: PersonRef[] } | PersonRef[]>("/api/users?scope=all&limit=200", { cache: "no-store" }).then((r) => setPeople(r.ok ? (Array.isArray(r.data) ? r.data : r.data?.data ?? []) : []));
  }, [teamOpen, people.length]);
  const peopleOptions: PickerOption[] = useMemo(() => people.map((p) => ({ value: p.id, label: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "", description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> })), [people]);
  const ordered = useMemo(() => [...parties].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [parties]);

  return (
    <aside className="os-row flex w-[272px] shrink-0 flex-col gap-3 self-start overflow-y-auto rounded-lg border border-line bg-raised p-4 text-ink" aria-label="Parties and fields">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">Parties</h2>
        <span className="text-xs font-medium tabular-nums text-ink-2">{parties.length}</span>
      </div>
      <ul className="flex flex-col">
        {ordered.map((p, i) => (
          <PartyRow key={p.id} party={p} index={i} count={ordered.length} active={activePartyId === p.id} error={sendErrors?.[p.id]}
            onSelect={() => onActiveParty(p.id)} onRename={(n) => onRenameParty(p.id, n)} onEmail={(e) => onEmailParty(p.id, e)} onRole={(r) => onRoleParty(p.id, r)}
            onUp={i > 0 ? () => { const ids = ordered.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; onReorder(ids); } : undefined}
            onDown={i < ordered.length - 1 ? () => { const ids = ordered.map((x) => x.id); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; onReorder(ids); } : undefined}
            onRemove={() => onRemoveParty(p.id)} />
        ))}
        {ordered.length === 0 ? <li className="flex h-9 items-center text-sm text-ink-2">Add at least one party to place fields</li> : null}
      </ul>
      <div className="flex flex-col gap-1">
        <button type="button" onClick={onAddParty} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"><Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add party</button>
        <span className="relative block">
          <button type="button" onClick={() => setTeamOpen((o) => !o)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"><UserPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add a teammate</button>
          <Picker open={teamOpen} onClose={() => setTeamOpen(false)} ariaLabel="Add a teammate" searchPlaceholder="Find a person" onSelect={(v) => { const person = people.find((x) => x.id === v); if (person) onAddTeammate(person); setTeamOpen(false); }} sections={[{ options: peopleOptions }]} />
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-line pt-3">
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">Fields</h2>
        {activePartyId ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold text-white" style={{ background: partyHue(ordered.findIndex((p) => p.id === activePartyId)) }}>{ordered.findIndex((p) => p.id === activePartyId) + 1}</span> : null}
      </div>
      <p className="text-sm text-ink-2">{activePartyId ? "Pick a tool, then click where it goes on the document. Or drag it on." : "Select a party first."}</p>
      <ul className="flex flex-col">
        {FIELD_TOOLS.map((t) => (
          <li key={t.type}>
            <button
              type="button"
              disabled={!activePartyId}
              draggable={!!activePartyId}
              onDragStart={(e) => { e.dataTransfer.setData("fieldType", t.type); e.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => onPendingTool(pendingTool === t.type ? null : t.type)}
              aria-pressed={pendingTool === t.type}
              className={cn("flex h-9 w-full items-center gap-2 rounded-md px-2 text-start text-base text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50", pendingTool === t.type ? "bg-selected" : "")}
            >
              <t.Icon className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden /> {t.label}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function PartyRow({ party, index, count, active, error, onSelect, onRename, onEmail, onRole, onUp, onDown, onRemove }: {
  party: BuilderParty; index: number; count: number; active: boolean; error?: string;
  onSelect: () => void; onRename: (n: string) => void; onEmail: (e: string) => void; onRole: (r: PartyRole) => void; onUp?: () => void; onDown?: () => void; onRemove: () => void;
}) {
  const [name, setName] = useState(party.name);
  const [email, setEmail] = useState(party.email ?? "");
  // Re-sync the buffers when the server value changes (the "seen" pattern,
  // during render, never in an effect).
  const [seenName, setSeenName] = useState(party.name);
  if (seenName !== party.name) { setSeenName(party.name); setName(party.name); }
  const [seenEmail, setSeenEmail] = useState(party.email ?? "");
  if (seenEmail !== (party.email ?? "")) { setSeenEmail(party.email ?? ""); setEmail(party.email ?? ""); }
  const [roleOpen, setRoleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // An email only reads as wrong once the person has left the field. Turning
  // it red on the first keystroke of a valid address is noise, not feedback.
  const [emailTouched, setEmailTouched] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const signed = party.status === "SIGNED";
  const hue = partyHue(index);
  return (
    <li className={cn("flex flex-col gap-1 rounded-md border px-2 py-1.5", active ? "border-brand bg-selected" : "border-transparent hover:bg-hover")} onClick={onSelect}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hue }} />
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== party.name) onRename(name.trim()); else setName(party.name); }} onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} disabled={signed} aria-label={`Party ${index + 1} name`} className="h-7 min-w-0 flex-1 rounded bg-transparent px-1 text-base font-medium text-ink focus:bg-raised focus:outline-none disabled:opacity-70" />
        {signed ? <span className="text-xs font-medium text-ink-2">Signed</span> : null}
        <RowMoreButton buttonRef={moreRef} open={menuOpen} onClick={() => setMenuOpen((o) => !o)} label="Party actions" />
      </div>
      <input value={email} type="email" onChange={(e) => setEmail(e.target.value)} onBlur={() => { setEmailTouched(true); if (email.trim() !== (party.email ?? "")) onEmail(email.trim()); }} disabled={signed} placeholder="Email (required before sending)" aria-label={`Party ${index + 1} email`} className={cn("h-7 min-w-0 rounded bg-transparent px-1 text-sm text-ink placeholder:text-ink-3 focus:bg-raised focus:outline-none disabled:opacity-70", error || (emailTouched && email && !isValidEmail(email)) ? "text-danger-text" : "")} />
      <div className="flex items-center gap-1">
        <span className="relative">
          <button type="button" onClick={(e) => { e.stopPropagation(); setRoleOpen((o) => !o); }} disabled={signed} className="inline-flex h-6 items-center gap-1 rounded-md bg-active px-1.5 text-xs font-medium text-ink hover:bg-hover disabled:opacity-70">{PARTY_ROLE_LABEL[(party.role as PartyRole) ?? "SIGNER"] ?? party.role} <ChevronDown className="h-3 w-3" aria-hidden /></button>
          <Picker open={roleOpen} onClose={() => setRoleOpen(false)} ariaLabel="Role" selected={party.role} onSelect={(v) => { onRole(v as PartyRole); setRoleOpen(false); }} sections={[{ options: ROLES.map((r) => ({ value: r, label: PARTY_ROLE_LABEL[r] })) }]} width={200} />
        </span>
        <span className="ms-auto inline-flex items-center">
          <button type="button" onClick={(e) => { e.stopPropagation(); onUp?.(); }} disabled={!onUp} aria-label="Move up" className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDown?.(); }} disabled={!onDown} aria-label="Move down" className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /></button>
        </span>
        <span className="text-xs tabular-nums text-ink-3">{index + 1} of {count}</span>
      </div>
      {error ? <span className="text-xs text-danger-text">{error}</span> : null}
      {menuOpen ? (
        <MorePortal anchorRef={moreRef} width={200} open onClose={() => setMenuOpen(false)} placement="below">
          <MenuList onClick={() => setMenuOpen(false)}>
            <MenuItem icon={Trash2} label="Remove party" destructive disabled={signed} onClick={onRemove} />
          </MenuList>
        </MorePortal>
      ) : null}
    </li>
  );
}
