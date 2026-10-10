"use client";

// My settings > Profile (spec-account-auth `/account/profile`).
//
//   Photo            autosave (POST / DELETE /api/users/[id]/avatar), 2 MB cap
//   Your details     first and last name, phone, date of birth: ONE Save bar,
//                    ONE PATCH /api/users/[id] per save, never two writes
//   Email            the address as text, Verified or "Send verification email"
//   Your place       job title, department, office, reports to, workspace
//                    role: read only (placement is the manager's and the
//                    People team's to change), each linking to /people/me
//   Your data        GET /api/me/export, a JSON file straight to the browser
//   Danger zone      Delete my account (typed confirmation)
//
// A failed GET /api/me renders OsEmptyView with Retry in place of the form:
// the form never renders blank over a failed read, so Save can never write
// empty strings over live values.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useSession } from "next-auth/react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SaveBar } from "@/components/settings/save-bar";
import { SkeletonRows } from "@/components/ui/skeleton";
import { btn, FieldError, FieldLabel, Pending, TextInput } from "@/components/account/account-ui";
import { useMe, type MeRecord } from "@/components/account/use-me";
import { DeleteAccountDialog } from "@/components/account/delete-account-dialog";
import { ORG_ROLE_LABEL } from "@/lib/access/labels";
import { useViewerRole } from "@/components/layout/os/boot-context";
import { profileDraftOf, profileDirty, profilePatch, type ProfileDraft } from "@/lib/account/profile-form";
import { useVerifyCooldown } from "@/components/account/use-verify-cooldown";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp";

function initialsOf(m: Pick<MeRecord, "firstName" | "lastName" | "email">): string {
  const both = `${m.firstName?.[0] ?? ""}${m.lastName?.[0] ?? ""}`.trim();
  return (both || m.email?.[0] || "?").toUpperCase();
}

export default function AccountProfilePage() {
  const me = useMe();
  return (
    <SettingsPage pageKey="account/profile" subtitle="Your details as your teammates see them.">
      {me.status === "loading" ? (
        <SettingsCardStack>
          <div className="w-full max-w-[560px] rounded-lg border border-line bg-raised p-6"><SkeletonRows rows={2} /></div>
          <div className="w-full max-w-[560px] rounded-lg border border-line bg-raised p-6"><SkeletonRows rows={4} /></div>
          <div className="w-full max-w-[560px] rounded-lg border border-line bg-raised p-6"><SkeletonRows rows={2} /></div>
        </SettingsCardStack>
      ) : me.status === "error" ? (
        <OsEmptyView variant="error" title="Couldn't load your profile" hint={me.error} action={{ label: "Try again", onClick: me.retry }} />
      ) : (
        <ProfileBody me={me.me} refresh={me.refresh} />
      )}
    </SettingsPage>
  );
}

function ProfileBody({ me, refresh }: { me: MeRecord; refresh: () => Promise<void> }) {
  const { toast } = useOsToast();
  const { update: updateSession } = useSession();
  const { isAdmin, isGuest } = useViewerRole();
  // A Guest never sees the Teams hub (avatar-menu.tsx), so the place links to
  // /people/me would lead them to a page they cannot open: plain text instead.
  const placeHref = isGuest ? null : "/people/me";
  const fileRef = useRef<HTMLInputElement>(null);

  const [avatar, setAvatar] = useState<string | null>(me.avatar);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoSavedAt, setPhotoSavedAt] = useState<number | null>(null);

  const saved = useMemo(() => profileDraftOf(me), [me]);
  const [draft, setDraft] = useState<ProfileDraft>(saved);
  const [saving, setSaving] = useState(false);
  const [fieldErr, setFieldErr] = useState<{ field?: string; message: string } | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setDraft(saved), 0);
    return () => window.clearTimeout(t);
  }, [saved]);
  const dirty = profileDirty(saved, draft);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportedAt, setExportedAt] = useState<number | null>(null);
  const verify = useVerifyCooldown(me.email);

  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = useCallback(async (): Promise<boolean> => {
    const patch = profilePatch(saved, draft);
    if (!patch.ok) { setFieldErr({ field: patch.field, message: patch.error }); return false; }
    if (Object.keys(patch.data).length === 0) return true;
    setSaving(true);
    setFieldErr(null);
    const r = await apiFetch(`/api/users/${me.id}`, { method: "PATCH", json: patch.data });
    setSaving(false);
    if (!r.ok) {
      const field = (r.issues as { field?: string } | undefined)?.field;
      setFieldErr({ field, message: r.error || "Couldn't save your profile" });
      toast("Couldn't save your profile");
      return false;
    }
    await refresh();
    // The top bar's name comes from the session: re-read it now, not in 30 minutes.
    void updateSession();
    toast("Profile saved");
    return true;
  }, [saved, draft, me.id, refresh, toast, updateSession]);

  // Cmd+S is the Save bar's own (save-bar.tsx), on every Save bar page.

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) { toast("Choose a PNG, JPG or WebP image"); return; }
    if (file.size > MAX_AVATAR_BYTES) { toast("That image is over 2 MB"); return; }
    const before = avatar;
    setPhotoBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const r = await apiFetch<{ avatar?: string | null }>(`/api/users/${me.id}/avatar`, { method: "POST", body: fd });
    setPhotoBusy(false);
    if (!r.ok) { setAvatar(before); toast("Couldn't update your photo"); return; }
    setAvatar(r.data?.avatar ?? null);
    setPhotoSavedAt(Date.now());
    void updateSession();
  };

  const removePhoto = async () => {
    const before = avatar;
    setPhotoBusy(true);
    setAvatar(null);
    const r = await apiFetch(`/api/users/${me.id}/avatar`, { method: "DELETE" });
    setPhotoBusy(false);
    if (!r.ok) { setAvatar(before); toast("Couldn't remove your photo"); return; }
    setPhotoSavedAt(Date.now());
    void updateSession();
  };

  const download = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const res = await fetch("/api/me/export", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workwrk-data-export-${me.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportedAt(Date.now());
    } catch {
      toast("Couldn't download your data. Try again.");
    } finally {
      setExportBusy(false);
    }
  };

  const roleLabel = ORG_ROLE_LABEL[me.orgRole] ?? "Member";
  const reportsTo = me.manager ? `${me.manager.firstName} ${me.manager.lastName}`.trim() : null;

  return (
    <>
      <SettingsCardStack>
        <SettingsCard id="profile.photo">
          <div className="flex items-center gap-4">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-[72px] w-[72px] shrink-0 rounded-full object-cover" />
            ) : (
              <span className="inline-flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-side-pill text-lg font-medium text-ink-2" aria-hidden>
                {initialsOf(me)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btn.secondary} onClick={() => fileRef.current?.click()} disabled={photoBusy}>
                  {photoBusy ? <Pending label="Uploading" /> : null}
                  Change photo
                </button>
                {avatar ? (
                  <button type="button" className={btn.ghost} onClick={() => { void removePhoto(); }} disabled={photoBusy}>Remove</button>
                ) : null}
                {photoSavedAt ? <SavedTick at={photoSavedAt} /> : null}
              </div>
              <p className="mt-2 text-sm text-ink-2">PNG or JPG, up to 2 MB.</p>
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { void onFile(e); }} />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard title="Your details" id="profile.details">
          <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
            <div>
              <FieldLabel htmlFor="pf-first">First name</FieldLabel>
              <TextInput id="pf-first" value={draft.firstName} onChange={(e) => set("firstName", e.target.value)} autoComplete="given-name" maxLength={80} invalid={fieldErr?.field === "firstName"} />
            </div>
            <div>
              <FieldLabel htmlFor="pf-last">Last name</FieldLabel>
              <TextInput id="pf-last" value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} autoComplete="family-name" maxLength={80} invalid={fieldErr?.field === "lastName"} />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="pf-phone">Phone</FieldLabel>
            <TextInput id="pf-phone" type="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" maxLength={40} invalid={fieldErr?.field === "phone"} />
            <p className="mt-1.5 text-sm text-ink-2">Visible to your manager and the People team</p>
          </div>
          <div>
            <FieldLabel htmlFor="pf-dob">Date of birth</FieldLabel>
            <TextInput id="pf-dob" type="date" value={draft.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} className="max-w-[220px]" invalid={fieldErr?.field === "dateOfBirth"} />
            <p className="mt-1.5 text-sm text-ink-2">Visible to you, your managers, the People team and admins</p>
          </div>
          <FieldError>{fieldErr?.message}</FieldError>
        </SettingsCard>

        <SettingsCard title="Email" id="profile.email">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base text-ink">{me.email}</span>
            {me.emailVerifiedAt ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-success-text">
                <Check className="h-4 w-4" strokeWidth={2} aria-hidden /> Verified
              </span>
            ) : (
              <>
                <span className="text-sm text-warning-text">Not verified yet</span>
                <button type="button" className={btn.secondary} onClick={() => { void verify.send(); }} disabled={verify.disabled}>
                  {verify.busy ? <Pending label="Sending" /> : null}
                  {verify.sent ? "Sent" : "Send verification email"}
                </button>
              </>
            )}
          </div>
          <p className="text-sm text-ink-2">Managed by your workspace admin</p>
        </SettingsCard>

        <div className="w-full max-w-[560px]">
          <SettingsCard title={`Your place at ${me.organization.name}`} id="profile.place">
            <div>
              <SettingsRow label="Job title" readOnlyValue={<PlaceChip value={me.role?.title} href={placeHref} />} />
              <SettingsRow label="Department" readOnlyValue={<PlaceChip value={me.department?.name} href={placeHref} />} />
              <SettingsRow label="Office" readOnlyValue={<PlaceChip value={me.office?.name} href={placeHref} />} />
              <SettingsRow
                label="Reports to"
                readOnlyValue={
                  reportsTo && !placeHref ? (
                    <span className="text-base text-ink">{reportsTo}</span>
                  ) : reportsTo && placeHref ? (
                    <Link href={placeHref} className="inline-flex items-center gap-2 text-base text-ink hover:underline">
                      {me.manager?.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={me.manager.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-side-pill text-micro font-medium text-ink-2" aria-hidden>
                          {`${me.manager?.firstName?.[0] ?? ""}${me.manager?.lastName?.[0] ?? ""}`.toUpperCase()}
                        </span>
                      )}
                      {reportsTo}
                    </Link>
                  ) : <PlaceChip value={null} href={placeHref} />
                }
              />
              <SettingsRow label="Workspace role" readOnlyValue={<PlaceChip value={roleLabel} href={placeHref} />} />
            </div>
          </SettingsCard>
          <p className="mt-2 text-sm text-ink-2">Ask your manager or the People team to change these.</p>
        </div>

        <SettingsCard title="Your data" id="profile.data">
          <p className="text-base text-ink-2">A copy of your personal records: your profile, notifications, activity and consents; your KPIs, reviews, feedback, check-ins, meetings, kudos and ideas; and your AI teammate chats, requests, memories and routines. It downloads as a JSON file.</p>
          <div className="flex items-center gap-3">
            <button type="button" className={btn.secondary} onClick={() => { void download(); }} disabled={exportBusy}>
              {exportBusy ? <Pending label="Preparing" /> : null}
              Download
            </button>
            {exportedAt ? <SavedTick at={exportedAt} label="Downloaded" /> : null}
          </div>
        </SettingsCard>

        <SettingsCard title="Danger zone" danger id="profile.delete">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium text-ink">Delete my account</div>
              <div className="mt-0.5 text-sm text-ink-2">Deletes your account in every workspace you belong to and erases your personal details. Work you created stays with its workspace.</div>
            </div>
            <button type="button" className={btn.dangerGhost} onClick={() => setDeleteOpen(true)}>Delete my account</button>
          </div>
        </SettingsCard>
      </SettingsCardStack>

      <SaveBar dirty={dirty} saving={saving} onDiscard={() => { setDraft(saved); setFieldErr(null); }} onSave={save} />

      <DeleteAccountDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        isLastOwner={me.isLastAdmin}
        orgName={me.organization.name}
        canOpenMembers={isAdmin}
      />
    </>
  );
}

function PlaceChip({ value, href }: { value: string | null | undefined; href: string | null }) {
  if (!value) return <span className="text-base text-ink-3">Not set</span>;
  const cls = "inline-flex h-6 items-center rounded-md bg-hover px-2 text-sm font-medium text-ink";
  if (!href) return <span className={cls}>{value}</span>;
  return (
    <Link href={href} className={`${cls} hover:underline`}>
      {value}
    </Link>
  );
}

function SavedTick({ at, label = "Saved" }: { at: number; label?: string }) {
  const [shownFor, setShownFor] = useState<number | null>(at);
  useEffect(() => {
    const t0 = window.setTimeout(() => setShownFor(at), 0);
    const t = window.setTimeout(() => setShownFor(null), 2000);
    return () => { window.clearTimeout(t0); window.clearTimeout(t); };
  }, [at]);
  if (shownFor !== at) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-success-text" role="status">
      <Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> {label}
    </span>
  );
}
