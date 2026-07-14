-- Folder-level "Make private". Default WORKSPACE = existing behaviour, so
-- every current folder is unaffected. Visibility enum already exists (Space/Board).
ALTER TABLE "Folder" ADD COLUMN "visibility" "Visibility" NOT NULL DEFAULT 'WORKSPACE';
