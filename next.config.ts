import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // BUILD MEMORY. The production box has 3921 MB of RAM, and two deploys died
  // there without printing anything at all: not a build error, a kill. Next 16
  // builds with Turbopack, which runs the build across SEPARATE PROCESSES
  // (build-main, the Turbopack compilation workers, and a child process per
  // prerendered route), and `--max-old-space-size` caps EACH of them rather
  // than the total. So lowering that cap from 4096 to 3072 changed nothing:
  // several workers were still free to add up past physical memory, the kernel
  // OOM killer took the build, and it took the SSH session with it, which is
  // why no handler ever reported.
  //
  // `cpus: 1` is the knob that actually bounds the total, because it is the
  // worker count the build scales by. The build gets slower on that box and it
  // fits, which is the trade worth making on a machine this size.
  experimental: {
    cpus: 1,
    // Scale what workers there are by memory actually free at the time rather
    // than by core count, so a busier box builds with less rather than dying.
    memoryBasedWorkersCount: true,
  },

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
      { source: "/tasks/gantt", destination: "/my-work?view=gantt", permanent: true },
      { source: "/tasks/sprint", destination: "/my-work?view=sprint", permanent: true },
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
      // All three carry rows that live under `archivedAt`, not under a
      // TrashItem snapshot, so all three belong on the ARCHIVED tab. Phase 3
      // moved that decision out of the URL and into `resolveTrashTab`
      // (src/lib/trash-view.ts), which reads the requested `?type=` and picks
      // Archived for the five types that have no deleted source. So these
      // rows now carry the clean `?type=` the specs write, and still land on
      // the tab their rows are on.
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
      // /trash?view=archived&type=doc, not the clean pair the list above
      // names. `view` is not a parameter /trash owns, so it is inert today; it
      // is written down because the day Trash gains a view switcher, a stray
      // `view=archived` in the address bar is a collision and this is the line
      // that explains where it came from. The literal /docs/trash row has no
      // query to carry and lands clean.
      //
      // IT IS ALSO WHY THREE RETIRED VIEWS ARE NOT REDIRECTS AT ALL.
      // /docs?view=meeting -> /docs, /docs?view=private -> /docs?view=my and
      // /notetaker?mine=1 -> /notetaker?view=my all keep the SAME path, so the
      // ride-along query would re-match the rule on the very next request and
      // the browser would loop until it gave up. Those three are normalised by
      // the page instead (src/lib/nav/retired-views.ts, one pure table, and a
      // router.replace on mount), which is linkable, restorable and loop-free.
      // PHASE 3 retune: the `&tab=archived` half is gone from all three.
      // `resolveTrashTab` (src/lib/trash-view.ts) now picks the Archived tab
      // for a Doc, a Canvas or a Contract, because those three are archived
      // in place and have no TrashItem row, so the tab no longer has to be
      // spelled into the URL. The specs write these three targets as the
      // clean `?type=doc` and `?type=contract`, and now they are.
      { source: "/docs/trash", destination: "/trash?type=doc", permanent: true },
      {
        // Next appends the matched query to the destination, so this lands on
        // /trash?view=archived&type=doc. `view` is inert there (resolveTrashTab
        // reads `tab` and `type` only) and there is no config-level way to drop
        // it: the ride-along is documented Next behaviour. The alternative, a
        // page-level normalisation, would render /docs and its whole doc list
        // before bouncing, which is worse than an extra parameter.
        source: "/docs",
        has: [{ type: "query", key: "view", value: "archived" }],
        destination: "/trash?type=doc",
        permanent: true,
      },
      {
        source: "/agreements",
        has: [{ type: "query", key: "view", value: "trash" }],
        destination: "/trash?type=contract",
        permanent: true,
      },
      //
      // Phase 3 Stage A, docs-knowledge section 0 and section 4 step 1.
      //
      // /library is NOT redirected here, and that is deliberate.
      //
      // It was, with four `has` rows plus a bare one. Next appends the source
      // query to the destination on every config redirect (its own docs say
      // so), so /library?tab=notes landed on /docs?tab=notes: a retired
      // parameter riding along into a page that does not read it, in the URL
      // the person then keeps and shares. The route handler at
      // (dashboard)/library/route.ts maps the same four tabs and emits the
      // clean destination, and being in the module graph it answers under hot
      // reload, which a config row read once at server start does not. The
      // config rows shadowed it, so they went and the handler is the one
      // door. Every destination the Library had is preserved there: Notes ->
      // /docs, Whiteboards -> /canvas, Files -> /files, Tables -> /tables,
      // anything else -> /docs.
      //
      // One URL per SOP kind (spec-process section 0). /sops/new?type=X was a
      // picker page that POSTed a row on the click and then routed; these four
      // rows keep every stored ?type= link, sidebar action and bookmark
      // landing on the right editor, and /sops/new is now a chooser that
      // creates nothing.
      //
      // TO BE PRECISE ABOUT WHAT IS AND IS NOT FIXED: the four kind ROUTES
      // still mint their row on arrival, so a refresh of one of them still
      // leaves an "Untitled" behind. Create-on-first-change is spec-process
      // step 3 and lands for all four kinds together with the SopEditorPage
      // rebuild; doing it for one kind here would leave two create models
      // behind one chooser.
      {
        source: "/sops/new",
        has: [{ type: "query", key: "type", value: "[Ss][Tt][Ee][Pp][Ss]" }],
        destination: "/sops/new/steps",
        permanent: true,
      },
      {
        source: "/sops/new",
        has: [{ type: "query", key: "type", value: "[Ww][Rr][Ii][Tt][Tt][Ee][Nn]" }],
        destination: "/sops/new/text",
        permanent: true,
      },
      {
        source: "/sops/new",
        has: [{ type: "query", key: "type", value: "[Cc][Hh][Ee][Cc][Kk][Ll][Ii][Ss][Tt]" }],
        destination: "/sops/new/checklist",
        permanent: true,
      },
      {
        source: "/sops/new",
        has: [{ type: "query", key: "type", value: "[Rr][Ee][Cc][Oo][Rr][Dd][Ee][Dd]" }],
        destination: "/sops/new/record",
        permanent: true,
      },
      //
      // DELIBERATELY NOT HERE, and it is a loop, not an oversight:
      //
      //   /sops/new/text?id=X     -> /sops/X?edit=1
      //   /sops/new/checklist?id=X -> /sops/X?edit=1
      //
      // spec-process section 0 asks for both, and both are written and ready
      // (the named capture in a `has` value is Next's own mechanism for
      // reading a query value into a destination). They cannot ship until
      // step 3 teaches /sops/[id] to edit a Written SOP in place, because
      // TODAY that page sends Written SOPs straight back out:
      // sops/[id]/page.tsx:902 does router.replace(`/sops/new/text?id=X`)
      // the moment it sees ?edit=1 on written content. With the redirect on,
      // those two lines chase each other and a Written SOP can never be
      // opened for editing at all. The redirect is half of one change; the
      // other half is the editor, and they ship together.
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
