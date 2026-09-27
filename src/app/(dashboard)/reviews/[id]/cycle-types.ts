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
  viewer: { canManage: boolean; peopleTeamOrAdmin: boolean; isSubject: boolean; isReviewer: boolean; isPeer: boolean; inChain: boolean };
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
