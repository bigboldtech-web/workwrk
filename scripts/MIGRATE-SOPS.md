# SOP folder unification — migration runbook

This walks through the **one-time** rollout of the unified SOP folder
system. Every step is **non-destructive**: legacy `category` /
`subcategory` columns and `SOPCategory` / `SOPSubcategory` tables are
left in place so we can roll back without losing anything.

## What changes

- `SOPFolder` becomes a tree (`parentId` → parent). Sub-folders take
  the place of subcategories.
- `SOP.tags` (text array) replaces ad-hoc category usage that didn't
  fit the structural model — free-form, multi-value, no access control.
- The SOPs page swaps category/folder dropdowns for a sidebar tree
  with rolled-up counts, drag-and-drop, and tag chip filtering.
- Folder access cascades: a grant on "HR" implies access to "HR /
  Onboarding", "HR / Hiring", etc.

## Order of operations

### 1. Apply the schema migration

This adds `parentId`, `icon`, and `tags` columns. It does **not**
delete any existing data.

```bash
DATABASE_URL=... npx prisma migrate deploy
```

If you're on a dev branch and want to apply it locally:

```bash
DATABASE_URL=... npx prisma migrate dev
```

### 2. Dry-run the data migration

This prints exactly what *would* happen — every folder it would
create, every SOP it would re-link — without writing anything.

```bash
DATABASE_URL=... npx tsx scripts/migrate-sop-categories-to-folders.ts --dry-run --verbose
```

Eyeball the summary at the bottom:

```
SOPs scanned:           42
SOPs linked to folder:  38
SOPs already foldered:  0      ← if you'd already moved any SOPs
SOPs without category:  4
top-level folders made: 6
child folders made:     3
```

If the numbers look wrong (e.g. it says it'll create 0 folders when
you have lots of categorized SOPs), stop and check whether the dev
DB matches prod.

### 3. Run the migration for real

Idempotent — safe to re-run if it fails partway. SOPs that already
have a `folderId` are left alone, and folders that already exist by
name are reused.

```bash
DATABASE_URL=... npx tsx scripts/migrate-sop-categories-to-folders.ts
```

For pilot rollouts, scope to one org first:

```bash
DATABASE_URL=... npx tsx scripts/migrate-sop-categories-to-folders.ts --org=<orgId>
```

### 4. Verify

In the app:

- Open `/sops`. You should see the folder tree on the left.
- Top-level folders should match every distinct old `category` you
  used. Sub-folders should match `subcategory` strings.
- Counts on each tree node should roll up (parent shows itself + all
  descendant SOPs).
- Right-click a folder → rename / new sub-folder / manage access /
  delete (admin only).
- Drag an SOP card onto a folder node → SOP moves there.

In SQL:

```sql
-- Every SOP with a category should now also have a folderId
SELECT COUNT(*) FROM "SOP"
WHERE category IS NOT NULL AND "folderId" IS NULL;
-- → 0 expected
```

## Rollback

Because the migration is additive, rollback is just "revert the app
to the previous version." The folders the script created are still
there but won't be referenced by old code paths. If you want to
fully clean up:

```sql
-- Roll back is opt-in. ONLY run if you're sure.
UPDATE "SOP" SET "folderId" = NULL WHERE "folderId" IN (
  SELECT id FROM "SOPFolder" WHERE "parentId" IS NULL
  -- + whatever scope you migrated
);
DELETE FROM "SOPFolder" WHERE ...;
```

## Phase-out (later, optional)

Once you've run on prod for a release or two and are confident:

1. Drop the legacy `category` / `subcategory` columns from `SOP`.
2. Drop the `SOPCategory` and `SOPSubcategory` tables.
3. Remove the legacy "category" picker from the Create dialog.

Don't do this until you're sure no other code path reads those
columns. Search:

```bash
git grep -nE "\\.category\\b|SOPCategory|SOPSubcategory"
```
