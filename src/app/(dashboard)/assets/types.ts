// The API row shape the register page, the drawer, the form dialog, the
// assign dialog and the row menu share. The words (labels, tones, warranty
// rule, sorts, scopes) live in src/lib/assets/asset-view.ts, pure and tested;
// the old STATUS_HUE and CONDITION_HUE maps onto --os-c-* are gone (status is
// a semantic StatusChip tone, condition a plain word).

import type { AssetCondition, AssetStatus } from "@/lib/assets/asset-view";

export type { AssetCondition, AssetStatus, AssetType, AssetSort, AssetGroup, AssetScope } from "@/lib/assets/asset-view";
export {
  ASSET_TYPES, ASSET_CONDITIONS, ASSET_STATUSES,
  STATUS_LABEL, CONDITION_LABEL, typeLabel, personName, statusColor,
} from "@/lib/assets/asset-view";

export type ApiPerson = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
  department?: { name?: string | null } | null;
};

export type ApiAsset = {
  id: string;
  name: string;
  type: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  imeiNumber?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  warrantyExpiry?: string | null;
  condition: AssetCondition;
  status: AssetStatus;
  notes?: string | null;
  assignedAt?: string | null;
  createdAt?: string;
  assignedTo?: ApiPerson | null;
};

export type AssetsResponse = {
  assets: ApiAsset[];
  /** The server's count and sum over the whole filtered set, not the page. */
  total: number;
  totalValue: number;
  page: number;
  pageSize: number;
  scope: "own" | "team" | "all";
  scopes: string[];
  scopeStripped: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canAssign: boolean;
  canDelete: boolean;
};

/** The write rights the page threads into the row menu and the drawer. */
export type AssetRights = Pick<AssetsResponse, "canEdit" | "canAssign" | "canDelete">;
