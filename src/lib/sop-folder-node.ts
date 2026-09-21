// The SOP folder tree node shape.
//
// The server returns this for every SOP folder (GET /api/sop-folders) and the
// Organize surface renders it. It lives here, not inside a component, because
// the tree component that used to own it is gone and only the shape is shared.

export interface FolderNode {
  id: string;
  name: string;
  color: string | null;
  icon?: string | null;
  description?: string | null;
  parentId: string | null;
  _count: { sops: number; access: number };
  /** Rolled-up count: this folder plus every descendant. Server-computed. */
  sopCountDeep: number;
}

/**
 * Special filter values reserved alongside real folder ids:
 *   "all"  = every visible SOP (default)
 *   "none" = only SOPs not in any folder ("Unfiled")
 */
export type FolderFilterValue = "all" | "none" | string;
