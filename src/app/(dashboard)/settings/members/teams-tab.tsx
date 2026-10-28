"use client";

// Members > Teams (access-model-spec 3.4, Phase 8 stage E): named groups of
// people. Owners and Admins make a Team, rename it (Rename in the card
// header), add and remove people, mark a lead and archive it; everyone who
// opens Members reads them. The first card is honest about what a Team does
// today: it is a saved group, and sharing with a whole Team arrives with the
// new access engine (a Team is not yet a principal in the share dialog). The
// Lead mark is a label on the Team today: nothing else reads it yet.
//
// While the one share dialog serves teams (ACCESS_V2_TABLES on, batch 7) a
// card also has Manage people, for Owners and Admins and for the team's own
// leads, who add and take off its members there (only Owners and Admins
// make someone a lead).
//
// Layout (settings-cleanup Phase 4): the list page's width, every block a
// SettingsCard (24px padding, 16/600 title, ghost actions at the right of the
// title) and every person a SettingsRow. The "Teams" card holds what a team
// is. An empty list or team is one inline "No ... yet" line (B10).
//
// ONE FORM OF CREATE (final Settings review, M3): "New team" is the tab's
// toolbar primary, as New office is Structure's. Its press reaches here as a
// count (`createSignal`, the New office pattern: only a press made while
// this tab is open counts, never the count it had when it was opened) and
// opens the name row in the Teams card: the name field at its own 560px,
// Make team (secondary: the toolbar's is the one blue) and Cancel. The empty
// line's "Name one" opens the same row.

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { pickUrl } from "@/components/access/manage-access-model";
import { Avatar } from "@/components/ui/avatar-stack";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { ShareDialog } from "@/components/access/share-dialog";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { btn } from "@/components/settings/settings-form";
import { cn } from "@/lib/utils";

export interface TeamPerson { id: string; firstName: string | null; lastName: string | null; email: string; avatar: string | null; lead: boolean }
export interface Team { id: string; name: string; description: string | null; members: TeamPerson[] }

const nameOf = (p: { firstName?: string | null; lastName?: string | null; email?: string | null }) =>
  `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone";

/** "1 person", "3 people": a team card's one-line description (pure; tested). */
export const peopleCount = (n: number) => (n === 1 ? "1 person" : `${n} people`);

/** The one line a team card's Lead switch is read by: its visible word first, then whose it is (pure; tested). */
export const leadSwitchName = (person: string) => `Lead: ${person}`;

/** The id of a person's Lead switch on a team card, for the visible "Lead" label beside it (pure; tested). */
export const leadSwitchId = (teamId: string, userId: string) => `team-lead-${teamId}-${userId}`.replace(/[^a-zA-Z0-9_-]/g, "");

/** What a team is today, in the first card (the same words the tab always said). */
export const TEAMS_INTRO = "A team is a named group of people, such as Design or Support. Today a team is a saved list; sharing something with a whole team arrives with the new access engine.";

export function TeamsTab({ createSignal = 0 }: { createSignal?: number }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the name row is open. Held here, not in the card, so a press of
  // New team while the list is still loading opens it once the card draws.
  const [naming, setNaming] = useState(false);
  const seenSignal = useRef(createSignal);
  useEffect(() => {
    if (createSignal === seenSignal.current) return;
    seenSignal.current = createSignal;
    const t = setTimeout(() => setNaming(true), 0);
    return () => clearTimeout(t);
  }, [createSignal]);

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<{ teams: Team[]; canEdit: boolean }>("/api/settings/teams", { cache: "no-store" });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setTeams(r.data.teams);
    setCanEdit(r.data.canEdit);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <ErrorState what="the teams" hint={error} onRetry={() => { void load(); }} />;
  if (!teams) return <SkeletonRows rows={3} />;

  return (
    <div className="flex flex-col gap-6">
      <TeamsCard
        canEdit={canEdit}
        empty={teams.length === 0}
        naming={naming}
        onNaming={setNaming}
        focusSignal={createSignal}
        onMade={(team) => setTeams((list) => [...(list ?? []), team].sort((a, b) => a.name.localeCompare(b.name)))}
      />
      {teams.map((t) => <TeamCard key={t.id} team={t} canEdit={canEdit} onChanged={() => { void load(); }} />)}
    </div>
  );
}

/**
 * The first card: what a team is, and for Owners and Admins, once the
 * toolbar's New team (or the empty line's Name one) opens it, the name row:
 * the field at its own 560px, Make team and Cancel. With no teams, the one
 * "No teams yet" line. `naming` and `onNaming` hold the row open from the
 * tab; drawn alone the card holds it itself.
 */
export function TeamsCard({
  canEdit,
  empty,
  onMade,
  naming,
  onNaming,
  focusSignal = 0,
}: {
  canEdit: boolean;
  empty: boolean;
  onMade: (team: Team) => void;
  naming?: boolean;
  onNaming?: (open: boolean) => void;
  /** Each press of New team: the field takes focus again, even when the row is already open. */
  focusSignal?: number;
}) {
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = canEdit && (naming ?? ownOpen);
  const setOpen = onNaming ?? setOwnOpen;
  const nameRef = useRef<HTMLInputElement>(null);
  const { toast } = useOsToast();
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open, focusSignal]);
  const close = () => { setOpen(false); setDraft(""); setCreateError(null); };

  const create = async () => {
    const name = draft.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    const r = await apiFetch<{ team: Team }>("/api/settings/teams", { method: "POST", json: { name } });
    setCreating(false);
    if (!r.ok) {
      setCreateError(r.status === 409 ? "A team with that name already exists." : r.error || "Couldn't make the team");
      return;
    }
    setDraft("");
    setOpen(false);
    onMade(r.data.team);
    toast(`Team ${r.data.team.name} made`);
  };

  return (
    <SettingsCard title="Teams" description={TEAMS_INTRO}>
      {empty ? (
        <p className="m-0 text-base text-ink-2">
          No teams yet
          {canEdit && !open ? (
            <>
              {" · "}
              <button type="button" className="text-brand-deep underline underline-offset-2" onClick={() => setOpen(true)}>Name one</button>
            </>
          ) : null}
        </p>
      ) : null}
      {open ? (
        <form
          className="flex w-full max-w-[560px] items-start gap-2"
          onSubmit={(e) => { e.preventDefault(); void create(); }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <input
              ref={nameRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") close(); }}
              maxLength={80}
              placeholder="New team name"
              aria-label="New team name"
              className="h-9 rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
            />
            {createError ? <p className="m-0 text-sm text-danger-text" role="alert">{createError}</p> : null}
          </div>
          <button type="submit" disabled={!draft.trim() || creating} className={cn(btn.secondary, "h-9 shrink-0")}>
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Make team
          </button>
          <button type="button" onClick={close} className={cn(btn.ghost, "h-9 shrink-0")}>
            Cancel
          </button>
        </form>
      ) : null}
    </SettingsCard>
  );
}

export function TeamCard({ team, canEdit, onChanged }: { team: Team; canEdit: boolean; onChanged: () => void }) {
  const { boot } = useBoot();
  // The one dialog's door: Owners and Admins, and this team's leads.
  const isLead = team.members.some((m) => m.id === boot.viewer.id && m.lead);
  const [manageOpen, setManageOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickerOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(team.name);
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(async () => {
      const r = await apiFetch<{ people?: Array<{ id: string; firstName?: string | null; lastName?: string | null; email?: string | null; avatar?: string | null }> }>(pickUrl(q.trim(), team.members.map((m) => m.id)), { cache: "no-store" });
      if (!alive) return;
      const people = r.ok ? r.data.people ?? [] : [];
      setResults(people.map((p) => ({ value: p.id, label: nameOf(p), description: p.email ?? undefined, glyph: <Avatar person={{ id: p.id, firstName: p.firstName, lastName: p.lastName, avatar: p.avatar, email: p.email }} size={16} /> })));
    }, q ? 200 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, team.members]);

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setErr(null);
    const r = await apiFetch(`/api/settings/teams/${team.id}`, { method: "PATCH", json: body });
    setBusy(false);
    if (!r.ok) {
      setErr(r.status === 409 ? "A team with that name already exists." : r.error || "Couldn't save");
      return false;
    }
    onChanged();
    return true;
  };

  const rename = async () => {
    const next = nameDraft.trim();
    if (!next || next === team.name) { setRenaming(false); setNameDraft(team.name); return; }
    if (await patch({ name: next })) setRenaming(false);
  };

  const archive = async () => {
    const ok = await confirm({ title: `Archive ${team.name}?`, description: "The team leaves this list. The people in it are not changed.", confirmLabel: "Archive team" });
    if (!ok) return;
    const r = await apiFetch(`/api/settings/teams/${team.id}`, { method: "DELETE" });
    if (!r.ok) setErr(r.error || "Couldn't archive the team");
    else onChanged();
  };

  // Add people: a text link under the rows, or the action of the empty line
  // when there are none (one Picker, wherever its link is).
  const addPeople = canEdit ? (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} className="text-base font-medium text-brand-deep hover:underline">
        Add people
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        alwaysSearch
        onSearchChange={setQ}
        searchPlaceholder="Find a person"
        ariaLabel={`People to add to ${team.name}`}
        width={320}
        autoPlace
        selected={[]}
        loading={results === null}
        emptyLabel={q.trim() ? `No one matches "${q.trim()}"` : "No one else to add"}
        onSelect={(id) => { setOpen(false); void patch({ add: [id] }); }}
        sections={[{ options: results ?? [] }]}
      />
    </span>
  ) : null;

  return (
    <SettingsCard
      title={renaming ? undefined : team.name}
      description={renaming ? undefined : peopleCount(team.members.length)}
      actions={
        renaming ? undefined : (
          <>
            {boot.org.objectShare && (canEdit || isLead) && !renaming ? (
              <button type="button" onClick={() => setManageOpen(true)} aria-haspopup="dialog" className={btn.ghost}>
                Manage people
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" onClick={() => { setNameDraft(team.name); setRenaming(true); }} aria-label={`Rename ${team.name}`} className={btn.ghost}>
                Rename
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" onClick={() => { void archive(); }} aria-label={`Archive ${team.name}`} className={btn.ghost}>
                Archive
              </button>
            ) : null}
          </>
        )
      }
    >
      {renaming ? (
        <form className="flex w-full max-w-[560px] items-center gap-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setRenaming(false); setNameDraft(team.name); } }}
            maxLength={80}
            autoFocus
            aria-label={`New name for ${team.name}`}
            className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-3 text-base text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
          />
          <button type="submit" disabled={busy || !nameDraft.trim()} className={cn(btn.secondary, "h-9 shrink-0")}>
            Save
          </button>
          <button type="button" onClick={() => { setRenaming(false); setNameDraft(team.name); }} className={cn(btn.ghost, "shrink-0")}>
            Cancel
          </button>
        </form>
      ) : null}
      {/* A div, not a p: the Add people Picker it holds draws divs (Phase 4 review, L8). */}
      {team.members.length === 0 ? (
        <div className="m-0 text-base text-ink-2">
          No people in this team yet
          {addPeople ? <>{" · "}{addPeople}</> : null}
        </div>
      ) : (
        <>
          <div>
            {team.members.map((m) => (
              <SettingsRow
                key={m.id}
                label={
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar person={{ id: m.id, firstName: m.firstName, lastName: m.lastName, avatar: m.avatar, email: m.email }} size={24} />
                    <span className="min-w-0 truncate">{nameOf(m)}</span>
                  </span>
                }
                control={
                  canEdit ? (
                    <>
                      {/* The visible "Lead" is the switch's label, so a click on
                          it toggles the switch too (the switch's own name,
                          leadSwitchName, says whose it is; the word is hidden
                          from the reader so it is not read twice). While a
                          change is saving the switch is held with
                          aria-disabled, never disabled, so focus stays on it
                          (Phase 4 review, L7). */}
                      <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                        <label htmlFor={leadSwitchId(team.id, m.id)} aria-hidden className={busy ? "cursor-default" : "cursor-pointer"}>Lead</label>
                        <Switch id={leadSwitchId(team.id, m.id)} checked={m.lead} aria-disabled={busy} aria-label={leadSwitchName(nameOf(m))} onChange={(next) => { void patch({ lead: { userId: m.id, lead: next } }); }} />
                      </span>
                      <button type="button" disabled={busy} onClick={() => { void patch({ remove: [m.id] }); }} aria-label={`Take ${nameOf(m)} off ${team.name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </>
                  ) : m.lead ? <span className="text-sm text-ink-2">Lead</span> : null
                }
              />
            ))}
          </div>
          {addPeople ? <div>{addPeople}</div> : null}
        </>
      )}
      {err ? <p className="m-0 text-sm text-danger-text" role="alert">{err}</p> : null}
      {boot.org.objectShare ? (
        <ShareDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          target={{ kind: "team", id: team.id, name: team.name }}
          onChanged={() => onChanged()}
        />
      ) : null}
    </SettingsCard>
  );
}
