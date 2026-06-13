"use client";

// Account · Profile — the signed-in user's own profile. USER-level: no
// admin gate, everyone edits their own identity. Renders inside the
// settings takeover (AccountLayout → SettingsShell).
//
//   GET    /api/me                       → { user: { id, firstName, … } }
//   PATCH  /api/users/{id}               → updated user (firstName/lastName)
//   POST   /api/users/{id}/avatar {file} → { avatar }
//   DELETE /api/users/{id}/avatar        → { avatar: null }
//
// CSS note: .workwrk-os globally strips <input> borders, so text inputs
// use the bordered-wrapper pattern. <button>/<select> are not reset.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, User, Camera, Trash2, Mail, ShieldCheck, Building2 } from "lucide-react";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/permissions";
import { useOsToast } from "@/components/layout/os/toast";

type Me = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatar: string | null;
  accessLevel: AccessLevel;
  department?: { id: string; name: string } | null;
  role?: { id: string; title: string } | null;
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB — matches the avatar API cap

const accessLabel = (lvl: AccessLevel | undefined) =>
  ACCESS_LEVELS.find((l: { value: AccessLevel; label: string }) => l.value === lvl)?.label ?? (lvl ?? "—");

const initialsOf = (m: Pick<Me, "firstName" | "lastName" | "email">) => {
  const a = m.firstName?.[0] ?? "";
  const b = m.lastName?.[0] ?? "";
  const both = `${a}${b}`.trim();
  if (both) return both.toUpperCase();
  return (m.email?.[0] ?? "?").toUpperCase();
};

export default function AccountProfilePage() {
  const { toast } = useOsToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) {
        setMe({} as Me);
        return;
      }
      const d = await res.json();
      const u: Me = d?.user ?? ({} as Me);
      setMe(u);
      setFirstName(u.firstName ?? "");
      setLastName(u.lastName ?? "");
      setAvatar(u.avatar ?? null);
    } catch {
      setMe({} as Me);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!me?.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${me.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err?.error ?? "Couldn't save profile");
        return;
      }
      const updated = await res.json().catch(() => null);
      setMe((prev) =>
        prev
          ? {
              ...prev,
              firstName: updated?.firstName ?? firstName.trim(),
              lastName: updated?.lastName ?? lastName.trim(),
            }
          : prev,
      );
      toast("Profile saved");
    } catch {
      toast("Couldn't save profile");
    } finally {
      setSaving(false);
    }
  }

  function pickPhoto() {
    fileRef.current?.click();
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so re-picking the same file fires onChange again.
    e.target.value = "";
    if (!file || !me?.id) return;

    if (!file.type.startsWith("image/")) {
      toast("Please choose an image file");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast("Image is too large — max 2MB");
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/users/${me.id}/avatar`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err?.error ?? "Couldn't upload photo");
        return;
      }
      const d = await res.json().catch(() => ({}));
      setAvatar(d?.avatar ?? null);
      setMe((prev) => (prev ? { ...prev, avatar: d?.avatar ?? null } : prev));
      toast("Photo updated");
    } catch {
      toast("Couldn't upload photo");
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto() {
    if (!me?.id) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/users/${me.id}/avatar`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err?.error ?? "Couldn't remove photo");
        return;
      }
      setAvatar(null);
      setMe((prev) => (prev ? { ...prev, avatar: null } : prev));
      toast("Photo removed");
    } catch {
      toast("Couldn't remove photo");
    } finally {
      setUploading(false);
    }
  }

  const loaded = me !== null;
  const busy = saving || uploading;

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <User className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Profile</h1>
      </header>
      <p className="mb-5 max-w-2xl text-[13px] text-zinc-500">
        Your personal details. Update your name and photo — everyone manages their own profile.
      </p>

      {!loaded ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
        </div>
      ) : (
        <div className="max-w-2xl space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt=""
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-[20px] font-semibold text-zinc-600">
                {initialsOf(me)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-zinc-900">Profile photo</div>
              <div className="text-[12px] text-zinc-500">PNG, JPEG or WebP. Up to 2MB.</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onFilePicked}
                />
                <button
                  type="button"
                  onClick={pickPhoto}
                  disabled={uploading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                  Change photo
                </button>
                {avatar ? (
                  <button
                    type="button"
                    onClick={removePhoto}
                    disabled={uploading}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Editable identity */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-zinc-700">First name</span>
                <div className="flex h-9 items-center rounded-md border border-zinc-200 bg-white px-2.5">
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                    className="w-full bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400"
                  />
                </div>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-zinc-700">Last name</span>
                <div className="flex h-9 items-center rounded-md border border-zinc-200 bg-white px-2.5">
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last name"
                    className="w-full bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400"
                  />
                </div>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[12px] font-medium text-zinc-700">Email</span>
                <div className="flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <span className="truncate text-sm text-zinc-500">{me.email ?? "—"}</span>
                </div>
                <span className="mt-1 block text-[11px] text-zinc-400">
                  Your email is managed by your administrator.
                </span>
              </label>
            </div>

            {/* Read-only info chips */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12px] text-zinc-700">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                {accessLabel(me.accessLevel)}
              </span>
              {me.role?.title ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12px] text-zinc-700">
                  <User className="h-3.5 w-3.5 text-zinc-400" />
                  {me.role.title}
                </span>
              ) : null}
              {me.department?.name ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12px] text-zinc-700">
                  <Building2 className="h-3.5 w-3.5 text-zinc-400" />
                  {me.department.name}
                </span>
              ) : null}
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || !me.id}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-[12px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
      <div className="h-10" />
    </div>
  );
}
