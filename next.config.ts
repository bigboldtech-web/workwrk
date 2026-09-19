import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Comms Hub was briefly shipped under /chat before the Room rename —
  // stored notification links and bookmarks keep working.
  async redirects() {
    return [
      { source: "/chat", destination: "/tlk", permanent: false },
      { source: "/chat/:id", destination: "/tlk/:id", permanent: false },
      { source: "/room", destination: "/tlk", permanent: false },
      { source: "/room/:id", destination: "/tlk/:id", permanent: false },
      // The Work landing. WORK_HOME_HREF (src/lib/nav/route-hub.ts) is the one
      // constant every in-app href reads; it cannot be imported here because
      // next.config runs before the "@/" alias exists, so this literal is its
      // ONE mirror and both flip in the same edit when /home ships.
      { source: "/dashboards", destination: "/home", permanent: false },
      { source: "/dashboards/:id", destination: "/home", permanent: false },
      // Phase 2 W0 (docs/plans/ui-refresh/spec-work-home.md section 4).
      //
      // /assigned-comments was a stub: two tabs that always rendered empty
      // over a schema that does not exist ("Comment-assignment schema does not
      // exist yet" is the page's own header comment), plus a dead Filter pill
      // and cosmetic Resolved / date / search controls. It held no data, so
      // nothing is stranded by sending it to the Inbox. Comment notifications
      // already land there as `task_comment` rows, which is where an assigned
      // comment will land too once ItemUpdate gains an assignee.
      //
      // 308, per spec-work-home section 0: the whole redirect table is
      // permanent, and this stub is gone for good.
      { source: "/assigned-comments", destination: "/inbox?tab=primary&type=task_comment", permanent: true },
      //
      // Phase 2 Stage C. /home and /my-work now exist, so the four landings
      // that pointed at nothing of their own become permanent redirects:
      //
      //   /today      ran a query for the viewer's earliest readable Space and
      //               sent them into it. Not a landing, and nothing of its own
      //               to lose: the page file held that query and no UI.
      //   /dashboard  a redirect to /today over a tree that was already gone.
      //   /tasks      the "My Wrk" card grid. Of its eleven cards, four read
      //               anything; two of those (Assigned to me, Goals) are Home
      //               widgets now and the third (KRAs and KPIs) is the Weekly
      //               review widget's second row. Nothing that had data lost a
      //               home.
      //   /tasks/personal-list  a pure move: the SAME Item-backed board, at
      //               /my-work/personal, rendered by the same BoardCanvas.
      { source: "/today", destination: "/home", permanent: true },
      { source: "/dashboard", destination: "/home", permanent: true },
      { source: "/tasks", destination: "/home", permanent: true },
      { source: "/tasks/personal-list", destination: "/my-work/personal", permanent: true },
      //
      // The seven legacy task LIST pages. Their page files are deleted in this
      // release (git shows seven `D` rows under (dashboard)/tasks/) because
      // every row they showed is an Item now, and My work shows Items.
      //
      // These rows are not optional. `/tasks/[id]` is a sibling DYNAMIC
      // segment, so without a redirect `/tasks/backlog` is read as a task id
      // and answers HTTP 200 with the in-shell "We couldn't find that page":
      // a soft 404 that no bookmark, old reminder email, link unfurler,
      // crawler or 404 monitor can tell from a working page. Each one also has
      // a route-handler twin beside it (e.g. tasks/backlog/route.ts) so the
      // redirect is live under hot reload and curlable without a restart;
      // the row here is what answers in production, before routing.
      //
      // Destinations are spec-work-home section 0's table. `group=due` is My
      // work's default grouping, stated rather than implied because it is the
      // clause that makes the destination equivalent: the Today / Overdue
      // page's three buckets and the Backlog page's undated set are two cuts
      // of the same Due date grouping. Backlog carries `bucket=nodate` as
      // well, because the Backlog page WAS the undated set: landing on the
      // whole of My work grouped by date is a different page, and the set the
      // bookmark named would then be a scroll away rather than a click.
      { source: "/tasks/assigned-to-me", destination: "/my-work", permanent: true },
      { source: "/tasks/today-overdue", destination: "/my-work?group=due", permanent: true },
      { source: "/tasks/backlog", destination: "/my-work?group=due&bucket=nodate", permanent: true },
      { source: "/tasks/board", destination: "/my-work?view=board", permanent: true },
      { source: "/tasks/gantt", destination: "/my-work", permanent: true },
      { source: "/tasks/sprint", destination: "/my-work", permanent: true },
      // One calendar for the whole app; the Planner hub owns it.
      { source: "/tasks/calendar", destination: "/planner", permanent: true },
      //
      // DELIBERATELY NOT HERE, and it is not an oversight:
      //
      //   /tasks/[id] is the per-row forwarding address for every old task
      //     link. Its destination comes out of the `LegacyRedirect` table that
      //     scripts/migrate-legacy-tasks.ts wrote, so there is no static
      //     target a row here could carry. It answers a real 308 from
      //     tasks/[id]/route.ts.
      //   /me/mentions is the only door to doc and SOP mentions. The Inbox
      //     cannot show them until scripts/backfill-mentions.ts has run in
      //     production, which is the founder's step. Redirecting first is a
      //     delete.
      //
      // Phase 2 Stage E, step 8: the four Trash surfaces become one
      // (docs/plans/ui-refresh/spec-spaces-lists.md section 2, /trash).
      //
      // All three land on the ARCHIVED tab, not the default Deleted one,
      // because all three listed rows carrying `archivedAt` and that is where
      // those rows are now. Sending them to `?type=doc` alone would land on a
      // tab their rows are not on, which is the same as losing them.
      //
      //   /docs/trash            the Notes trash: GET /api/docs?archived=1,
      //                          restore via POST /api/docs/[id]/restore. The
      //                          same rows are the Doc cut of the Archived tab
      //                          and Restore there un-archives in place.
      //   /docs?view=archived    the Docs page's own Archived view: the same
      //                          query, a third list of the same rows.
      //   /agreements?view=trash the Contracts trash view.
      //
      // THE MATCHED QUERY RIDES ALONG, and there is no flag to stop it: Next
      // appends the source URL's query string to the destination on every
      // redirect, including the parameter the `has` clause matched. So the two
      // query-matched rows below actually land on
      // /trash?view=archived&tab=archived&type=doc, not the clean pair the
      // list above names. `view` is not a parameter /trash owns, so it is
      // inert today; it is written down because the day Trash gains a view
      // switcher, a stray `view=archived` in the address bar is a collision
      // and this is the line that explains where it came from. The literal
      // /docs/trash row has no query to carry and lands clean.
      { source: "/docs/trash", destination: "/trash?tab=archived&type=doc", permanent: true },
      {
        source: "/docs",
        has: [{ type: "query", key: "view", value: "archived" }],
        destination: "/trash?tab=archived&type=doc",
        permanent: true,
      },
      {
        source: "/agreements",
        has: [{ type: "query", key: "view", value: "trash" }],
        destination: "/trash?tab=archived&type=contract",
        permanent: true,
      },
      // Whiteboards were renamed to Canvas — keep old links/bookmarks working.
      { source: "/whiteboards", destination: "/canvas", permanent: false },
      { source: "/whiteboards/:id", destination: "/canvas/:id", permanent: false },
      // Settings chassis (docs/plans/ui-refresh/settings-architecture.md 8.4).
      // Only the rows whose target exists today, shows the same content AND
      // admits the same people; the rest land when their target page ships
      // (the registry in src/lib/settings-registry.ts lists every alias).
      // Deliberately NOT here yet: /settings/hierarchy -> /organization. The
      // old page is ungated and renders for every member, while /organization
      // sits behind requireManagerPage() and bounces non-managers to their
      // own profile, so the redirect would change who may open the content.
      // It ships with the access gate step.
      // Bare /account had no page (a 404 inside the takeover).
      { source: "/account", destination: "/account/profile", permanent: true },
    ];
  },
  /* config options here */
};

export default withNextIntl(nextConfig);
