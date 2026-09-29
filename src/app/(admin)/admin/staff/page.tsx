"use client";

// Staff (spec-admin-backoffice 2.4): the WorkwrK people who can open this
// console, one flat list (decided: no read-only tier), and the two actions
// that change it. Every add and every remove is recorded on Staff activity
// in the same transaction and emailed to everyone on the list.
//
// Where the old controls went: the permanently open "Add staff member" form
// is the one primary "Add staff" (a 560 modal); the <ul> is the table; the
// disabled Remove with a tooltip on the last person is an absent row plus a
// footer sentence; Refresh is "..." > Refresh; the page subtitle is the
// footer sentence and "..." > About this page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CircleAlert, Info, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/dialog-provider";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTitle, formatRelative } from "@/lib/format/date";
import { useConsole } from "../../console-context";
import { TypedConfirmDialog, type TypedConfirmRequest } from "../../typed-confirm-dialog";
import {
  AboutDialog,
  BTN_GHOST,
  BTN_PRIMARY,
  ConsoleModal,
  FIELD,
  InlineRetry,
  LABEL,
  PendingDots,
  RowMenuTrigger,
  UpdatedMeta,
  useStaleRefetch,
} from "../../console-ui";

interface Staff {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  addedByEmail: string | null;
  addedByName: string | null;
  lastOpenedAt: string | null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function StaffPage() {
  const { datePrefs } = useConsole();
  const { toast } = useOsToast();
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menu, setMenu] = useState<{ row: Staff; anchor: React.RefObject<HTMLElement | null> } | null>(null);
  const [removing, setRemoving] = useState<Staff | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  // ?focus=<email> comes from a Search STAFF row: that row is marked and
  // focused once the list has loaded, so the result lands on the person.
  const focusEmail = (useSearchParams().get("focus") ?? "").trim().toLowerCase();

  const load = useCallback(async () => {
    const r = await apiFetch<{ staff: Staff[]; you: string }>("/api/admin/platform-staff");
    if (r.ok) {
      setFailed(false);
      setStaff(r.data.staff);
      setYou(r.data.you ?? null);
      setLoadedAt(Date.now());
    } else if (r.status !== 401) {
      setFailed(true);
    }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useStaleRefetch(() => void load(), loadedAt);

  const focusId = useMemo(
    () => (focusEmail && staff ? staff.find((s) => s.email.toLowerCase() === focusEmail)?.id ?? null : null),
    [focusEmail, staff],
  );
  useEffect(() => {
    if (!focusId) return;
    // Deferred past Search's close: its focus scope hands focus back to the
    // top-bar Search button in a timeout of its own, which would otherwise
    // land after this and take the focus off the row again. TableCard makes
    // the highlighted row focusable (tabIndex -1) for this.
    let t: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
      t = setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusId)}"]`);
        if (!el) return;
        el.scrollIntoView({ block: "center" });
        el.focus({ preventScroll: true });
      }, 0);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (t) clearTimeout(t);
    };
  }, [focusId]);

  const onlyOne = (staff?.length ?? 0) <= 1;

  const remove = async (s: Staff) => {
    setRemoveBusy(true);
    const r = await apiFetch("/api/admin/platform-staff", { method: "DELETE", json: { id: s.id, confirm: s.email } });
    setRemoveBusy(false);
    if (!r.ok) {
      if (r.status !== 401) toast(r.error || "Couldn't remove them", { tone: "danger" });
      return;
    }
    setRemoving(null);
    toast(`Removed ${s.email}`);
    if (you && s.email.toLowerCase() === you.toLowerCase()) {
      // You removed yourself: the console is gone for you, so show the
      // staff-only page now rather than a list that can no longer load.
      window.location.assign("/admin");
      return;
    }
    void load();
  };

  const columns: TableColumn<Staff>[] = [
    {
      key: "name",
      label: "Name",
      title: true,
      width: "minmax(180px,1.2fr)",
      render: (s) => (s.name ? <span className="truncate">{s.name}</span> : <span className="truncate font-normal">{s.email}</span>),
    },
    {
      key: "email",
      label: "Email",
      width: "minmax(200px,1.4fr)",
      render: (s) => (
        <a href={`mailto:${s.email}`} onClick={(e) => e.stopPropagation()} className="truncate text-ink-2 hover:text-ink hover:underline">{s.email}</a>
      ),
    },
    {
      key: "addedBy",
      label: "Added by",
      width: "minmax(140px,1fr)",
      render: (s) => <span className={s.addedByName ? "truncate" : "text-ink-3"}>{s.addedByName ?? "Unknown"}</span>,
    },
    {
      key: "added",
      label: "Added",
      width: "120px",
      render: (s) => <span className="tabular-nums text-ink-2" title={formatDateTitle(s.createdAt, datePrefs)}>{formatDate(s.createdAt, datePrefs, "date")}</span>,
    },
    {
      key: "opened",
      label: "Last opened the console",
      width: "190px",
      render: (s) =>
        s.lastOpenedAt ? (
          <span className="tabular-nums text-ink-2" title={formatDateTitle(s.lastOpenedAt, datePrefs)}>{formatRelative(s.lastOpenedAt, datePrefs)}</span>
        ) : (
          <span className="text-ink-3">Never</span>
        ),
    },
  ];

  return (
    <>
      <OsPageHeader
        title="Staff"
        actions={<UpdatedMeta at={loadedAt} prefs={datePrefs} failed={failed && !!staff} />}
        toolbar={{
          primary: { label: "Add staff", icon: UserPlus, onClick: () => setAddOpen(true) },
          menu: [
            { label: "Refresh", icon: RefreshCw, onClick: () => void load() },
            { label: "About this page", icon: Info, onClick: () => setAboutOpen(true) },
          ],
        }}
      />
      <div className="os-chrome flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6 pt-2">
        <TableCard<Staff>
          ariaLabel="Staff"
          columns={columns}
          rows={failed && !staff ? [] : staff}
          rowKey={(s) => s.id}
          highlightKey={focusId}
          skeletonRows={4}
          rowMenuAlwaysVisible
          rowMenu={onlyOne ? undefined : (s) => (
            <RowMenuTrigger open={menu?.row.id === s.id} onOpen={(ref) => setMenu({ row: s, anchor: ref })} label={`Actions for ${s.email}`} />
          )}
          empty={failed ? <InlineRetry text="Could not load staff." onRetry={() => void load()} /> : "No staff yet"}
          footer={{
            total: staff?.length ?? 0,
            noun: "records",
            from: 1,
            to: staff?.length ?? 0,
            hidePaging: true,
            // Until a list has loaded (the first load, or it failed) the count
            // is unknown, so no "Total records 0". A failed refresh keeps the
            // real count of the rows still shown.
            hideTotal: !staff,
            trailing: onlyOne && staff ? "You cannot remove the last staff member." : "Anyone on this list can open the staff console and change any customer's plan.",
          }}
        />
        {failed && staff ? <InlineRetry text="Could not refresh staff." onRetry={() => void load()} /> : null}
      </div>

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={200} open onClose={() => setMenu(null)} placement="below">
          <MenuList onClick={() => setMenu(null)}>
            <MenuItem icon={Trash2} label="Remove" destructive onClick={() => setRemoving(menu.row)} />
          </MenuList>
        </MorePortal>
      ) : null}

      <TypedConfirmDialog
        request={removeRequest(removing, you)}
        busy={removeBusy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => { if (removing) void remove(removing); }}
      />

      <AddStaffDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(email) => {
          setAddOpen(false);
          toast(`Added ${email}`, { description: "Everyone on the staff list has been emailed." });
          void load();
        }}
      />

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="Staff">
        The WorkwrK people who can open this console. Anyone on this list can open it and change any customer&apos;s plan,
        seats and modules. They also need a WorkwrK login with the same email. Every add and every remove is recorded on
        Staff activity and emailed to everyone already on the list.
      </AboutDialog>
    </>
  );
}

function removeRequest(target: Staff | null, you: string | null): TypedConfirmRequest | null {
  if (!target) return null;
  const self = !!you && target.email.toLowerCase() === you.toLowerCase();
  return {
    title: `Remove ${target.email}?`,
    body: self
      ? "You are removing yourself. You will lose this console as soon as you confirm."
      : "They lose the staff console immediately. Their WorkwrK login is not touched.",
    note: "Everyone still on the staff list is emailed about it.",
    match: target.email,
    matchLabel: self ? "your email" : "their email",
    confirmLabel: "Remove",
  };
}

function AddStaffDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const emailRef = useRef<HTMLInputElement>(null);
  const ask = useConfirm();
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEmail("");
      setName("");
      setError(null);
    }
  }
  useEffect(() => {
    if (open) requestAnimationFrame(() => emailRef.current?.focus());
  }, [open]);

  const submit = async () => {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      setError("Enter a valid email address");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await apiFetch("/api/admin/platform-staff", { method: "POST", json: { email: e, name: name.trim() || undefined } });
    setBusy(false);
    if (r.ok) onAdded(e);
    else if (r.status === 409) setError("That email is already on the staff list");
    else if (r.status !== 401) setError(r.error || "That did not save. Try again.");
  };

  const dirty = email.trim().length > 0 || name.trim().length > 0;
  const close = async () => {
    if (busy) return;
    if (dirty) {
      const ok = await ask({ title: "Discard this staff member?", description: "Nothing has been saved yet.", confirmLabel: "Discard", destructive: true });
      if (!ok) return;
    }
    onClose();
  };
  return (
    <ConsoleModal
      open={open}
      onClose={() => void close()}
      width={560}
      busy={busy}
      title="Add staff"
      onSubmit={() => void submit()}
      initialFocus={false}
      footer={
        <>
          <button type="button" onClick={() => void close()} disabled={busy} className={BTN_GHOST}>Cancel</button>
          <button type="submit" disabled={busy || !email.trim()} className={BTN_PRIMARY}>
            {busy ? <PendingDots /> : <UserPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
            Add staff
          </button>
        </>
      }
    >
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Email</span>
        <input
          ref={emailRef}
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          placeholder="name@workwrk.com"
          aria-invalid={error ? true : undefined}
          className={FIELD}
        />
        {error ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-danger-text" role="alert">
            <CircleAlert className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            {error}
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Name <span className="font-normal text-ink-3">(optional)</span></span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
      </label>
      <p className="text-sm text-ink-2">
        They also need a WorkwrK login with this email, and that address must be verified. Matching is case-insensitive.
        Everyone already on the staff list is emailed when you add someone.
      </p>
    </ConsoleModal>
  );
}
