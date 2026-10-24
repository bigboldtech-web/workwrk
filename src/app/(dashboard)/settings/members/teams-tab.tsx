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
// is and, for Owners and Admins, the New team name field, which keeps its
// own 560px width inside the card. An empty list or team is one inline
// "No ... yet" line (B10).

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

/** What a team is today, in the first card (the same words the tab always said). */
export const TEAMS_INTRO = "A team is a named group of people, such as Design or Support. Today a team is a saved list; sharing something with a whole team arrives with the new access engine.";

export function TeamsTab() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        onMade={(team) => setTeams((list) => [...(list ?? []), team].sort((a, b) => a.name.localeCompare(b.name)))}
      />
      {teams.map((t) => <TeamCard key={t.id} team={t} canEdit={canEdit} onChanged={() => { void load(); }} />)}
    </div>
  );
}

/**
 * The first card: what a team is, and for Owners and Admins the New team
 * name field (its own 560px inside the card) with Make team; with no teams,
 * the one "No teams yet" line, whose link goes to that field.
 */
export function TeamsCard({ canEdit, empty, onMade }: { canEdit: boolean; empty: boolean; onMade: (team: Team) => void }) {
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const { toast } = useOsToast();

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
    onMade(r.data.team);
    toast(`Team ${r.data.team.name} made`);
  };

  return (
    <SettingsCard title="Teams" description={TEAMS_INTRO}>
      {canEdit ? (
        <form
          className="flex w-full max-w-[560px] items-start gap-2"
          onSubmit={(e) => { e.preventDefault(); void create(); }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <input
              ref={nameRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
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
        </form>
      ) : null}
      {empty ? (
        <p className="m-0 text-base text-ink-2">
          No teams yet
          {canEdit ? (
            <>
              {" · "}
              <button type="button" className="text-brand-deep hover:underline" onClick={() => nameRef.current?.focus()}>Name one</button>
            </>
          ) : null}
        </p>
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
      {team.members.length === 0 ? (
        <p className="m-0 text-base text-ink-2">
          No people in this team yet
          {addPeople ? <>{" · "}{addPeople}</> : null}
        </p>
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
                      <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                        <span aria-hidden>Lead</span>
                        <Switch checked={m.lead} disabled={busy} aria-label={leadSwitchName(nameOf(m))} onChange={(next) => { void patch({ lead: { userId: m.id, lead: next } }); }} />
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
