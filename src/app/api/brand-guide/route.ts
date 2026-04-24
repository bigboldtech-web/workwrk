import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";

/**
 * Brand Guide is a per-organization singleton — the company's brand
 * bible: story, positioning, voice, messaging, logo, colors, type. It
 * lives inside `Organization.settings.brandGuide` (same pattern as
 * `companyProfile`) so we don't need a separate table for what is
 * fundamentally a one-row-per-org blob.
 */

export interface BrandColor {
  id: string;
  name: string;
  hex: string;
  role?: string;
}

export interface BrandFont {
  id: string;
  name: string;
  usage?: string;
  source?: string;
}

export interface BrandGuide {
  story?: string;
  positioning?: string;
  voiceAndTone?: string;
  messaging?: string;
  logoUrl?: string;
  logoUsage?: string;
  colors?: BrandColor[];
  typography?: BrandFont[];
  imageryGuidelines?: string;
  updatedAt?: string;
}

const EMPTY_BRAND_GUIDE: BrandGuide = {
  story: "",
  positioning: "",
  voiceAndTone: "",
  messaging: "",
  logoUrl: "",
  logoUsage: "",
  colors: [],
  typography: [],
  imageryGuidelines: "",
};

// Managers can edit. Matches the `/api/settings` companyProfile gate so
// the two adjacent editors share the same trust boundary.
const EDITOR_ROLES = ["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "HR", "VP", "DIRECTOR", "MANAGER"];

function canEdit(session: { user: { accessLevel?: string } } | null | undefined): boolean {
  if (!session?.user) return false;
  return EDITOR_ROLES.includes(session.user.accessLevel || "");
}

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  if (!org) return jsonError("Organization not found", 404);

  const settings = (org.settings as Record<string, unknown>) || {};
  const brandGuide: BrandGuide = {
    ...EMPTY_BRAND_GUIDE,
    ...((settings.brandGuide as BrandGuide) || {}),
  };

  return jsonSuccess({ brandGuide, canEdit: canEdit(session) });
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  if (!canEdit(session)) {
    return jsonError("Forbidden — brand guide is editable by managers only", 403);
  }

  const orgId = getOrgId(session);
  const body = (await req.json()) as Partial<BrandGuide> | null;
  if (!body || typeof body !== "object") {
    return jsonError("Invalid payload");
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  if (!org) return jsonError("Organization not found", 404);

  // Widen to `any` for the write — Prisma's `InputJsonValue` enforces a
  // deep structural shape that our typed `BrandGuide` interface doesn't
  // advertise. The existing `/api/settings` route uses the same escape
  // hatch for this exact reason.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings: any = (org.settings as any) || {};
  const current = (settings.brandGuide as BrandGuide) || {};

  // Shallow-merge so clients can PATCH a single section at a time without
  // clobbering the rest. Arrays (colors, typography) replace wholesale
  // because there's no sensible deep-merge semantics for them.
  const next: BrandGuide = {
    ...current,
    ...pickDefined(body),
    updatedAt: new Date().toISOString(),
  };

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      settings: { ...settings, brandGuide: next },
    },
  });

  return jsonSuccess({ brandGuide: next });
}

// Strip undefined values so a PATCH with only a subset of fields doesn't
// overwrite other fields with undefined.
function pickDefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj) as [keyof T, T[keyof T]][]) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
