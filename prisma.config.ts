import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI (migrate / generate / studio) needs a direct connection —
// it takes a Postgres advisory lock during migrations, which PgBouncer
// in transaction mode (Neon's pooler) can't hold reliably. Prefer an
// explicit DIRECT_URL, otherwise derive one by stripping `-pooler.`
// from the Neon hostname. Runtime queries continue to use the pooled
// DATABASE_URL via `src/lib/prisma.ts`.
const pooledUrl = process.env["DATABASE_URL"];
const migrationUrl =
  process.env["DIRECT_URL"] ||
  (pooledUrl ? pooledUrl.replace("-pooler.", ".") : undefined);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl,
  },
});
