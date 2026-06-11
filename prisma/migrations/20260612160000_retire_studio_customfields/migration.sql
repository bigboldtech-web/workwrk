-- Retire StudioBoard (build-your-own boards) + the legacy second
-- custom-fields system. The Board/Item PPMS replaces StudioBoard;
-- Board.schema.fields replaces CustomFieldDefinition/Value. Forms now
-- push submissions to canonical Board Items instead of StudioItems.
--
-- Drop in FK-dependency order (children before parents), then the
-- enums used only by these models. (EntityLinkType has no STUDIO_BOARD
-- value, so no polymorphic link cleanup is needed.)

DROP TABLE IF EXISTS "StudioItem" CASCADE;
DROP TABLE IF EXISTS "BoardTemplate" CASCADE;
DROP TABLE IF EXISTS "StudioBoard" CASCADE;
DROP TABLE IF EXISTS "CustomFieldValue" CASCADE;
DROP TABLE IF EXISTS "CustomFieldDefinition" CASCADE;

DROP TYPE IF EXISTS "StudioLayout";
DROP TYPE IF EXISTS "BoardTemplateVisibility";
DROP TYPE IF EXISTS "CustomFieldType";
