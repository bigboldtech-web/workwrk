-- Add OKR + KEY_RESULT to EntityLinkType so Objectives and Key Results
-- can be linked to Tasks/Boards/Spaces (and vice-versa) like every other
-- alignment entity (KRA/KPI/SOP already supported).
ALTER TYPE "EntityLinkType" ADD VALUE IF NOT EXISTS 'OKR';
ALTER TYPE "EntityLinkType" ADD VALUE IF NOT EXISTS 'KEY_RESULT';
