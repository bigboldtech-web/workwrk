"use client";

// Members > Teams (access-model-spec 3.4, Phase 8 stage E): named groups of
// people. Owners and Admins make a Team, rename it (Rename in the card
// header), add and remove people, mark a lead and archive it; everyone who
// opens Members reads them. The caption is honest about what a Team does
// today: it is a saved group, and sharing with a whole Team arrives with the
// new access engine (a Team is not yet a principal in the share dialog). The
// Lead mark is a label on the Team today: nothing else reads it yet.
//
// While the one share dialog serves teams (ACCESS_V2_TABLES on, batch 7) a
// card also has Manage people, for Owners and Admins and for the team's own
// leads, who add and take off its members there (only Owners and Admins
// make someone a lead).

import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { pickUrl } from "@/components/access/manage-access-model";
import { Avatar } from "@/components/ui/avatar-stack";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { ShareDialog } from "@/components/access/share-dialog";

interface TeamPerson { id: string; firstName: string | null; lastName: string | null; email: string; avatar: string | null; lead: boolean }
interface Team { id: string; name: string; description: string | null; members: TeamPerson[] }

const nameOf = (p: { firstName?: string | null; lastName?: string | null; email?: string | null }) =>
  `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone";

export function TeamsTab() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { toast } = useOsToast();

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
    setTeams((list) => [...(list ?? []), r.data.team].sort((a, b) => a.name.localeCompare(b.name)));
    toast(`Team ${r.data.team.name} made`);
  };

  if (error) return <ErrorState what="the teams" hint={error} onRetry={() => { void load(); }} />;
  if (!teams) return <SkeletonRows rows={3} />;

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <p className="m-0 text-base text-ink-2">
        A team is a named group of people, such as Design or Support. Today a team is a saved list; sharing something with a whole team arrives with the new access engine.
      </p>
      {canEdit ? (
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => { e.preventDefault(); void create(); }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={80}
              placeholder="New team name"
              aria-label="New team name"
              className="h-9 rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3"
            />
            {createError ? <p className="m-0 text-sm text-danger-text" role="alert">{createError}</p> : null}
          </div>
          <button
            type="submit"
            disabled={!draft.trim() || creating}
            className="os-chrome inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:text-ink-3"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Make team
          </button>
        </form>
      ) : null}
      {teams.length === 0 ? (
        <p className="m-0 rounded-lg border border-line bg-raised p-6 text-base text-ink-2">No teams yet.{canEdit ? " Name one above to start." : ""}</p>
      ) : (
        teams.map((t) => <TeamCard key={t.id} team={t} canEdit={canEdit} onChanged={() => { void load(); }} />)
      )}
    </div>
  );
}

function TeamCard({ team, canEdit, onChanged }: { team: Team; canEdit: boolean; onChanged: () => void }) {
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

  return (
    <section className="rounded-lg border border-line bg-raised p-4" aria-label={team.name}>
      <header className="mb-3 flex items-center gap-2">
        {renaming ? (
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setRenaming(false); setNameDraft(team.name); } }}
              maxLength={80}
              autoFocus
              aria-label={`New name for ${team.name}`}
              className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-base text-ink"
            />
            <button type="submit" disabled={busy || !nameDraft.trim()} className="inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-brand-deep hover:bg-hover disabled:text-ink-3">
              Save
            </button>
            <button type="button" onClick={() => { setRenaming(false); setNameDraft(team.name); }} className="inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
              Cancel
            </button>
          </form>
        ) : (
          <h3 className="m-0 min-w-0 flex-1 truncate text-row font-semibold text-ink">{team.name}</h3>
        )}
        <span className="text-sm text-ink-2">{team.members.length === 1 ? "1 person" : `${team.members.length} people`}</span>
        {boot.org.objectShare && (canEdit || isLead) && !renaming ? (
          <button type="button" onClick={() => setManageOpen(true)} aria-haspopup="dialog" className="inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
            Manage people
          </button>
        ) : null}
        {canEdit && !renaming ? (
          <button type="button" onClick={() => { setNameDraft(team.name); setRenaming(true); }} className="inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
            Rename
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" onClick={() => { void archive(); }} className="inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
            Archive
          </button>
        ) : null}
      </header>
      {team.members.length === 0 ? <p className="m-0 mb-2 text-sm text-ink-2">Nobody yet.</p> : null}
      <ul className="m-0 flex list-none flex-col p-0">
        {team.members.map((m) => (
          <li key={m.id} className="flex h-10 items-center gap-2 border-b border-line-soft last:border-b-0">
            <Avatar person={{ id: m.id, firstName: m.firstName, lastName: m.lastName, avatar: m.avatar, email: m.email }} size={24} />
            <span className="min-w-0 flex-1 truncate text-base text-ink">{nameOf(m)}</span>
            {canEdit ? (
              <label className="inline-flex items-center gap-1.5 text-sm text-ink-2">
                <input type="checkbox" checked={m.lead} disabled={busy} onChange={(e) => { void patch({ lead: { userId: m.id, lead: e.target.checked } }); }} className="h-4 w-4 accent-[var(--os-brand)]" />
                Lead
              </label>
            ) : m.lead ? <span className="text-sm text-ink-2">Lead</span> : null}
            {canEdit ? (
              <button type="button" disabled={busy} onClick={() => { void patch({ remove: [m.id] }); }} aria-label={`Take ${nameOf(m)} off ${team.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink">
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div className="relative mt-2">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-brand-deep hover:bg-hover">
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Add people
          </button>
          <Picker
            open={open}
            onClose={() => setOpen(false)}
            alwaysSearch
            onSearchChange={setQ}
            searchPlaceholder="Find a person"
            ariaLabel={`People to add to ${team.name}`}
            width={320}
            selected={[]}
            loading={results === null}
            emptyLabel={q.trim() ? `No one matches "${q.trim()}"` : "No one else to add"}
            onSelect={(id) => { setOpen(false); void patch({ add: [id] }); }}
            sections={[{ options: results ?? [] }]}
          />
        </div>
      ) : null}
      {err ? <p className="m-0 mt-2 text-sm text-danger-text" role="alert">{err}</p> : null}
      {boot.org.objectShare ? (
        <ShareDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          target={{ kind: "team", id: team.id, name: team.name }}
          onChanged={() => onChanged()}
        />
      ) : null}
    </section>
  );
}
