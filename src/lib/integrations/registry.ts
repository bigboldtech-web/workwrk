// The Integrations catalogue (spec-tools-misc 2.6): other people's tools
// WorkwrK can talk to, said honestly.
//
// Each connector is one of:
//   ready      WorkwrK can connect to it today; `setup` names where, and
//              `setupBy` who may (a personal connection, or Owner and Admin).
//   not_built  nobody has built it; the card is a "Request this" that counts
//              the people who want it (IntegrationRequest). Connectors are
//              built on demand, so this count is the roadmap signal.
//   upcoming   on a timeline, rendered only with Show upcoming features on.
//
// Removed rather than moved: Stripe and QuickBooks (finance left the product
// on 2026-06-03). Arrived from /automation/connections, where they were
// Connect buttons with nothing behind them: WhatsApp, Gmail and Slack as
// Request this, and Google Calendar, which is ready. Single sign-on and
// directory sync are Request this until their Settings pages exist, so no
// card ever links to a page that is not there.
//
// Pure and client safe.

export type ConnectorCategory = "Calendar" | "Messaging" | "Email" | "Storage" | "Development" | "Identity" | "Analytics";
export type ConnectorKind = "ready" | "not_built" | "upcoming";

export interface Connector {
  key: string;
  name: string;
  category: ConnectorCategory;
  /** One plain sentence, in the user's words. */
  blurb: string;
  kind: ConnectorKind;
  /** ready only: where it is set up. */
  setup?: { href: string; by: "member" | "admin" };
  /** ready only: rendered only when the deployment has it configured. */
  requiresAvailability?: "google-calendar";
}

export const CONNECTORS: readonly Connector[] = [
  {
    key: "google-calendar",
    name: "Google Calendar",
    category: "Calendar",
    blurb: "See your meetings next to your tasks, and your tasks on your calendar.",
    kind: "ready",
    setup: { href: "/account/connections", by: "member" },
    requiresAvailability: "google-calendar",
  },
  { key: "slack", name: "Slack", category: "Messaging", blurb: "Post task and project updates into your Slack channels.", kind: "not_built" },
  { key: "microsoft-teams", name: "Microsoft Teams", category: "Messaging", blurb: "Get task and project updates in Teams channels and chats.", kind: "not_built" },
  { key: "whatsapp", name: "WhatsApp", category: "Messaging", blurb: "Send reminders and updates to people on WhatsApp.", kind: "not_built" },
  { key: "gmail", name: "Gmail", category: "Email", blurb: "Turn an email into a task and send updates from your own address.", kind: "not_built" },
  { key: "outlook", name: "Outlook", category: "Email", blurb: "Turn an email into a task, and see Outlook meetings in Calendar.", kind: "not_built" },
  { key: "google-drive", name: "Google Drive", category: "Storage", blurb: "Attach Drive files to tasks and docs without downloading them.", kind: "not_built" },
  { key: "onedrive", name: "OneDrive", category: "Storage", blurb: "Attach OneDrive and SharePoint files to tasks and docs.", kind: "not_built" },
  { key: "github", name: "GitHub", category: "Development", blurb: "Link pull requests to tasks and move them when code ships.", kind: "not_built" },
  { key: "gitlab", name: "GitLab", category: "Development", blurb: "Link merge requests to tasks and move them when code ships.", kind: "not_built" },
  { key: "jira", name: "Jira", category: "Development", blurb: "Bring Jira issues into a List and keep both in step.", kind: "not_built" },
  { key: "linear", name: "Linear", category: "Development", blurb: "Bring Linear issues into a List and keep both in step.", kind: "not_built" },
  { key: "sso", name: "Single sign-on (SAML)", category: "Identity", blurb: "Sign in with Okta or Microsoft Entra ID instead of a password.", kind: "not_built" },
  { key: "scim", name: "Directory sync (SCIM)", category: "Identity", blurb: "Add and remove people automatically from your identity provider.", kind: "not_built" },
  { key: "looker", name: "Looker", category: "Analytics", blurb: "Embed a saved Looker dashboard in a doc.", kind: "upcoming" },
  { key: "metabase", name: "Metabase", category: "Analytics", blurb: "Embed a saved Metabase dashboard in a doc.", kind: "upcoming" },
];

export const CONNECTOR_BY_KEY: Readonly<Record<string, Connector>> = Object.fromEntries(CONNECTORS.map((c) => [c.key, c]));

export const CONNECTOR_CATEGORIES: readonly ConnectorCategory[] = [...new Set(CONNECTORS.map((c) => c.category))];

export type ConnectorStatus = "ready" | "connected" | "not_built" | "upcoming";

export interface CatalogueQuery {
  q?: string | null;
  category?: string | null;
  /** "ready" | "not_built" | "requested" */
  status?: string | null;
  showUpcoming?: boolean;
  availability?: { "google-calendar"?: boolean };
}

/** The connectors a viewer sees, filtered by the page's query. Pure. */
export function filterConnectors(
  q: CatalogueQuery,
  requested: ReadonlySet<string> = new Set(),
): Connector[] {
  const needle = (q.q ?? "").trim().toLowerCase();
  return CONNECTORS.filter((c) => {
    if (c.kind === "upcoming" && !q.showUpcoming) return false;
    if (c.requiresAvailability && q.availability?.[c.requiresAvailability] !== true) return false;
    if (q.category && c.category !== q.category) return false;
    if (q.status === "ready" && c.kind !== "ready") return false;
    if (q.status === "not_built" && c.kind !== "not_built") return false;
    if (q.status === "requested" && !requested.has(c.key)) return false;
    if (needle && !`${c.name} ${c.category} ${c.blurb}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** A key that can be requested: known, and not already buildable. */
export function isRequestableConnector(key: string): boolean {
  const c = CONNECTOR_BY_KEY[key];
  return Boolean(c && c.kind !== "ready");
}
