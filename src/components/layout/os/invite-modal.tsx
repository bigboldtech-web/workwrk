"use client";

// InviteModal — invite people into the org from anywhere (rail "Invite"
// button + Settings → Members header).
//
//   Emails row: multi-email chip input (comma / space / Enter separated)
//   Access level: same ACCESS_LEVELS catalog the Members page uses
//   Role definition: KRA + SOP multi-selects — the POST /api/invitations
//     contract REQUIRES at least one of each (the vision's KRA/SOP-gated
//     entry rule), so the picker is required here too, not decorative.
//   Personal message: optional note, quoted inside the invite email.
//
// Sends one POST /api/invitations per email; summarizes results in a
// toast. Emails that fail (already invited, already a member, …) stay
// in the chip row so the sender can fix and retry.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/permissions";
import { useOsToast } from "./toast";

interface KraOption {
  id: string;
  name: string;
  category?: string | null;
}

interface SopOption {
  id: string;
  title: string;
}

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
  /** Called after at least one invite went through — refresh pending lists. */
  onSent?: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SUPER_ADMIN is the system owner — never something you invite someone in as.
const INVITE_LEVELS = ACCESS_LEVELS.filter((l) => l.value !== "SUPER_ADMIN");

export function InviteModal({ open, onOpenChange, onSent }: Props) {
  const { toast } = useOsToast();

  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [invalidTokens, setInvalidTokens] = useState<string[]>([]);
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("EMPLOYEE");
  const [message, setMessage] = useState("");
  const [kras, setKras] = useState<KraOption[] | null>(null);
  const [sops, setSops] = useState<SopOption[] | null>(null);
  const [kraIds, setKraIds] = useState<Set<string>>(new Set());
  const [sopIds, setSopIds] = useState<Set<string>>(new Set());
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

  // Load the KRA / SOP catalogs once per open.
  useEffect(() => {
    if (!open) return;
    fetch("/api/kras?scope=all&limit=200")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setKras((d?.data as KraOption[]) ?? []))
      .catch(() => setKras([]));
    fetch("/api/sops?limit=200")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSops((d?.data as SopOption[]) ?? []))
      .catch(() => setSops([]));
    // Placement catalogs. /api/departments and /api/roles return arrays
    // directly; /api/users wraps rows in { data }.
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
    setAccessLevel("EMPLOYEE");
    setMessage("");
    setKraIds(new Set());
    setSopIds(new Set());
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
      for (const t of tokens) {
        const lower = t.toLowerCase();
        if (EMAIL_RE.test(lower)) good.push(lower);
        else bad.push(t);
      }
      if (good.length > 0) {
        setEmails((prev) => [...prev, ...good.filter((e) => !prev.includes(e))]);
      }
      setInvalidTokens(bad);
      setDraft(bad.length > 0 ? bad.join(" ") : "");
    },
    [],
  );

  const onDraftKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      commitDraft(draft);
    } else if (e.key === "Backspace" && draft === "" && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1));
    }
  };

  const toggle = (set: Set<string>, id: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  // The server rejects invites without ≥1 KRA and ≥1 SOP — mirror that
  // gate here so the button state is honest.
  const allEmails = useMemo(() => {
    const d = draft.trim().toLowerCase();
    return EMAIL_RE.test(d) && !emails.includes(d) ? [...emails, d] : emails;
  }, [emails, draft]);
  const canSend =
    allEmails.length > 0 && kraIds.size > 0 && sopIds.size > 0 && !sending;

  const handleSend = async () => {
    // Pull any last un-committed draft email into the batch.
    const batch = allEmails;
    if (batch.length === 0 || kraIds.size === 0 || sopIds.size === 0) return;
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
            kraIds: Array.from(kraIds),
            sopIds: Array.from(sopIds),
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
        `${sent} sent · ${failed.length} failed — ${failed[0].reason}`,
      );
    }
  };

  const catalogsLoading = kras === null || sops === null;
  const noCatalog = !catalogsLoading && (kras.length === 0 || sops.length === 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Invite people</DialogTitle>
        <DialogDescription>
          Teammates get an email with a link to join your workspace. Every
          invite carries a role definition — at least one KRA and one SOP.
        </DialogDescription>

        {/* Emails */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Email addresses
          </label>
          <div
            className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1.5 focus-within:border-zinc-400"
          >
            {emails.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2.5 pr-1 text-[12px] text-zinc-800"
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
              className="min-w-[140px] flex-1 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400"
            />
          </div>
          {invalidTokens.length > 0 ? (
            <p className="mt-1 text-[11.5px] text-red-600">
              Not a valid email: {invalidTokens.join(", ")}
            </p>
          ) : null}
        </div>

        {/* Access level */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Access level
          </label>
          <select
            value={accessLevel}
            onChange={(e) => setAccessLevel(e.target.value as AccessLevel)}
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-[13px] text-zinc-800 focus:border-zinc-400 focus:outline-none"
          >
            {INVITE_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label} — {l.description}
              </option>
            ))}
          </select>
        </div>

        {/* Placement — optional. Department / Role / Manager are carried
            on the Invitation so the hire lands in their seat, not
            unplaced. Picking a Role also drives KRA-weight inheritance
            at accept-invite time. */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Department <span className="font-normal normal-case text-zinc-400">(optional)</span>
            </label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-[13px] text-zinc-800 focus:border-zinc-400 focus:outline-none"
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
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Role <span className="font-normal normal-case text-zinc-400">(optional)</span>
            </label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-[13px] text-zinc-800 focus:border-zinc-400 focus:outline-none"
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
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Reporting manager <span className="font-normal normal-case text-zinc-400">(optional)</span>
          </label>
          <select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-[13px] text-zinc-800 focus:border-zinc-400 focus:outline-none"
          >
            <option value="">No manager</option>
            {(people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {personLabel(p)}
              </option>
            ))}
          </select>
        </div>

        {/* Role definition — required by the invitations contract */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              KRAs <span className="font-normal normal-case text-zinc-400">(pick at least 1)</span>
            </label>
            <div className="max-h-[140px] overflow-y-auto rounded-md border border-zinc-200 bg-white">
              {kras === null ? (
                <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-zinc-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              ) : kras.length === 0 ? (
                <div className="px-2.5 py-2 text-[12px] text-zinc-400">No KRAs yet</div>
              ) : (
                kras.map((k) => (
                  <label
                    key={k.id}
                    className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-zinc-800 hover:bg-zinc-50"
                  >
                    <input
                      type="checkbox"
                      checked={kraIds.has(k.id)}
                      onChange={() => toggle(kraIds, k.id, setKraIds)}
                      className="h-3.5 w-3.5 accent-[var(--os-brand)]"
                    />
                    <span className="truncate">{k.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              SOPs <span className="font-normal normal-case text-zinc-400">(pick at least 1)</span>
            </label>
            <div className="max-h-[140px] overflow-y-auto rounded-md border border-zinc-200 bg-white">
              {sops === null ? (
                <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-zinc-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              ) : sops.length === 0 ? (
                <div className="px-2.5 py-2 text-[12px] text-zinc-400">No SOPs yet</div>
              ) : (
                sops.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-zinc-800 hover:bg-zinc-50"
                  >
                    <input
                      type="checkbox"
                      checked={sopIds.has(s.id)}
                      onChange={() => toggle(sopIds, s.id, setSopIds)}
                      className="h-3.5 w-3.5 accent-[var(--os-brand)]"
                    />
                    <span className="truncate">{s.title}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
        {noCatalog ? (
          <p className="text-[11.5px] text-zinc-500">
            Invites need at least one KRA and one SOP so every new hire lands
            with a role definition. Create them under KRA &amp; KPI and SOPs
            first.
          </p>
        ) : null}

        {/* Personal message */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Personal message <span className="font-normal normal-case text-zinc-400">(optional)</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Add a note to the invitation email…"
            className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-[13px] text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="h-8 rounded-md px-2.5 text-[12.5px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0073EA] px-4 text-[12.5px] font-medium text-white hover:bg-[#0060B9] disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
