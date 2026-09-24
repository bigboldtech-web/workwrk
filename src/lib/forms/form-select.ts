// The FormDefinition columns the responder doors read (the public GET and the
// one submit route, through lib/forms/responder-access).
//
// `settings` (FormDefinition.settings Json, the additive column of Phase 5
// step 6) is selected whenever the generated client knows the column.
//
// WHAT THIS DOES NOT DO: FORM_HAS_SETTINGS_COLUMN reads the GENERATED CLIENT,
// not the database, so once `prisma generate` has run it is always true and
// it does not protect a reader from a database that lacks the column. That
// protection is the deploy order: prisma/sql/2026-09-23-form-settings.sql is
// in scripts/deploy-migrations.mjs SQL_MANIFEST, which runs inside
// `npm run build` BEFORE `next build`, and a failure there aborts the build
// and leaves production on the old release. So no build of this code serves
// against a database without the column. (Readers that use findFirst with no
// select, the builder GET/PATCH/DELETE, the lists, duplicate, trash capture
// and the cron, rely on the same ordering.)

import { Prisma } from "@/generated/prisma";

/** True when the generated client has FormDefinition.settings. */
export const FORM_HAS_SETTINGS_COLUMN = Object.prototype.hasOwnProperty.call(
  Prisma.FormDefinitionScalarFieldEnum,
  "settings",
);

const BASE = {
  id: true, organizationId: true, name: true, description: true, fields: true,
  isPublic: true, targetBoardId: true, targetTableId: true, fieldMappings: true,
  createdById: true,
} as const;

export const FORM_SELECT = (FORM_HAS_SETTINGS_COLUMN ? { ...BASE, settings: true } : BASE) as typeof BASE;
