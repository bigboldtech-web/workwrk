// Which of the ten access toggles the product enforces in the current flag
// state (Phase 8 stage E; access-model-spec section 8, settings rule "every
// visible setting saves or moves behind Show upcoming features with an honest
// caption"). Pure: the Access page shows a live control only for a toggle
// whose row here says `live`, and every other toggle behind Show upcoming
// features with its caption.

import { LOCK_IT_DOWN_ACCESS_SETTINGS } from "./settings";
import type { AccessSettings } from "./types";

export type ToggleKey = Exclude<keyof AccessSettings, "peopleTeamDepartmentId">;

export interface ToggleStatus {
  key: ToggleKey;
  label: string;
  effect: string;
  live: boolean;
  /** Where the value is read, for the Enforced-at tooltip. */
  enforcedAt: string;
  /** For a toggle that is not live: why, in one line. */
  caption: string | null;
}

export interface ToggleFlags {
  resolver: boolean;
  tables: boolean;
}

const NOT_YET = "Not enforced yet. Stored now, and read once the new access engine is switched on for this part of the product.";

export function toggleStatuses(f: ToggleFlags): ToggleStatus[] {
  return [
    {
      key: "whoCanCreateSpaces",
      label: "Who can create Spaces",
      effect: "Everyone, or only Owners and Admins.",
      live: f.resolver,
      enforcedAt: "POST /api/spaces",
      caption: f.resolver ? null : "Today the manager tier creates Spaces. This switch takes over when the new access engine is on.",
    },
    { key: "newSpaceDefault", label: "New Spaces start as", effect: "Open to everyone to edit, open to view, or private.", live: false, enforcedAt: "POST /api/spaces", caption: NOT_YET },
    { key: "findableSpaces", label: "Members can find Spaces they are not in", effect: "And ask to join them.", live: false, enforcedAt: "GET /api/access/peek, the Spaces list", caption: NOT_YET },
    { key: "editorsCanShare", label: "People with Can edit can share", effect: "Otherwise only Full access shares.", live: false, enforcedAt: "POST /api/access/[kind]/[id]/grants", caption: NOT_YET },
    { key: "whoCanInviteGuests", label: "Who can invite guests", effect: "Anyone with Full access on something, only Admins, or nobody.", live: false, enforcedAt: "POST /api/invitations", caption: "Guest accounts arrive with the new roles; stored until then." },
    {
      key: "peopleTeamUserIds",
      label: "People team",
      effect: "Who looks after people information and reviews.",
      live: true,
      enforcedAt: f.tables ? "every people, review and goal route (the list alone)" : "reviews, goals and the boot payload (the list plus everyone at the HR level)",
      caption: null,
    },
    {
      key: "whoCanPublish",
      label: "Who can publish SOPs",
      effect: "Anyone who can edit them, or Admins and the People team.",
      live: f.resolver,
      enforcedAt: "PATCH /api/sops/[id], POST /api/sops/record",
      caption: f.resolver ? null : "Today the permission grid below decides who publishes. This switch takes over when the new access engine is on.",
    },
    { key: "whoCanDelete", label: "Who can delete things", effect: "Anyone with Full access, or only Admins.", live: false, enforcedAt: "the container DELETE routes", caption: NOT_YET },
    { key: "guestExpiryDays", label: "Guest access ends after", effect: "Never, 30 days or 90 days.", live: false, enforcedAt: "grants.ts", caption: "Guest accounts arrive with the new roles; stored until then." },
    { key: "publicLinks", label: "Public links", effect: "Links that open without signing in, view only.", live: true, enforcedAt: "the public SOP, doc, table and form routes", caption: null },
  ];
}

/**
 * The Lock it down patch (spec 7.4): the preset, WITHOUT the People team keys,
 * so pressing it can never empty the People team list an Owner chose.
 */
export function lockItDownPatch(): Partial<AccessSettings> {
  const { peopleTeamUserIds: _ids, peopleTeamDepartmentId: _dept, ...rest } = LOCK_IT_DOWN_ACCESS_SETTINGS;
  void _ids;
  void _dept;
  return rest;
}

/** The keys a Lock it down would change from the current values, for the confirm dialog. */
export function lockItDownChanges(current: AccessSettings): ToggleKey[] {
  const patch = lockItDownPatch();
  return (Object.keys(patch) as ToggleKey[]).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(patch[k as keyof typeof patch]));
}
