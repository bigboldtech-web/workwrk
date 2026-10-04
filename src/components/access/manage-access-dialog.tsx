"use client";

// ManageAccessDialog: the ONE dialog for who can open a Space, a Folder, a
// List, a doc (with its sub-pages), a table, a canvas or a form (decisions A1
// and A7). Every "..." menu and every Share control in a title row opens it
// through ShareDialog, so the same person sees the same list, the same roles
// and the same words wherever they start.
//
// WHAT IT READS. GET /api/access/<kind>/<id>, the AccessPanel: the node, what
// the viewer may do and grant, the people listed on the node itself, the
// people who reach it from above (grouped by where, never naming a container
// the viewer cannot open), everyone at the org, the admins line, and the
// general settings each kind already had. Nothing here guesses a role.
//
// WHAT IT WRITES, and how. People go through /api/access/<kind>/<id>/grants
// only (POST { userId, role, expected } and DELETE ?userId=&expected=); the
// general settings go through each kind's own route (general-access.tsx).
// There is no optimistic write: a row shows a quiet busy mark, and on a 200
// the whole panel is replaced by the one the server sends back, so the list
// is always what the server holds. `expected` is the role the row showed:
// when someone else changed that person in the meantime the server answers
// 409 with a fresh panel, which replaces the list while the person's own
// change (the picker selection, the chosen role, the row's draft) stays on
// screen with Retry. Any other failure keeps everything as it was, with a
// Retry that sends the same body again. Data is never lost to a failed write.
//
// READ-ONLY applies to the node the host opened. After a "Manage in <name>"
// door the dialog follows what the server says the viewer may do there
// (problem 49), and a Back arrow returns to the host's node.
//
// ESC closes the top layer only: a picker open inside the dialog closes first
// (the shell's LayerStack), never the dialog under it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Building2, Link2, Mail, MapPin, UserPlus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { SkeletonLines } from "@/components/ui/skeleton";
import { Dots } from "@/components/ui/dots";
import { Avatar } from "@/components/ui/avatar-stack";
import { ViewTab, ViewTabStrip } from "@/components/ui/view-tabs";
import { useConfirm } from "@/components/ui/dialog-provider";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useLayer, useOsShell } from "@/components/layout/os/shell-context";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import { copyObjectLink } from "@/components/layout/os/use-object-href";
import {
  InlineRetry, SpaceDepartmentAdd, SpaceEmailInvites, SpaceOfficeAdd, type BulkGrant,
} from "@/components/layout/os/share-space-dialog";
import { accessChanged } from "@/lib/work/container-events";
import {
  ACCESS_NODE_NOUN, isObjectShareKind, panelRoleBlurb, panelRoleLabel, shareRoleLabel,
  type AccessDirectEntry, type AccessNodeKind, type AccessPanel, type GrantErrorCode, type GrantWriteBody,
  type GrantWriteResult, type PanelRole, type ShareKind,
} from "@/lib/access/access-panel";
import {
  canEditEntry, canManageHere, canRemoveEntry, defaultRole, dialogSubtitle, dialogTitle, entryRoleOptions,
  errorText, everyoneHint, grantsUnavailableText, grantsUrl, keptHigherText, lowersOwnManage, manageableSpaceVia, notepadText,
  panelUrl, parseGrantError, pickUrl, refusedByOwnAccess, removalNotice, removeConfirm, roleOptions, SELF_LOWER_CONFIRM,
  strayFailureText,
} from "./manage-access-model";
import {
  AccessPersonRow, AccessSectionHeading, DirectAccessList, DirectEntrySub, EveryoneAndAdmins, InheritedAccess,
  OwnerChip, RoleWord, type ManageInTarget,
} from "./who-has-access";
import { GeneralAccess } from "./general-access";

export interface ManageAccessTarget {
  kind: ShareKind;
  id: string;
  name: string;
}

export interface ManageAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ManageAccessTarget | null;
  /** The host's node only: the viewer may read who has access but not change it. */
  readOnly?: boolean;
  /** After every change the server agreed to, with the host node's fresh panel (null: the viewer lost access). */
  onChanged?: (panel: AccessPanel | null) => void;
}

const CONTAINERS: ReadonlySet<ShareKind> = new Set<ShareKind>(["space", "folder", "list"]);

type Load =
  | { state: "loading"; key: string }
  | { state: "failed"; key: string; code: GrantErrorCode }
  | { state: "ready"; key: string; panel: AccessPanel };

type PanelFetch = { ok: true; panel: AccessPanel } | { ok: false; code: GrantErrorCode };

type WriteOutcome =
  | { ok: true; result: GrantWriteResult }
  | { ok: false; code: GrantErrorCode; message: string; panel: AccessPanel | null | undefined };

type WriteRequest =
  | { method: "POST"; body: GrantWriteBody }
  | { method: "DELETE"; userId: string; expected: PanelRole | null };

const keyOf = (t: { kind: ShareKind; id: string } | null) => (t ? `${t.kind}:${t.id}` : "");

/** The panel, whichever envelope the route answers with. */
function readPanel(body: unknown): AccessPanel | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { node?: unknown; panel?: { node?: unknown } };
  if (b.node && typeof b.node === "object") return body as AccessPanel;
  if (b.panel && typeof b.panel === "object" && b.panel.node) return b.panel as AccessPanel;
  return null;
}

async function fetchPanel(t: { kind: ShareKind; id: string }): Promise<PanelFetch> {
  try {
    const res = await fetch(panelUrl(t.kind, t.id), { cache: "no-store" });
    const body = await res.json().catch(() => null);
    const panel = res.ok ? readPanel(body) : null;
    if (panel) return { ok: true, panel };
    return { ok: false, code: parseGrantError(res.ok ? 500 : res.status, body).code };
  } catch {
    return { ok: false, code: "server_error" };
  }
}

async function sendGrant(t: { kind: ShareKind; id: string }, req: WriteRequest): Promise<WriteOutcome> {
  const url = grantsUrl(t.kind, t.id);
  let res: Response;
  try {
    res = req.method === "POST"
      ? await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req.body) })
      : await fetch(`${url}?${new URLSearchParams({ userId: req.userId, expected: req.expected ?? "" }).toString()}`, { method: "DELETE" });
  } catch {
    return { ok: false, code: "server_error", message: "Could not reach the server. Your changes are kept.", panel: undefined };
  }
  const body = await res.json().catch(() => null);
  if (res.ok && body && typeof body === "object" && "change" in body) return { ok: true, result: body as GrantWriteResult };
  const { code, panel } = parseGrantError(res.status, body);
  return { ok: false, code, message: errorText(code, t.kind), panel };
}

/** The dialog, keyed so every open starts at the host's node with nothing left over. */
export function ManageAccessDialog(props: ManageAccessDialogProps) {
  const { open, onOpenChange, target } = props;
  const hostKey = keyOf(target);
  if (!target) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <ManageAccessBody key={hostKey} {...props} target={target} /> : null}
    </Dialog>
  );
}

function ManageAccessBody({
  onOpenChange, target, readOnly = false, onChanged,
}: ManageAccessDialogProps & { target: ManageAccessTarget }) {
  const { boot } = useBoot();
  const meId = boot.viewer.id ?? null;
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { closeTopLayer } = useOsShell();
  const contentRef = useRef<HTMLDivElement>(null);

  // The node on screen: the host's, until a "Manage in <name>" door moves it.
  const [current, setCurrent] = useState<ManageAccessTarget>(target);
  const currentKey = keyOf(current);
  const isHost = currentKey === keyOf(target);
  const ro = isHost ? readOnly : false;

  const [load, setLoad] = useState<Load>({ state: "loading", key: currentKey });
  const [reloadKey, setReloadKey] = useState(0);
  const panel = load.state === "ready" && load.key === currentKey ? load.panel : null;

  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; });

  // Esc goes through the LayerStack, so an open picker closes before the dialog.
  useLayer(true, { kind: "dialog", close: () => onOpenChange(false) });

  useEffect(() => {
    let alive = true;
    const key = currentKey;
    // A tick after the effect: the reset is a setState, and a synchronous
    // one from an effect cascades a render.
    const t = setTimeout(async () => {
      setLoad((l) => (l.key === key && l.state === "ready" ? l : { state: "loading", key }));
      const r = await fetchPanel(current);
      if (!alive) return;
      setLoad(r.ok ? { state: "ready", key, panel: r.panel } : { state: "failed", key, code: r.code });
    }, 0);
    return () => { alive = false; clearTimeout(t); };
    // `current` is read through its key: the object changes identity only with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, reloadKey]);

  const setPanel = useCallback((p: AccessPanel) => {
    setLoad({ state: "ready", key: keyOf(p.node), panel: p });
  }, []);

  /** Tell the host, the tree and every open surface that access changed. */
  const announce = useCallback(async (of: ManageAccessTarget, fresh: AccessPanel | null) => {
    if (CONTAINERS.has(of.kind)) {
      accessChanged({ kind: of.kind as "space" | "folder" | "list", id: of.id });
      refreshSidebar();
    } else {
      accessChanged({ id: of.id });
    }
    if (keyOf(of) === keyOf(target)) {
      onChangedRef.current?.(fresh);
      return;
    }
    // A change made behind a "Manage in" door can change what the host's own
    // node shows too: hand the host ITS panel, never the ancestor's.
    const own = await fetchPanel(target);
    if (own.ok) onChangedRef.current?.(own.panel);
    else if (own.code === "not_found") onChangedRef.current?.(null);
  }, [target]);

  /** A write came back 200: show the server's panel, or close when the viewer lost access. */
  const applyResult = useCallback((of: ManageAccessTarget, result: GrantWriteResult): boolean => {
    void announce(of, result.panel);
    if (!result.panel) {
      toast(`You no longer have access to ${of.name}.`);
      onOpenChange(false);
      return false;
    }
    setPanel(result.panel);
    return true;
  }, [announce, onOpenChange, setPanel, toast]);

  /** After a general change: the server's panel, fetched again. */
  const refetchAfterGeneral = useCallback(async () => {
    const of = current;
    const r = await fetchPanel(of);
    if (r.ok) {
      setPanel(r.panel);
      void announce(of, r.panel);
    } else if (r.code === "not_found") {
      void announce(of, null);
      toast(`You no longer have access to ${of.name}.`);
      onOpenChange(false);
    } else {
      setReloadKey((n) => n + 1);
    }
  }, [announce, current, onOpenChange, setPanel, toast]);

  /**
   * A write refused because the viewer's own access changed under them
   * (forbidden, not found): the panel on screen is stale, so it is fetched
   * again. The dialog then shows what they can do now: fewer roles to offer,
   * "Who has access" read-only, or closed when they lost the node. The input
   * stays where it was while they can still manage here.
   */
  const refetchAfterRefusal = useCallback(async () => {
    const of = current;
    const r = await fetchPanel(of);
    if (r.ok) {
      setPanel(r.panel);
      if (!canManageHere(r.panel, ro)) toast("Your access here changed, so you can no longer change who can open it.");
    } else if (r.code === "not_found") {
      void announce(of, null);
      toast(`You no longer have access to ${of.name}.`);
      onOpenChange(false);
    }
  }, [announce, current, onOpenChange, ro, setPanel, toast]);

  const manageIn = useCallback((t: ManageInTarget) => setCurrent({ kind: t.kind, id: t.id, name: t.name }), []);

  const manage = canManageHere(panel, ro);
  const title = dialogTitle(panel, ro);
  const subtitle = panel ? dialogSubtitle(panel) : `${ACCESS_NODE_NOUN[current.kind]} · ${current.name}`;

  // A container and an object the one dialog serves beside the nodes (an SOP
  // folder, a tool, a goal, a team) link to the page the panel names; a node
  // object to its canonical address.
  const linkFromPanel = CONTAINERS.has(current.kind) || isObjectShareKind(current.kind);
  const copyLink = () => {
    const text = linkFromPanel
      ? panel ? `${window.location.origin}${panel.node.href}` : null
      : copyObjectLink(current.kind as "doc" | "table" | "canvas" | "form", current.id);
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" }));
  };
  const canCopy = !linkFromPanel || !!panel;

  return (
    <DialogContent
      ref={contentRef}
      className="os-chrome flex max-h-[85vh] max-w-[560px] flex-col gap-0 overflow-visible border-line bg-raised p-0 text-ink outline-none"
      onEscapeKeyDown={(e) => { e.preventDefault(); closeTopLayer(); }}
      // Focus starts on the dialog itself. Radix would take the first
      // control, and while the panel loads that is Done in the footer,
      // which kept its ring after the list arrived.
      onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus(); }}
    >
      <div className="mt-1 flex h-10 shrink-0 items-center gap-1.5 ps-5 pe-12">
        {!isHost ? (
          <button
            type="button"
            onClick={() => setCurrent(target)}
            aria-label={`Back to ${target.name}`}
            title={`Back to ${target.name}`}
            className="-ms-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
        <DialogTitle className="min-w-0 truncate text-lg font-semibold text-ink">{title}</DialogTitle>
      </div>
      <DialogDescription className="m-0 -mt-1 truncate px-5 pb-3 text-sm text-ink-2">{subtitle}</DialogDescription>

      {load.state !== "ready" || !panel ? (
        <div className="border-t border-line px-5 py-4">
          {load.state === "failed" ? (
            <OsEmptyView
              variant="error"
              compact
              title={load.code === "not_found" ? errorText("not_found", current.kind) : "Couldn't load who has access."}
              action={{ label: "Retry", onClick: () => setReloadKey((n) => n + 1) }}
            />
          ) : (
            <SkeletonLines lines={4} />
          )}
        </div>
      ) : panel.node.notepadOwner ? (
        <div className="border-t border-line px-5 py-4">
          <p className="m-0 text-base text-ink">{notepadText(panel.node.notepadOwner, meId)}</p>
        </div>
      ) : (
        <>
          {manage ? (
            <AddPeople
              key={currentKey}
              panel={panel}
              meId={meId}
              send={(req) => sendGrant(current, req)}
              apply={(result) => applyResult(current, result)}
              onConflictPanel={setPanel}
              onRefused={() => void refetchAfterRefusal()}
              onManageIn={manageIn}
              toast={toast}
            />
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 py-4">
            <div className="flex flex-col gap-5">
              <GeneralAccess panel={panel} meId={meId} canChange={manage} onChanged={() => void refetchAfterGeneral()} onManageIn={manageIn} />
              <section>
                <AccessSectionHeading>People with access</AccessSectionHeading>
                {manage ? (
                  <DirectRows
                    key={currentKey}
                    panel={panel}
                    meId={meId}
                    send={(req) => sendGrant(current, req)}
                    apply={(result) => applyResult(current, result)}
                    onConflictPanel={setPanel}
                    onRefused={() => void refetchAfterRefusal()}
                    confirm={confirm}
                    toast={toast}
                  />
                ) : (
                  <DirectAccessList panel={panel} meId={meId} />
                )}
              </section>
              <InheritedAccess panel={panel} meId={meId} onManageIn={manageIn} />
              <EveryoneAndAdmins panel={panel} />
              {manage ? <CheckAccess key={`check-${currentKey}`} target={current} meId={meId} /> : null}
            </div>
          </div>
        </>
      )}

      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-t border-line px-5">
        {canCopy && !(panel?.node.notepadOwner) ? (
          <button type="button" onClick={copyLink} className="-ms-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
            <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy link
          </button>
        ) : <span />}
        <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-8 items-center rounded-md border border-line-strong bg-raised px-3 text-sm font-medium text-ink hover:bg-hover">
          Done
        </button>
      </div>
    </DialogContent>
  );
}

/* ───────────────────────────── (a) Add people ───────────────────────────── */

type Tab = "people" | "departments" | "offices" | "email";

interface PickPerson { id: string; name: string; email: string | null; avatar: string | null; firstName: string | null; lastName: string | null }

function toPickPerson(p: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; avatar?: string | null }): PickPerson {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.email || "Someone";
  return { id: p.id, name, email: p.email ?? null, avatar: p.avatar ?? null, firstName: p.firstName ?? null, lastName: p.lastName ?? null };
}

function AddPeople({
  panel, meId, send, apply, onConflictPanel, onRefused, onManageIn, toast,
}: {
  panel: AccessPanel;
  meId: string | null;
  send: (req: WriteRequest) => Promise<WriteOutcome>;
  apply: (result: GrantWriteResult) => boolean;
  onConflictPanel: (p: AccessPanel) => void;
  onRefused: () => void;
  onManageIn: (t: ManageInTarget) => void;
  toast: ReturnType<typeof useOsToast>["toast"];
}) {
  const kind = panel.node.kind;
  const options = roleOptions(panel);
  const [tab, setTab] = useState<Tab>("people");
  const [role, setRole] = useState<PanelRole | null>(() => defaultRole(options));
  const [selection, setSelection] = useState<PickPerson[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; code: GrantErrorCode; personId: string } | null>(null);
  // After a conflict the Retry sends the role the fresh list shows for that
  // person, not null, so it is checked against what is there now. Add only
  // ever raises (mode "raise"): a Retry never lowers what someone else just
  // gave that person.
  const [expectedFor, setExpectedFor] = useState<Record<string, PanelRole | null>>({});
  const roleNow = role && options.includes(role) ? role : defaultRole(options);

  if (!panel.grantsAvailable) {
    const spaceVia = kind === "canvas" ? manageableSpaceVia(panel) : null;
    return (
      <div className="border-t border-line px-5 py-3">
        <AccessSectionHeading>Add people</AccessSectionHeading>
        <p className="m-0 text-sm text-ink-2">{grantsUnavailableText(kind)}</p>
        {spaceVia ? (
          <button
            type="button"
            onClick={() => onManageIn({ kind: "space", id: spaceVia.id, name: spaceVia.name })}
            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-3 text-sm font-medium text-ink hover:bg-hover"
          >
            <UserPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Manage access to {spaceVia.name}
          </button>
        ) : null}
      </div>
    );
  }
  if (!roleNow) return null;

  const directIds = panel.direct.map((d) => d.person.id);

  // One person after another, so a failure stops with the rest still chosen:
  // the person it stopped on and everyone after them stay in the field.
  const addSelected = async (expected: Record<string, PanelRole | null>) => {
    if (busy || selection.length === 0) return;
    setBusy(true);
    setFailure(null);
    let queue = selection;
    while (queue.length > 0) {
      const p = queue[0];
      const out = await send({ method: "POST", body: { userId: p.id, role: roleNow, expected: expected[p.id] ?? null, mode: "raise" } });
      if (!out.ok) {
        if (out.code === "conflict" && out.panel) onConflictPanel(out.panel);
        if (refusedByOwnAccess(out.code)) onRefused();
        setFailure({ message: out.message, code: out.code, personId: p.id });
        setSelection(queue);
        setBusy(false);
        return;
      }
      queue = queue.slice(1);
      setSelection(queue);
      setExpectedFor((m) => { const next = { ...m }; delete next[p.id]; return next; });
      const kept = keptHigherText(out.result.change, p.name, roleNow, kind);
      if (kept) toast(kept);
      if (!apply(out.result)) return;
    }
    setBusy(false);
    setPickerOpen(false);
  };

  const retry = () => {
    if (failure?.code === "conflict") {
      // Over what the fresh list shows for that person now, knowingly.
      const fresh = panel.direct.find((d) => d.person.id === failure.personId)?.role ?? null;
      const next = { ...expectedFor, [failure.personId]: fresh };
      setExpectedFor(next);
      void addSelected(next);
      return;
    }
    void addSelected(expectedFor);
  };

  const grantOne: BulkGrant = async (person) => {
    const out = await send({ method: "POST", body: { userId: person.id, role: roleNow, mode: "raise" } });
    if (out.ok) return apply(out.result) ? { ok: true } : { ok: false, message: "You no longer have access here." };
    if (out.code === "conflict" && out.panel) onConflictPanel(out.panel);
    if (refusedByOwnAccess(out.code)) onRefused();
    return { ok: false, message: out.message };
  };

  const hint = everyoneHint(panel, roleNow);
  const roleSelect = (
    <select
      aria-label="Access for the people you add"
      value={roleNow}
      onChange={(e) => setRole(e.target.value as PanelRole)}
      className="h-9 shrink-0 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink focus:outline-none focus-visible:border-brand"
    >
      {options.map((r) => <option key={r} value={r}>{shareRoleLabel(kind, r)}</option>)}
    </select>
  );

  return (
    <div className="border-t border-line px-5 pb-3 pt-2">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <AccessSectionHeading>Add people</AccessSectionHeading>
        {kind === "space" ? (
          <ViewTabStrip aria-label="Add by" className="h-8 border-0 p-0">
            <ViewTab icon={UserPlus} label="People" active={tab === "people"} onClick={() => setTab("people")} />
            <ViewTab icon={Building2} label="Departments" active={tab === "departments"} onClick={() => setTab("departments")} />
            <ViewTab icon={MapPin} label="Offices" active={tab === "offices"} onClick={() => setTab("offices")} />
            <ViewTab icon={Mail} label="Email" active={tab === "email"} onClick={() => setTab("email")} />
          </ViewTabStrip>
        ) : null}
      </div>

      {tab === "people" ? (
        <>
          <div className="flex items-start gap-2">
            <PeopleField
              selection={selection}
              excludeIds={directIds}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onToggle={(p) => {
                setFailure(null);
                setSelection((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p]));
              }}
              meId={meId}
            />
            {roleSelect}
            <button
              type="button"
              // With nobody chosen yet, Add opens the picker instead of doing nothing.
              onClick={() => { if (selection.length === 0) setPickerOpen(true); else void addSelected(expectedFor); }}
              aria-busy={busy || undefined}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-medium text-ink-inv hover:bg-brand-hover"
            >
              {busy ? <Dots variant="pending" /> : null} Add
            </button>
          </div>
          <p className="m-0 mt-1.5 text-xs text-ink-2">{shareRoleLabel(kind, roleNow)}: {panelRoleBlurb(kind, roleNow)}</p>
          {hint ? <p className="m-0 mt-1 text-xs text-ink-2">{hint}</p> : null}
          {failure ? <InlineRetry message={failure.message} onRetry={retry} /> : null}
        </>
      ) : tab === "departments" || tab === "offices" ? (
        <>
          <div className="mb-2 flex items-center gap-2 text-sm text-ink-2">
            <span>Add everyone as</span>
            {roleSelect}
          </div>
          {hint ? <p className="m-0 mb-2 text-xs text-ink-2">{hint}</p> : null}
          {tab === "departments"
            ? <SpaceDepartmentAdd roleLabel={panelRoleLabel(roleNow)} grantOne={grantOne} />
            : <SpaceOfficeAdd roleLabel={panelRoleLabel(roleNow)} grantOne={grantOne} />}
        </>
      ) : (
        <SpaceEmailInvites spaceId={panel.node.id} />
      )}
    </div>
  );
}

/**
 * The field the picker hangs from: the chosen people as chips (each with its
 * own remove), and one trigger that opens the picker. Every signed-in person
 * is offered, on leave, on probation, on a PIP or serving notice included
 * (problem 34), minus those already listed here.
 */
function PeopleField({
  selection, excludeIds, open, onOpenChange, onToggle, meId, placeholder, ariaLabel = "People to add",
}: {
  selection: PickPerson[];
  excludeIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (p: PickPerson) => void;
  meId: string | null;
  /** The empty field's words (Check access asks for one person). */
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickPerson[] | null>(null);
  const [failed, setFailed] = useState(false);
  const known = useRef(new Map<string, PickPerson>());
  const excludeKey = excludeIds.join(",");
  // The Picker clears its search box on every open; the query here follows,
  // adjusted during render rather than in an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setQ("");
  }

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(async () => {
      setFailed(false);
      try {
        const res = await fetch(pickUrl(q.trim(), excludeKey ? excludeKey.split(",") : []), { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        const rows: PickPerson[] = (Array.isArray(d?.people) ? d.people : []).map(toPickPerson);
        for (const r of rows) known.current.set(r.id, r);
        if (alive) setResults(rows);
      } catch {
        if (alive) { setFailed(true); setResults([]); }
      }
    }, q ? 200 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, excludeKey]);

  const chosen = useMemo(() => new Set(selection.map((p) => p.id)), [selection]);
  const pickerOptions: PickerOption[] = useMemo(() => {
    // Keep chosen people in the list even when a new search leaves them out,
    // so a check can always be taken off where it was put on.
    const rows = [...selection.filter((s) => !(results ?? []).some((r) => r.id === s.id)), ...(results ?? [])];
    return rows.map((p) => ({
      value: p.id,
      label: p.id === meId ? `${p.name} (you)` : p.name,
      description: p.email ?? undefined,
      keywords: p.email ?? undefined,
      glyph: <Avatar person={{ id: p.id, firstName: p.firstName, lastName: p.lastName, avatar: p.avatar, email: p.email }} size={16} />,
    }));
  }, [results, selection, meId]);

  return (
    <div className="relative min-w-0 flex-1">
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-line-strong bg-raised px-1.5 py-1">
        {selection.map((p) => (
          <span key={p.id} className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-active ps-1 pe-0.5 text-sm text-ink">
            <Avatar person={{ id: p.id, firstName: p.firstName, lastName: p.lastName, avatar: p.avatar, email: p.email }} size={16} />
            <span className="min-w-0 truncate">{p.name}</span>
            <button type="button" onClick={() => onToggle(p)} aria-label={`Take ${p.name} off the list`} className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink">
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="h-6 min-w-[120px] flex-1 rounded px-1 text-start text-base text-ink-3 hover:text-ink-2"
        >
          {selection.length === 0 ? placeholder ?? "Add people by name or email" : placeholder ? "Pick someone else" : "Add more"}
        </button>
      </div>
      <Picker
        open={open}
        onClose={() => onOpenChange(false)}
        multi
        alwaysSearch
        onSearchChange={setQ}
        searchPlaceholder="Find a person"
        ariaLabel={ariaLabel}
        width={320}
        selected={[...chosen]}
        loading={results === null}
        emptyLabel={failed ? "Couldn't load people. Type again to retry." : q.trim() ? `No one matches "${q.trim()}"` : "No one else to add"}
        onSelect={(id) => {
          const p = known.current.get(id) ?? selection.find((s) => s.id === id);
          if (p) onToggle(p);
        }}
        sections={[{ options: pickerOptions }]}
      />
    </div>
  );
}

/* ─────────────────────────── Check access ─────────────────────────── */

/**
 * Check access (access-model-spec 6.1, Phase 8 stage E): for someone who
 * manages who has access here, pick a person and read what they can do and
 * why, in one sentence, from the live resolver (POST /api/access/check).
 */
function CheckAccess({ target, meId }: { target: { kind: ShareKind; id: string }; meId: string | null }) {
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<PickPerson | null>(null);
  const [answer, setAnswer] = useState<{ state: "idle" | "busy" | "done" | "failed"; sentence?: string; message?: string }>({ state: "idle" });

  const run = async (p: PickPerson) => {
    setPerson(p);
    setOpen(false);
    setAnswer({ state: "busy" });
    try {
      const res = await fetch("/api/access/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: p.id, target: { kind: target.kind, id: target.id } }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setAnswer({ state: "failed", message: typeof d?.message === "string" ? d.message : "Couldn't check that person." });
        return;
      }
      setAnswer({ state: "done", sentence: typeof d?.sentence === "string" ? d.sentence : "" });
    } catch {
      setAnswer({ state: "failed", message: "Couldn't check that person." });
    }
  };

  return (
    <section>
      <AccessSectionHeading>Check access</AccessSectionHeading>
      <div className="flex flex-col gap-2">
        <PeopleField
          selection={person ? [person] : []}
          excludeIds={[]}
          open={open}
          onOpenChange={setOpen}
          placeholder="Pick a person to see what they can do here"
          ariaLabel="Person to check"
          onToggle={(p) => {
            if (person?.id === p.id) {
              setPerson(null);
              setAnswer({ state: "idle" });
            } else void run(p);
          }}
          meId={meId}
        />
        {answer.state === "busy" ? <Dots variant="pending" label="Checking" /> : null}
        {answer.state === "done" && person ? (
          <p className="m-0 text-base text-ink" role="status">
            <span className="font-medium">{person.name}</span> · {answer.sentence}
          </p>
        ) : null}
        {answer.state === "failed" ? <p className="m-0 text-sm text-danger-text" role="alert">{answer.message}</p> : null}
      </div>
    </section>
  );
}

/* ─────────────────────────── (c) People with access ─────────────────────────── */

type RowAction = { kind: "role"; role: PanelRole } | { kind: "remove" };
type RowFailure = { name: string; message: string; code: GrantErrorCode; action: RowAction; expected: PanelRole | null };

function DirectRows({
  panel, meId, send, apply, onConflictPanel, onRefused, confirm, toast,
}: {
  panel: AccessPanel;
  meId: string | null;
  send: (req: WriteRequest) => Promise<WriteOutcome>;
  apply: (result: GrantWriteResult) => boolean;
  onConflictPanel: (p: AccessPanel) => void;
  onRefused: () => void;
  confirm: ReturnType<typeof useConfirm>;
  toast: ReturnType<typeof useOsToast>["toast"];
}) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // The change a person asked for on a row, kept on screen while it is in
  // flight and after a failure, until it lands or they choose again.
  const [drafts, setDrafts] = useState<Record<string, RowAction>>({});
  const [failures, setFailures] = useState<Record<string, RowFailure>>({});

  const run = async (userId: string, name: string, action: RowAction, expected: PanelRole | null) => {
    setBusy((b) => ({ ...b, [userId]: true }));
    setDrafts((d) => ({ ...d, [userId]: action }));
    setFailures((f) => { const next = { ...f }; delete next[userId]; return next; });
    const out = action.kind === "role"
      ? await send({ method: "POST", body: { userId, role: action.role, expected } })
      : await send({ method: "DELETE", userId, expected });
    setBusy((b) => { const next = { ...b }; delete next[userId]; return next; });
    if (!out.ok) {
      if (out.code === "conflict" && out.panel) onConflictPanel(out.panel);
      if (refusedByOwnAccess(out.code)) onRefused();
      setFailures((f) => ({ ...f, [userId]: { name, message: out.message, code: out.code, action, expected } }));
      return;
    }
    setDrafts((d) => { const next = { ...d }; delete next[userId]; return next; });
    if (action.kind === "remove") toast(removalNotice(out.result.change, name, panel.node.kind));
    apply(out.result);
  };

  const changeRole = async (entry: AccessDirectEntry, next: PanelRole) => {
    if (next === entry.role) {
      // Back to what the server holds: nothing to send, the pending change goes.
      setDrafts((d) => { const nextDrafts = { ...d }; delete nextDrafts[entry.person.id]; return nextDrafts; });
      setFailures((f) => { const nextFailures = { ...f }; delete nextFailures[entry.person.id]; return nextFailures; });
      return;
    }
    if (lowersOwnManage(panel, entry, next, meId)) {
      const c = SELF_LOWER_CONFIRM(panel.node.kind);
      if (!(await confirm({ ...c, confirmLabel: "Lower my access", destructive: true }))) return;
    }
    await run(entry.person.id, entry.person.name, { kind: "role", role: next }, entry.role);
  };

  const remove = async (entry: AccessDirectEntry) => {
    const self = entry.person.id === meId;
    const c = removeConfirm(self ? "yourself" : entry.person.name, panel, lowersOwnManage(panel, entry, null, meId));
    if (!(await confirm({ ...c, confirmLabel: "Remove", destructive: true }))) return;
    await run(entry.person.id, entry.person.name, { kind: "remove" }, entry.role);
  };

  const retry = (userId: string) => {
    const f = failures[userId];
    if (!f) return;
    // A conflict retries over what the fresh list shows now; anything else
    // sends exactly the same body again.
    const expected = f.code === "conflict" ? panel.direct.find((d) => d.person.id === userId)?.role ?? null : f.expected;
    void run(userId, f.name, f.action, expected);
  };

  const listed = new Set(panel.direct.map((d) => d.person.id));
  const stray = Object.entries(failures).filter(([id]) => !listed.has(id));

  return (
    <>
      {stray.map(([id, f]) => (
        <InlineRetry key={id} message={strayFailureText(f.name, f.message, f.action.kind === "role" ? f.action.role : null, panel.node.kind)} onRetry={() => retry(id)} />
      ))}
      {panel.direct.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">Nobody has been added here directly.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-line-soft p-0">
          {panel.direct.map((entry) => {
            const id = entry.person.id;
            const draft = drafts[id];
            const failure = failures[id];
            const editable = canEditEntry(entry, false);
            const removable = canRemoveEntry(entry, false);
            const shownRole = draft?.kind === "role" ? draft.role : entry.role;
            return (
              <AccessPersonRow
                key={id}
                person={entry.person}
                isYou={id === meId}
                sub={
                  <>
                    <DirectEntrySub entry={entry} showLastFull />
                    {failure ? (
                      <InlineRetry
                        message={failure.action.kind === "remove" ? `Not removed. ${failure.message}` : failure.message}
                        onRetry={() => retry(id)}
                      />
                    ) : null}
                  </>
                }
              >
                {busy[id] ? <Dots variant="pending" /> : null}
                {entry.owner ? (
                  <OwnerChip />
                ) : editable ? (
                  <select
                    aria-label={`Access for ${entry.person.name}`}
                    value={shownRole}
                    onChange={(e) => void changeRole(entry, e.target.value as PanelRole)}
                    aria-busy={busy[id] || undefined}
                    className="h-8 rounded-md border border-line-strong bg-raised px-1.5 text-sm text-ink focus:outline-none focus-visible:border-brand"
                  >
                    {entryRoleOptions(panel, entry).map((r) => <option key={r} value={r}>{shareRoleLabel(panel.node.kind, r)}</option>)}
                  </select>
                ) : (
                  <RoleWord role={entry.role} kind={panel.node.kind} />
                )}
                {removable ? (
                  <button
                    type="button"
                    onClick={() => void remove(entry)}
                    aria-label={`Remove ${entry.person.name}`}
                    title="Remove"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-danger-bg hover:text-danger-text"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </AccessPersonRow>
            );
          })}
        </ul>
      )}
    </>
  );
}
