// The permission matrix's retirement (access-model-spec section 9, Phase 8
// stage E): which cells an org's stored matrix changed from the shipped
// defaults, for the dry-run report and the access.matrix_retired row. Pure.

import { ACCESS_LEVELS, PERMISSION_MODULES, checkPermission, type AccessLevel, type PermissionMatrix, type PermissionModule } from "../permissions";
import { matrixCellRow } from "./matrix-rules";

export interface CellChange {
  level: AccessLevel;
  module: PermissionModule;
  action: string;
  stored: boolean;
  shipped: boolean;
  /** The section 9 rule the cell becomes, when the gate table owns it. */
  becomes: string | null;
}

/** Every cell where the stored matrix answers differently from the shipped defaults. */
export function customisedCells(matrix: PermissionMatrix | null | undefined): CellChange[] {
  if (!matrix || typeof matrix !== "object") return [];
  const out: CellChange[] = [];
  for (const { value: level } of ACCESS_LEVELS) {
    for (const [mod, def] of Object.entries(PERMISSION_MODULES) as [PermissionModule, (typeof PERMISSION_MODULES)[PermissionModule]][]) {
      for (const action of Object.keys(def.actions)) {
        const stored = checkPermission(level, matrix, mod, action);
        const shipped = checkPermission(level, null, mod, action);
        if (stored !== shipped) out.push({ level, module: mod, action, stored, shipped, becomes: matrixCellRow(mod, action)?.note ?? null });
      }
    }
  }
  return out;
}

/** Whether the stored value is a matrix worth exporting (anything object-shaped). */
export function hasStoredMatrix(settings: unknown): boolean {
  const m = (settings as { permissions?: unknown } | null)?.permissions;
  return !!m && typeof m === "object" && Object.keys(m as object).length > 0;
}
