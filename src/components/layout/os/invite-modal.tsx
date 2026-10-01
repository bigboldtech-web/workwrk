"use client";

// InviteModal — invite people into the org from anywhere (rail "Invite"
// button + Settings → Members header).
//
//   Emails row: multi-email chip input (comma / space / Enter separated)
//   Access level: same ACCESS_LEVELS catalog the Members page uses, cut to
//     the levels this inviter may give (inviteLevelChoices below)
//   Role: optional — the role IS the definition (user 2026-08-27): its
//     KRAs and their published SOPs seed automatically when the invite
//     is accepted. No per-item picking.
//   Personal message: optional note, quoted inside the invite email.
//
// Sends one POST /api/invitations per email; summarizes results in a
// toast. Emails that fail (already invited, already a member, …) stay
// in the chip row so the sender can fix and retry.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Send, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/permissions";
import { resolveInviteLevel } from "@/lib/access/invite-level";
import { useOsToast } from "./toast";
import { useViewerRole } from "./boot-context";
import { Dots } from "@/components/ui/dots";

interface DeptOption {
  id: string;
  name: string;
}

interface RoleOption {
  id: string;
  title: string;
}

interface PersonOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

function personLabel(p: PersonOption): string {
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return name || p.email;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Members > Invite rules: the allowed domains (else the inviter's own). */
  allowedDomains?: string[];
  /** Members > Invite rules: the level preselected for a new invite. */
  defaultLevel?: AccessLevel;
  /** Called after at least one invite went through — refresh pending lists. */
  onSent?: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SUPER_ADMIN is the system owner — never something you invite someone in as.
// AGENT is the "This is an agent account" checkbox below the select (access
// spec 2.4: a Member with the Agent flag), not a rung of its own.
const INVITE_LEVELS = ACCESS_LEVELS.filter((l) => l.value !== "SUPER_ADMIN" && l.value !== "AGENT");

// The text of one Access level option: "Employee: Standard employees".
// The shared ACCESS_LEVELS catalog (lib/permissions) still joins some
// descriptions with an em dash (Company Admin's "Org owner, full access"
// reads that way there), and visible copy never shows one, so any em dash,
// en dash or double hyphen inside a description becomes a comma here
// rather than leaking into the picker.
export function inviteLevelOptionText(l: { label: string; description: string }): string {
  const description = l.description.replace(/\s*(?:\u2014|\u2013|-{2})\s*/g, ", ");
  return `${l.label}: ${description}`;
}

// The invite dialog's own words for Company Admin. The shared catalog's
// "Org owner, full access (cannot be modified)" is wrong here: every other
// screen calls this level Admin, an Admin is not the Owner, and an Admin's
// level can be changed. The catalog also feeds the access page, so the
// override stays local to this dialog.
const INVITE_LEVEL_TEXT: Partial<Record<AccessLevel, { label: string; description: string }>> = {
  COMPANY_ADMIN: { label: "Admin", description: "Full access to the workspace" },
};

export interface InviteLevelChoice {
  value: AccessLevel;
  text: string;
}

/**
 * The Access level options a viewer at `viewerLevel` is offered: only the
 * levels POST /api/invitations would accept from them (the same pure
 * resolveInviteLevel rule), so a Manager is never offered Company Admin, HR
 * or a rung above their own just to be refused after Send. The server still
 * rechecks against the inviter's current level, so a stale level here only
 * shows a stale list, never a real grant.
 */
export function inviteLevelChoices(viewerLevel: string | null | undefined): InviteLevelChoice[] {
  return INVITE_LEVELS.filter((l) => resolveInviteLevel(viewerLevel, l.value).ok).map((l) => ({
    value: l.value,
    text: inviteLevelOptionText(INVITE_LEVEL_TEXT[l.value] ?? l),
  }));
}

/**
 * The level the picker shows: the wanted one when it is on offer, else
 * Employee, else the first level on offer. A default from Invite rules (or a
 * pick made before the session loaded) that this viewer may not give falls
 * back rather than leaving the select on a value it does not list.
 */
export function inviteLevelInChoices(wanted: AccessLevel, choices: InviteLevelChoice[]): AccessLevel {
  if (choices.some((c) => c.value === wanted)) return wanted;
  if (choices.some((c) => c.value === "EMPLOYEE")) return "EMPLOYEE";
  return choices[0]?.value ?? "EMPLOYEE";
}

/**
 * Which level the options are built from. Boot's org role is read fresh
 * from the database on every load, the session can be hours old: an Admin
 * by boot is an Admin, and a session that still says Admin when boot says
 * otherwise (someone just demoted) is not trusted for the admin options.
 */
export function inviteViewerLevel(sessionLevel: string | null | undefined, bootIsAdmin: boolean): string | null {
  if (bootIsAdmin) return "COMPANY_ADMIN";
  if (sessionLevel === "COMPANY_ADMIN" || sessionLevel === "SUPER_ADMIN") return null;
  return sessionLevel ?? null;
}

export function InviteModal({ open, onOpenChange, onSent, allowedDomains, defaultLevel }: Props) {
  const { toast } = useOsToast();

  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [invalidTokens, setInvalidTokens] = useState<string[]>([]);
  const [wrongDomain, setWrongDomain] = useState<string[]>([]);
  const { data: sessionData } = useSession();
  // Company-domain lock: invitees must share the workspace's email
  // domain (the server enforces org.domain ?? inviter's; the signed-in
  // user's domain is the client's best mirror of that rule).
  const ownDomain = sessionData?.user?.email?.split("@")[1]?.toLowerCase() ?? null;
  // Members > Invite rules, read on every open (GET /api/invitations?rules=1,
  // the server's own answer), so every dialog, the topbar one included,
  // starts on the workspace's default role and accepts the domains the
  // server accepts. Props, when a caller passes them, win.
  const [rules, setRules] = useState<{ allowedDomains: string[]; inviteDefaultRole: "ADMIN" | "MEMBER" } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/invitations?rules=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setRules(d && Array.isArray(d.allowedDomains) ? d : null); })
      .catch(() => { if (live) setRules(null); });
    return () => { live = false; };
  }, [open]);
  const { isAdmin } = useViewerRole();
  const domains =
    allowedDomains && allowedDomains.length > 0
      ? allowedDomains
      : rules && rules.allowedDomains.length > 0
        ? rules.allowedDomains
        : ownDomain ? [ownDomain] : [];
  const companyDomain = domains.length > 0 ? domains.map((d) => d).join(", @") : null;
  // The default is only a starting point: what the person picks wins, and a
  // close forgets the pick. Only an Owner or Admin starts on Admin (the
  // server refuses anyone else inviting an Admin).
  const ruleLevel: AccessLevel = defaultLevel ?? (rules?.inviteDefaultRole === "ADMIN" && isAdmin ? ("COMPANY_ADMIN" as AccessLevel) : "EMPLOYEE");
  const [picked, setAccessLevel] = useState<AccessLevel | null>(null);
  const [agent, setAgent] = useState(false);
  const viewerLevel = inviteViewerLevel(sessionData?.user?.accessLevel, isAdmin);
  const levelChoices = useMemo(() => inviteLevelChoices(viewerLevel), [viewerLevel]);
  const chosenLevel: AccessLevel = inviteLevelInChoices(picked ?? ruleLevel, levelChoices);
  const accessLevel: AccessLevel = agent ? ("AGENT" as AccessLevel) : chosenLevel;
  const [message, setMessage] = useState("");

  // Placement — all optional. The Invitation model + POST /api/invitations
  // carry departmentId / roleId / managerId, so a hire can land in the
  // right seat instead of arriving unplaced. Picking a role also lets
  // accept-invite seed KRA weightage from the role's weights.
  const [depts, setDepts] = useState<DeptOption[] | null>(null);
  const [roles, setRoles] = useState<RoleOption[] | null>(null);
  const [people, setPeople] = useState<PersonOption[] | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [sending, setSending] = useState(false);

  // Load the placement catalogs once per open. /api/departments and
  // /api/roles return arrays directly; /api/users wraps rows in { data }.
  useEffect(() => {
    if (!open) return;
    fetch("/api/departments")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDepts(Array.isArray(d) ? (d as DeptOption[]) : []))
      .catch(() => setDepts([]));
    fetch("/api/roles")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRoles(Array.isArray(d) ? (d as RoleOption[]) : []))
      .catch(() => setRoles([]));
    fetch("/api/users?scope=all&limit=200")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPeople((d?.data as PersonOption[]) ?? []))
      .catch(() => setPeople([]));
  }, [open]);


  const reset = useCallback(() => {
    setEmails([]);
    setDraft("");
    setInvalidTokens([]);
    setAccessLevel(null);
    setAgent(false);
    setMessage("");
    setDepartmentId("");
    setRoleId("");
    setManagerId("");
    setSending(false);
  }, []);

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  // Split free text into chips. Anything that doesn't look like an email
  // is surfaced as an invalid token instead of silently dropped.
  const commitDraft = useCallback(
    (text: string) => {
      const tokens = text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
      if (tokens.length === 0) return;
      const good: string[] = [];
      const bad: string[] = [];
      const offDomain: string[] = [];
      for (const t of tokens) {
        const lower = t.toLowerCase();
        if (!EMAIL_RE.test(lower)) { bad.push(t); continue; }
        if (domains.length > 0 && !domains.includes(lower.split("@")[1] ?? "")) { offDomain.push(t); continue; }
        good.push(lower);
      }
      if (good.length > 0) {
        setEmails((prev) => [...prev, ...good.filter((e) => !prev.includes(e))]);
      }
      setInvalidTokens(bad);
      setWrongDomain(offDomain);
      setDraft([...bad, ...offDomain].length > 0 ? [...bad, ...offDomain].join(" ") : "");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [domains.join(",")],
  );

  const onDraftKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      commitDraft(draft);
    } else if (e.key === "Backspace" && draft === "" && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1));
    }
  };


  // The server rejects invites without ≥1 KRA and ≥1 SOP — mirror that
  // gate here so the button state is honest.
  const allEmails = useMemo(() => {
    const d = draft.trim().toLowerCase();
    return EMAIL_RE.test(d) && !emails.includes(d) ? [...emails, d] : emails;
  }, [emails, draft]);
  const canSend =
    allEmails.length > 0 && !sending;

  const handleSend = async () => {
    // Pull any last un-committed draft email into the batch.
    const batch = allEmails;
    if (batch.length === 0) return;
    setSending(true);
    const failed: { email: string; reason: string }[] = [];
    let sent = 0;
    for (const email of batch) {
      try {
        const res = await fetch("/api/invitations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            accessLevel,
            departmentId: departmentId || undefined,
            roleId: roleId || undefined,
            managerId: managerId || undefined,
            message: message.trim() || undefined,
          }),
        });
        if (res.ok) {
          sent += 1;
        } else {
          const d = await res.json().catch(() => ({}));
          failed.push({ email, reason: d?.error ?? `Failed (${res.status})` });
        }
      } catch {
        failed.push({ email, reason: "Network error" });
      }
    }
    setSending(false);
    if (sent > 0) onSent?.();
    if (failed.length === 0) {
      toast(sent === 1 ? "Invite sent" : `${sent} invites sent`);
      handleOpenChange(false);
    } else {
      // Keep the failures in the chip row so the sender can fix + retry.
      setEmails(failed.map((f) => f.email));
      setDraft("");
      toast(
        `${sent} sent · ${failed.length} failed: ${failed[0].reason}`,
      );
    }
  };


  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Invite people</DialogTitle>
        <DialogDescription>
          Teammates get an email with a link to join your workspace. Every
          invite can carry a role: its KRAs, KPIs and SOPs attach automatically.
        </DialogDescription>

        {/* Emails */}
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-500">
            Email addresses
          </label>
          <div
            className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1.5 focus-within:border-[var(--os-brand)]"
          >
            {emails.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 ps-2.5 pe-1 text-sm text-zinc-800"
              >
                {email}
                <button
                  type="button"
                  aria-label={`Remove ${email}`}
                  onClick={() => setEmails((prev) => prev.filter((e) => e !== email))}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (invalidTokens.length > 0) setInvalidTokens([]);
              }}
              onKeyDown={onDraftKeyDown}
              onBlur={() => commitDraft(draft)}
              onPaste={(e) => {
                e.preventDefault();
                commitDraft(`${draft} ${e.clipboardData.getData("text")}`);
              }}
              placeholder={emails.length === 0 ? "name@company.com, another@company.com" : ""}
              className="min-w-[140px] flex-1 bg-transparent text-base text-zinc-800 outline-none placeholder:text-zinc-400"
            />
          </div>
          {wrongDomain.length > 0 ? (
            <p className="mt-1 text-xs text-red-600">
              Only @{companyDomain} addresses can join this workspace: {wrongDomain.join(", ")}
            </p>
          ) : null}
          {invalidTokens.length > 0 ? (
            <p className="mt-1 text-xs text-red-600">
              Not a valid email: {invalidTokens.join(", ")}
            </p>
          ) : null}
        </div>

        {/* Access level */}
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-500">
            Access level
          </label>
          <select
            value={chosenLevel}
            disabled={agent}
            onChange={(e) => setAccessLevel(e.target.value as AccessLevel)}
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-base text-zinc-800 focus:border-[var(--os-brand)] focus:outline-none"
          >
            {levelChoices.map((l) => (
              <option key={l.value} value={l.value}>
                {l.text}
              </option>
            ))}
          </select>
          <label className="mt-2 flex items-start gap-2 text-base text-ink">
            <input type="checkbox" checked={agent} onChange={(e) => setAgent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--os-brand)]" />
            <span>
              This is an agent account
              <span className="block text-sm text-ink-2">A bot or service that works as a Member. It can edit what it is given, never has Full access, and never exports or invites.</span>
            </span>
          </label>
        </div>

        {/* Placement — optional. Department / Role / Manager are carried
            on the Invitation so the hire lands in their seat, not
            unplaced. Picking a Role also drives KRA-weight inheritance
            at accept-invite time. */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-500">
              Department <span className="font-normal normal-case text-zinc-400">(optional)</span>
            </label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-base text-zinc-800 focus:border-[var(--os-brand)] focus:outline-none"
            >
              <option value="">No department</option>
              {(depts ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-500">
              Role <span className="font-normal normal-case text-zinc-400">(optional)</span>
            </label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-base text-zinc-800 focus:border-[var(--os-brand)] focus:outline-none"
            >
              <option value="">No role</option>
              {(roles ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-500">
            Reporting manager <span className="font-normal normal-case text-zinc-400">(optional)</span>
          </label>
          <select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-base text-zinc-800 focus:border-[var(--os-brand)] focus:outline-none"
          >
            <option value="">No manager</option>
            {(people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {personLabel(p)}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-zinc-500">
          Pick a role above and its KRAs, KPIs and published SOPs attach
          automatically when they join. No per-item selection needed.
        </p>

        {/* Personal message */}
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-500">
            Personal message <span className="font-normal normal-case text-zinc-400">(optional)</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Add a note to the invitation email…"
            className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-base text-zinc-800 placeholder:text-zinc-400 focus:border-[var(--os-brand)] focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="h-8 rounded-md px-2.5 text-base font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--os-brand)] px-4 text-base font-medium text-white hover:bg-[#0060B9] disabled:opacity-50"
          >
            {sending ? (
              <Dots variant="pending" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {sending
              ? "Sending…"
              : allEmails.length > 1
                ? `Send ${allEmails.length} invites`
                : "Send invite"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
