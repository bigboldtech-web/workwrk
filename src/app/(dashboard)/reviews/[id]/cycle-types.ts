// The slices of the review cycle payloads the cycle page reads
// (GET /api/reviews/[id] and its sub-routes).

export type Person = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  avatar?: string | null;
  role?: { title?: string | null } | null;
  department?: { name?: string | null } | null;
};

export type SelfKraRating = { kraId: string; kraName?: string; rating: number | null; achievements?: string };
export type MgrKraRating = { kraId: string; kraName?: string; rating: number | null; comments?: string };
export type Reflection = { wentWell?: string; couldImprove?: string; goals?: string };

export type PeerFeedbackRow = {
  id: string;
  status?: string;
  anonymous?: boolean;
  giverId?: string | null;
  receiverId?: string;
  giver?: Person | null;
  receiver?: Person;
  rating?: number | null;
  collaborationRating?: number | null;
  strengths?: string | null;
  improvements?: string | null;
  comments?: string | null;
  review?: { id?: string; cycle?: { name?: string | null } | null } | null;
};

export type ReviewRow = {
  id: string;
  status: string;
  subjectId: string;
  reviewerId: string;
  subject: Person;
  reviewer?: Person | null;
  kpiScore?: number | null;
  managerRating?: number | null;
  overallScore?: number | null;
  calibratedScore?: number | null;
  compositeScore?: number | null;
  potential?: number | null;
  outcome?: string | null;
  managerComments?: string | null;
  submittedAt?: string | null;
  selfRatings?: { kraRatings?: SelfKraRating[]; reflection?: Reflection | null } | null;
  managerAssessment?: { kraRatings?: MgrKraRating[]; behavioral?: Record<string, number>; overallComments?: string; recommendation?: string } | null;
  peerFeedback?: PeerFeedbackRow[];
  peerSummary?: { submitted: number; requested: number; averageRating: number | null; averageCollaboration: number | null; belowFloor: boolean };
  peerOnly?: boolean;
};

export type Band = { label: string; min: number; max: number; color?: string };

export type CycleData = {
  id: string;
  name: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  audienceType?: string;
  createdById?: string | null;
  reviews: ReviewRow[];
  stats: { total: number; selfDone: number; managerDone: number; calibrated: number; completed: number };
  viewer: { canManage: boolean; canDelete?: boolean; peopleTeamOrAdmin: boolean; isSubject: boolean; isReviewer: boolean; isPeer: boolean; inChain: boolean };
  scale: { words: string[]; fromSettings: boolean };
  bands: Band[];
  createdBy: { id: string; name: string } | null;
};

export type AppraisalLetter = {
  companyName: string;
  employeeName: string;
  employeeEmail?: string | null;
  department?: string;
  role?: string;
  joinDate?: string | null;
  cycleName: string;
  cycleType: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  reviewerName?: string;
  reviewerRole?: string;
  overallScore: number;
  performanceBand: string;
  outcome?: string | null;
  compositeScore?: number | null;
  hikeRecommendation: { min: number; max: number; label: string };
  managerComments?: string;
  recommendation?: string;
  kraRatings?: { kraName?: string; rating?: number; comments?: string }[];
  behavioralRatings?: Record<string, number>;
  selfReflection?: Reflection;
  generatedAt: string;
  reviewId: string;
};

/** A primary the active panel asks the title row to show (one blue on screen). */
export type PanelPrimary = { label: string; onClick: () => void; busy?: boolean; title?: string } | null;

// ── Confirm copy (pure, so every sentence has a test: cycle-copy.test.ts) ──

/** "1 person", "3 people". */
export function peopleCount(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/**
 * An audience label as it reads inside a sentence. The fixed words the
 * servers make ("Everyone", "Nobody", "3 people", the "Departments" style
 * fallbacks) are lowercased; a proper name (a department, an office, a tag)
 * keeps its own spelling, so "PC walk dept" never reads "pc walk dept".
 * The surveys pages share it.
 */
export function audienceInSentence(label: string | null | undefined): string | null {
  const l = (label ?? "").trim();
  if (!l) return null;
  if (/^(Everyone|Nobody|Departments|Offices|Tags|People|\d+ (person|people))$/.test(l)) return l.toLowerCase();
  return l;
}

/** What GET /api/reviews/[id]/launch answers: who a launch would ask. */
export type LaunchPreview = {
  count: number;
  audienceType: string;
  /** How many people a People cycle names (null for other audiences). */
  named: number | null;
  /** A Departments cycle's department names, as spelled (null otherwise). */
  covers: string | null;
  /** A manager's launch: only their own reporting line is ever asked. */
  clipped: boolean;
};

/**
 * Who a cycle covers, in words, from its own audience rather than from who
 * is looking: a manager's People cycle covers the people it names (the
 * ones in their line), never "the people who report to you".
 */
export function audiencePhrase(p: Pick<LaunchPreview, "audienceType" | "named" | "covers" | "clipped">): string {
  if (p.audienceType === "DEPARTMENTS") {
    return `the people in ${p.covers || "its departments"}${p.clipped ? " who are in your reporting line" : ""}`;
  }
  if (p.audienceType === "USERS") {
    const who = p.named === 1 ? "the person it names" : p.named ? `the ${p.named} people it names` : "the people it names";
    return `${who}${p.clipped ? ` who ${p.named === 1 ? "is" : "are"} in your reporting line` : ""}`;
  }
  return p.clipped ? "everyone in your reporting line" : "everyone in the company";
}

/** The Launch cycle confirm's body; null when nobody is covered (no Launch then). */
export function launchConfirmText(p: LaunchPreview): string | null {
  if (p.count <= 0) return null;
  return `This creates a review for ${peopleCount(p.count)} (${audiencePhrase(p)}) and emails each of them.`;
}

/**
 * What to say instead of a Launch confirm when a cycle covers nobody. A
 * cycle's audience is fixed once it is created, so the way on is a person
 * joining it, or Cancel cycle and a new one (never "change who it covers").
 */
export function launchNobodyText(p: Pick<LaunchPreview, "audienceType" | "named" | "covers" | "clipped">): string {
  return `Nobody active is covered (${audiencePhrase(p)}), so there is no one to launch it for yet. It can launch once someone active is in it, or cancel it and start a new cycle.`;
}

/**
 * The Start calibration confirm's body. Calibration closes self reviews
 * (review-cycle.ts subjectMayWrite: Active only), while a manager review
 * never submitted can still be submitted and a submitted one is frozen
 * (managerMayWrite). The old copy said "Anyone not done yet can still
 * submit", which was true for managers only, so an admin locked every
 * unsubmitted self review believing late people could still finish. A
 * review still Not started has neither a self review nor a manager review
 * in, so `total - selfDone` is exactly the people who lose theirs.
 */
export function calibrationConfirmText(stats: { total: number; selfDone: number; managerDone: number } | null | undefined): string {
  const managers = "Managers who have not submitted can still submit, but cannot change a review they already submitted.";
  if (!stats || stats.total <= 0) {
    return `Self reviews close now: anyone who has not submitted theirs cannot anymore. ${managers}`;
  }
  const selfLeft = Math.max(0, stats.total - stats.selfDone);
  const mgrLeft = Math.max(0, stats.total - stats.managerDone);
  const self = selfLeft > 0
    ? `Self reviews close now: ${peopleCount(selfLeft)} ${selfLeft === 1 ? "has" : "have"} not sent one and cannot anymore.`
    : "Every self review is in.";
  const mgr = mgrLeft > 0
    ? `${mgrLeft} manager ${mgrLeft === 1 ? "review is" : "reviews are"} still to come and can still be submitted, but a submitted one can no longer be changed.`
    : "Every manager review is in, and none can be changed after this.";
  return `${self} ${mgr}`;
}
