// Stops a database command that belongs only on a developer's own database
// (migrate dev, migrate reset, seed) from reaching any other one.
//
// WHY. These run against whatever DIRECT_URL or DATABASE_URL names, which
// prisma.config.ts reads from .env, and a developer's .env can be a tunnel to
// production (127.0.0.1:5433). migrate dev offers to RESET a database whose
// history differs from prisma/migrations, which production's does (tables
// made with db push), and a reset drops every table on one keypress.
//
// Allowed: Postgres on this machine at its default port, localhost:5432 or
// 127.0.0.1:5432 (another local port is what a tunnel looks like). Anything
// else is refused, naming the host and port only, never the credentials.
//
// --unless-deploy also lets the deploy through (DEPLOY_MIGRATE=1), for
// `npm run db:deploy`.
import "dotenv/config";

if (process.argv.includes("--unless-deploy") && process.env.DEPLOY_MIGRATE === "1") process.exit(0);

const raw = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
let host = "";
let port = "";
try {
  const u = new URL(raw);
  host = u.hostname;
  port = u.port || "5432";
} catch {
  // Unreadable: refused below.
}
const local = ["localhost", "127.0.0.1", "[::1]"].includes(host) && port === "5432";
if (!local) {
  console.error(
    `Refused: this command is only for a database on this machine (localhost:5432), and DIRECT_URL or DATABASE_URL points at ${host ? `${host}:${port}` : "nothing readable"}.\n` +
      "Set DATABASE_URL to your local database for this one command, for example:\n" +
      '  DIRECT_URL= DATABASE_URL="postgresql://user@localhost:5432/workwrk" npm run <script>',
  );
  process.exit(1);
}
