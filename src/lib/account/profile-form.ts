// The Profile page's Save-bar form, as pure functions (tested): what the
// form starts from, whether it is dirty, and the ONE PATCH body a save sends
// to /api/users/[id]. Only the fields that changed are sent, and the same
// limits the route enforces are checked first, so a 400 names the field.

export interface ProfileDraft {
  firstName: string;
  lastName: string;
  phone: string;
  /** "YYYY-MM-DD" or "" for none. */
  dateOfBirth: string;
}

export interface ProfileSource {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
}

export function profileDraftOf(me: ProfileSource): ProfileDraft {
  return {
    firstName: me.firstName ?? "",
    lastName: me.lastName ?? "",
    phone: me.phone ?? "",
    dateOfBirth: typeof me.dateOfBirth === "string" && /^\d{4}-\d{2}-\d{2}/.test(me.dateOfBirth) ? me.dateOfBirth.slice(0, 10) : "",
  };
}

function norm(d: ProfileDraft): ProfileDraft {
  return { firstName: d.firstName.trim(), lastName: d.lastName.trim(), phone: d.phone.trim(), dateOfBirth: d.dateOfBirth.trim() };
}

export function profileDirty(saved: ProfileDraft, draft: ProfileDraft): boolean {
  const a = norm(saved);
  const b = norm(draft);
  return a.firstName !== b.firstName || a.lastName !== b.lastName || a.phone !== b.phone || a.dateOfBirth !== b.dateOfBirth;
}

export type ProfilePatch =
  | { ok: true; data: Record<string, string | null> }
  | { ok: false; field: keyof ProfileDraft; error: string };

export function profilePatch(saved: ProfileDraft, draft: ProfileDraft, today: Date = new Date()): ProfilePatch {
  const a = norm(saved);
  const b = norm(draft);
  const data: Record<string, string | null> = {};
  for (const k of ["firstName", "lastName"] as const) {
    if (a[k] === b[k]) continue;
    if (!b[k] || b[k].length > 80) return { ok: false, field: k, error: `${k === "firstName" ? "First name" : "Last name"} is 1 to 80 characters.` };
    data[k] = b[k];
  }
  if (a.phone !== b.phone) {
    if (b.phone.length > 40) return { ok: false, field: "phone", error: "A phone number is up to 40 characters." };
    data.phone = b.phone || null;
  }
  if (a.dateOfBirth !== b.dateOfBirth) {
    if (b.dateOfBirth) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dateOfBirth) || Number.isNaN(Date.parse(`${b.dateOfBirth}T12:00:00Z`))) {
        return { ok: false, field: "dateOfBirth", error: "That date of birth isn't a date." };
      }
      if (Date.parse(`${b.dateOfBirth}T12:00:00Z`) > today.getTime()) {
        return { ok: false, field: "dateOfBirth", error: "A date of birth can't be in the future." };
      }
    }
    data.dateOfBirth = b.dateOfBirth || null;
  }
  return { ok: true, data };
}

/** Delete my account: the primary is live only on the exact word. */
export const DELETE_CONFIRM_WORD = "DELETE";
export function deleteConfirmed(typed: string): boolean {
  return typed === DELETE_CONFIRM_WORD;
}
