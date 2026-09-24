import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // THE PRODUCTION BUILD DOES NOT TYPE CHECK. CI DOES, AND DEPLOY WAITS FOR IT.
  //
  // This skips `next build`'s own TypeScript step entirely. It is safe only
  // because the "Type check" step in .github/workflows/ci.yml runs
  // `next typegen && tsc --noEmit` on every push, and the Deploy workflow
  // runs only when CI succeeds. scripts/verify-commit.sh runs the same check
  // before a push. DO NOT REMOVE THAT CI STEP WITHOUT REMOVING THIS LINE.
  //
  // Why: after Phase 5 a full type check needs about 3.5 GB resident
  // (measured), and the production box has 3921 MB with roughly 3000 MB free.
  // next build's TypeScript step ran out of heap at the 3072 MB cap on
  // 2026-09-24, so every deploy would have failed deterministically. The box
  // rebuilds what CI already proved; it does not need to prove it again.
  //
  // The one gap: a MANUAL workflow_dispatch deploy skips the CI check (see
  // deploy.yml). That door exists for a CI run lost to a flaky runner, so run
  // it only for a commit that has already passed CI.
  typescript: { ignoreBuildErrors: true },

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
  //
  // IT WENT MARGINAL AGAIN ON 2026-09-22, AND THE CAP IS NOT THE FIX.
  //
  // The deploy of 08e5a2fa died with the same signature as before: exit 1,
  // no `::error::DEPLOY FAILED` line, so the `fail` handler never ran and
  // the session went with the process. That commit changed metadata STRINGS
  // and nothing else, and the deploy immediately before it succeeded, so the
  // build now sometimes fits in 3921 MB and sometimes does not.
  //
  // MEASURED, so nobody repeats it: a full production build was run at two
  // lower caps and BOTH died with a JS heap OOM (SIGABRT), which is the
  // build saying it genuinely needs the memory rather than merely being
  // allowed to take it.
  //
  //   --max-old-space-size=2048   SIGABRT, heap exhausted
  //   --max-old-space-size=2560   SIGABRT, heap exhausted
  //   --max-old-space-size=3072   completes
  //
  // So the requirement sits between 2560 and 3072 on a box with roughly
  // 3000 MB free after the OS. There is no cap that both completes and
  // leaves headroom: lowering it does not make the build smaller, it only
  // converts an intermittent kernel kill into a deterministic heap crash,
  // which is worse. 3072 stays.
  //
  // THE REAL FIX IS THE BOX, and it is not a code change: more RAM, or swap
  // so a spike pages instead of being killed. Until then a deploy can fail
  // for reasons unrelated to the commit being deployed, and the retry is a
  // fresh push (workflow_dispatch needs credentials this session does not
  // have).
  experimental: {
    cpus: 1,
    // Scale what workers there are by memory actually free at the time rather
    // than by core count, so a busier box builds with less rather than dying.
    memoryBasedWorkersCount: true,
    // The dev server's filesystem cache is ON unless WORKWRK_DEV_FS_CACHE=0,
    // which is Next 16's own default, so nobody's `next dev` changes.
    //
    // The opt-out exists for the long-running screenshot server that
    // verification workflows drive (scripts/dev/, port 3007). Under hours of
    // headless browsing that cache grew to 64 GB and then 82 GB, and twice the
    // server sat at over 1000% CPU with no request in flight. A full tsc took
    // more than ten minutes while it spun and five seconds once it stopped,
    // and the agents sharing the machine stalled on commands as trivial as
    // `cat`. A server that is restarted cold for every run gains nothing from
    // the cache and pays for it in background work.
    turbopackFileSystemCacheForDev: process.env.WORKWRK_DEV_FS_CACHE !== "0",
  },

  // Comms Hub was briefly shipped under /chat before the Room rename —
  // stored notification links and bookmarks keep working.
  async redirects() {
    return [
      // Phase 4 (docs/plans/ui-refresh/spec-talk.md section 0 row 1): the four
      // are now PERMANENT (308). Talk has been at /tlk for two renames and
      // there is no page behind /chat or /room to come back to, so a browser
      // caching the hop forever is the outcome we want. Stored notification
      // links and bookmarks keep working either way; what changes is that a
      // returning user stops paying for the round trip.
      //
      // A 308 is cached by the browser indefinitely and cannot be taken back
      // for someone who has already seen it, so these four paths are spent:
      // none of them can ever be a page again.
      { source: "/chat", destination: "/tlk", permanent: true },
      { source: "/chat/:id", destination: "/tlk/:id", permanent: true },
      { source: "/room", destination: "/tlk", permanent: true },
      { source: "/room/:id", destination: "/tlk/:id", permanent: true },
      // Calendar connections are a personal setting, not a workspace one
      // (spec-planner section 0 row 4). The stub that lived at
      // /settings/calendar is gone; /account/connections is the page. The
      // settings registry still carries /settings/calendar as an alias, so
      // settings search finds the page under its old name.
      { source: "/settings/calendar", destination: "/account/connections", permanent: true },
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
      // One calendar for the whole app; the Planner hub owns it. Both of
      // these are real 308s with a Location header, so a stored /calendar
      // bookmark and its query string land on the Planner without the app
      // booting first and hopping client-side (which dropped ?date=).
      { source: "/tasks/calendar", destination: "/planner", permanent: true },
      { source: "/calendar", destination: "/planner", permanent: true },
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
        // Next appends the matched query to the destination, so this arrives
        // as /trash?view=archived&type=doc: the ride-along is documented Next
        // behaviour with no config-level way to drop it. The Trash page
        // (src/app/(dashboard)/trash/page.tsx) redirects server-side to the
        // canonical /trash?type=doc before rendering anything, so the URL a
        // person keeps is clean and /docs never renders on the way. The four
        // /sops/new?type= rows below get the same treatment from
        // SopCreateRoute (one router.replace that drops `type`).
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
      // The two "new" URLs that were used to EDIT (spec-process section 0):
      //
      //   /sops/new/text?id=X      -> /sops/X?edit=1
      //   /sops/new/checklist?id=X -> /sops/X?edit=1
      //
      // The named capture in the `has` value is Next's own mechanism for
      // reading a query value into a destination. These two were held back
      // by a loop: /sops/[id] used to send Written SOPs straight back out to
      // /sops/new/text?id= the moment it saw ?edit=1. It hosts the written
      // editor itself now (src/components/sops/sop-editor-page.tsx), so
      // the redirect has somewhere to land. Both create doors also normalise
      // a stored ?id= link on the page (src/lib/nav/retired-views.ts
      // `legacySopEditorTarget`), the twin that answers on a process that
      // predates this config edit.
      //
      // Next passes the whole request query on to a redirect destination,
      // the matched `id` included, so the browser first lands on
      // /sops/X?id=X&edit=1. The SOP page drops the residue with one
      // router.replace on arrival (the same-path normalisation pattern
      // retired-views.ts describes), so the URL a person copies from the
      // editor is the canonical /sops/X?edit=1.
      {
        source: "/sops/new/text",
        has: [{ type: "query", key: "id", value: "(?<id>[A-Za-z0-9_-]+)" }],
        destination: "/sops/:id?edit=1",
        permanent: true,
      },
      {
        source: "/sops/new/checklist",
        has: [{ type: "query", key: "id", value: "(?<id>[A-Za-z0-9_-]+)" }],
        destination: "/sops/:id?edit=1",
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
      //
      // /signup and /join: the marketing site's CTA targets, which had no
      // route behind them.
      //
      // src/components/marketing/config.ts has named these two since the site
      // was written, every "Start free" button on every marketing page builds
      // its href from them (primaryCta appends ?utm_content=, the Tuesday
      // template appends ?template=tuesday), and the sign-up page has always
      // been at /register. So every conversion button on the marketing site
      // pointed at nothing. It never showed as a 404 in testing: under the
      // hard host split an unlisted first segment is taken for a marketing
      // path, so /signup on the app host answered with the marketing site,
      // HTTP 200, no error anywhere.
      //
      // Next appends the source query to the destination, so ?template= and
      // ?utm_content= ride along to /register intact.
      //
      // 307, NOT 308. A 308 is cached by the browser forever and cannot be
      // withdrawn, which would spend the URL: /signup is the name the whole
      // site's conversion path is built on and it has to stay available to
      // become a real page (a plan-aware or template-aware sign-up) later.
      // Same for /join, whose destination is the invite arm of the same form
      // (register reads ?token and switches to "Join <org>").
      { source: "/signup", destination: "/register", permanent: false },
      { source: "/join", destination: "/register", permanent: false },
    ];
  },
  /* config options here */
};

export default withNextIntl(nextConfig);
