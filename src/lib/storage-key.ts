// A storage key is this workspace's only when it sits under its own prefix,
// the one every upload route writes (orgs/<organizationId>/...). Pure.
//
// Pen test 2026-11-28 (V-21): Talk attachments and doc blocks stored any key
// a client sent and signed a fresh download link for it on every read, so a
// key once seen (by a former member, a guest, a public doc reader) kept
// minting links to that object from any workspace. POST /api/files and the
// forms code already refused a key outside the prefix; now every place that
// stores or signs one does.
export function keyInWorkspace(key: unknown, organizationId: string): key is string {
  return typeof key === "string" && !!organizationId && key.startsWith(`orgs/${organizationId}/`) && !key.includes("..");
}
