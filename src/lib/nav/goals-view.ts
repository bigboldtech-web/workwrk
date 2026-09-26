// /okrs: one URL per view (spec-goals section 0 and section 1 naming canon),
// and the one-release mapping of the retired query forms. Pure, tested.
//
//   /okrs              My goals
//   /okrs?view=team    Team goals
//   /okrs?view=company Company goals
//
// Retired: ?mine=1 -> /okrs, ?team=1 -> ?view=team, ?level=company ->
// ?view=company. `?level=department` and `?level=individual` were never
// printed by the product and are not views; they keep today's behaviour (the
// visible list narrowed to that level) rather than silently widening.

export type GoalsView = "mine" | "team" | "company" | "level";

export interface GoalsQuery {
  view?: string;
  mine?: string;
  team?: string;
  level?: string;
  new?: string;
}

export interface ResolvedGoalsView {
  view: GoalsView;
  /** The legacy ?level= filter, only for view "level". */
  legacyLevel?: string;
  /** Set when the URL is not the canon form: the page router.replace()s to it. */
  canonicalHref?: string;
  /** Access 5.5 rule 4: the one notice line when a requested view is not the viewer's. */
  notice?: string;
}

export const GOALS_VIEW_HREF: Record<Exclude<GoalsView, "level">, string> = {
  mine: "/okrs",
  team: "/okrs?view=team",
  company: "/okrs?view=company",
};

export const TEAM_GOALS_NOTICE = "Team goals shows the goals of people who report to you.";

export function canonicalGoalsView(q: GoalsQuery, opts: { canTeam: boolean }): ResolvedGoalsView {
  const level = q.level?.toLowerCase();
  let view: GoalsView;
  if (q.view === "team" || q.team === "1") view = "team";
  else if (q.view === "company" || level === "company") view = "company";
  else if (level && !q.view && q.mine !== "1") view = "level";
  else view = "mine";

  let notice: string | undefined;
  if (view === "team" && !opts.canTeam) {
    view = "mine";
    notice = TEAM_GOALS_NOTICE;
  }

  if (view === "level") return { view, legacyLevel: q.level };

  const canon = GOALS_VIEW_HREF[view];
  const wantsNew = q.new === "1";
  const canonWithNew = wantsNew ? `${canon}${canon.includes("?") ? "&" : "?"}new=1` : canon;
  const isCanon =
    !notice &&
    q.mine === undefined &&
    q.team === undefined &&
    q.level === undefined &&
    (view === "mine" ? q.view === undefined : q.view === view);
  return { view, canonicalHref: isCanon ? undefined : canonWithNew, notice };
}
