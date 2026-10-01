// Pure helpers the settings pages share (tested in settings-chassis.test.ts).

/** Which tab `?tab=` names, falling back to the first. */
export function pickSettingsTab(tabs: readonly { key: string }[], requested: string | null | undefined): string | null {
  if (tabs.length === 0) return null;
  if (requested && tabs.some((t) => t.key === requested)) return requested;
  return tabs[0].key;
}

/** GET /api/tags row (it returns `type` and `_count.assignments`). */
export type ApiTag = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  description: string | null;
  archived: boolean;
  _count?: { assignments?: number };
};

/** The shape the Task system > Tags manager renders. */
export type TagManagerRow = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  description: string | null;
  archived: boolean;
  assignmentCount: number;
};

/** The API row as the manager's row: real type, real usage count, never invented. */
export function tagRowFromApi(t: ApiTag): TagManagerRow {
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    color: t.color ?? null,
    description: t.description ?? null,
    archived: !!t.archived,
    assignmentCount: t._count?.assignments ?? 0,
  };
}
