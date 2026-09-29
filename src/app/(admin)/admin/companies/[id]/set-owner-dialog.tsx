"use client";

// Set workspace Owner (spec-admin-backoffice 2.3 card 5): a 560 modal with
// the workspace's live Members and Admins in a picker, a required "Why" and
// a typed confirmation of the company name. It ADDS an Owner and removes
// nobody; the modal says so when the company already has Owners.

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { useConfirm } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { confirmMatches } from "@/lib/admin/company-patch-rules";
import { BTN_GHOST, BTN_PRIMARY, ConsoleModal, FIELD, LABEL, PendingDots } from "../../../console-ui";
import type { CompanyRecordData } from "./company-record";

interface Person {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
}

const ROLE_WORD: Record<Person["role"], string> = { ADMIN: "Admin", MEMBER: "Member" };

export function SetOwnerDialog({
  open,
  company,
  onClose,
  onDone,
}: {
  open: boolean;
  company: CompanyRecordData;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosen, setChosen] = useState<Person | null>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const seq = useRef(0);
  const ask = useConfirm();

  // Every opening starts clean: a reason typed for one person never carries
  // over to the next.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChosen(null);
      setReason("");
      setTyped("");
      setError(null);
      setQ("");
    }
  }

  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    const t = window.setTimeout(async () => {
      setLoadError(false);
      const r = await apiFetch<{ people: Person[] }>(
        `/api/admin/companies/${encodeURIComponent(company.id)}/people?role=member,admin${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      );
      if (mine !== seq.current) return;
      if (r.ok) setPeople(r.data.people);
      else if (r.status !== 401) setLoadError(true);
    }, q ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [open, q, company.id]);

  const dirty = !!chosen || reason.trim().length > 0 || typed.length > 0;
  const close = async () => {
    if (busy) return;
    if (dirty) {
      const ok = await ask({ title: "Discard this Owner change?", description: "Nothing has been saved yet.", confirmLabel: "Discard", destructive: true });
      if (!ok) return;
    }
    onClose();
  };
  const ready = !!chosen && reason.trim().length >= 3 && confirmMatches(typed, company.name);

  const submit = async () => {
    if (!ready || !chosen) return;
    setBusy(true);
    setError(null);
    const r = await apiFetch<{ person: { name: string } }>(`/api/admin/companies/${encodeURIComponent(company.id)}/owner`, {
      method: "POST",
      json: { userId: chosen.id, reason: reason.trim(), confirm: typed },
    });
    setBusy(false);
    if (r.ok) onDone(r.data.person?.name ?? chosen.name);
    else if (r.status !== 401) setError(r.error || "That did not save. Try again.");
  };

  const owners = company.owners;
  return (
    <ConsoleModal
      open={open}
      onClose={() => void close()}
      width={560}
      busy={busy}
      title="Set workspace Owner"
      onSubmit={() => void submit()}
      initialFocus={false}
      footer={
        <>
          <button type="button" onClick={() => void close()} disabled={busy} className={BTN_GHOST}>Cancel</button>
          <button type="submit" disabled={!ready || busy} className={BTN_PRIMARY}>
            {busy ? <PendingDots /> : null}
            Set as Owner
          </button>
        </>
      }
    >
      {owners.length === 0 ? (
        <p className="text-sm text-danger-text">Nobody here has Owner access.</p>
      ) : (
        <p className="text-sm text-ink-2">
          {company.name} already has {owners.length} {owners.length === 1 ? "person" : "people"} with Owner access:{" "}
          {owners.map((o) => o.name).join(", ")}. This adds one more and removes nobody.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className={LABEL}>Person</span>
        <span className="relative block">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            className={`${FIELD} flex items-center gap-2 text-start`}
          >
            <span className={`min-w-0 flex-1 truncate ${chosen ? "" : "text-ink-3"}`}>
              {chosen ? `${chosen.name} · ${chosen.email} · ${ROLE_WORD[chosen.role]}` : "Choose a Member or Admin"}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
          </button>
          <Picker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            ariaLabel="Person"
            alwaysSearch
            searchPlaceholder="Find by name or email"
            onSearchChange={setQ}
            loading={people === null && !loadError}
            emptyLabel={loadError ? "Could not load people. Close and try again." : "Nobody here can be made an Owner"}
            selected={chosen?.id ?? null}
            onSelect={(v) => {
              setChosen(people?.find((p) => p.id === v) ?? null);
              setPickerOpen(false);
            }}
            sections={[
              {
                options: (people ?? []).map((p) => ({
                  value: p.id,
                  label: p.name,
                  description: `${p.email} · ${ROLE_WORD[p.role]}`,
                  keywords: p.email,
                })),
              },
            ]}
            width={496}
          />
        </span>
        <span className="text-sm text-ink-2">Members and Admins of this workspace who can sign in. Guests, deactivated people and existing Owners are not listed.</span>
      </div>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Why</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="The founder left and nobody else can manage billing"
          className={FIELD}
        />
        <span className="text-sm text-ink-2">Required. Kept on the Staff activity row for this change.</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>
          Type the company name to confirm: <span className="font-medium text-ink">{company.name}</span>
        </span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={FIELD} />
      </label>

      {error ? <p className="text-sm text-danger-text" role="alert">{error}</p> : null}
    </ConsoleModal>
  );
}
