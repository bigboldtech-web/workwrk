// Expense detail — bespoke .expd layout. Server-rendered for fast first paint;
// approver actions live in ExpenseDecisionPanel (client). TagPicker drives
// cost-center / project rollups in Reports.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TagPicker } from "@/components/tags/tag-picker";
import { ExpenseDecisionPanel } from "./decision-panel";
import {
  ChevronLeft, Receipt, Calendar, User as UserIcon, CheckCircle2, XCircle,
  Send, Clock, Banknote, FileText, Image as ImageIcon, ExternalLink, Layers,
} from "lucide-react";

const CATEGORY_LABEL: Record<string, string> = {
  TRAVEL: "Travel", MEALS: "Meals", LODGING: "Lodging", TRANSPORT: "Transport",
  SUPPLIES: "Supplies", SUBSCRIPTION: "Subscription", EQUIPMENT: "Equipment",
  CLIENT_ENTERTAINMENT: "Client entertainment", TRAINING: "Training", OTHER: "Other",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved",
  REJECTED: "Rejected", REIMBURSED: "Reimbursed",
};
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "var(--os-c-indigo)", SUBMITTED: "var(--os-c-orange)",
  APPROVED: "var(--os-c-blue)", REJECTED: "var(--os-c-red)",
  REIMBURSED: "var(--os-c-green)",
};

const FLOW_ORDER = ["DRAFT", "SUBMITTED", "APPROVED", "REIMBURSED"];
function flowState(current: string, step: string): "past" | "current" | "future" {
  if (current === "REJECTED") {
    return step === "DRAFT" ? "past" : step === "SUBMITTED" ? "past" : "future";
  }
  const ci = FLOW_ORDER.indexOf(current);
  const si = FLOW_ORDER.indexOf(step);
  if (si < ci) return "past";
  if (si === ci) return "current";
  return "future";
}

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const MANAGER_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP",
  "DIRECTOR", "MANAGER", "TEAM_LEAD", "HR",
]);

export const dynamic = "force-dynamic";

export default async function ExpenseDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const userId = (session.user as { id: string }).id;
  const orgId = (session.user as { organizationId: string }).organizationId;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const isManager = MANAGER_LEVELS.has(accessLevel);

  const expense = await prisma.expense.findFirst({
    where: { id, organizationId: orgId },
    include: {
      reporter: { select: { id: true, firstName: true, lastName: true, email: true } },
      approver: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  if (!expense) notFound();

  const canSee =
    expense.reporterId === userId ||
    expense.approverId === userId ||
    isManager;
  if (!canSee) notFound();

  const isReporter = expense.reporterId === userId;
  const canDecide =
    isManager &&
    !isReporter &&
    (expense.status === "SUBMITTED" || expense.status === "APPROVED") &&
    (expense.approverId === null || expense.approverId === userId);

  const amount = Number(expense.amount);
  const statusColor = STATUS_COLOR[expense.status] ?? STATUS_COLOR.DRAFT;

  return (
    <div className="expd" style={{ ["--s-c" as unknown as string]: statusColor }}>
      <section className="expd__hero">
        <span className="expd__hero-accent" aria-hidden="true" />
        <Link href="/expenses" className="expd__back"><ChevronLeft /> All expenses</Link>
        <div className="expd__hero-main">
          <div className="expd__hero-l">
            <div className="expd__hero-meta">
              <span className="expd__hero-status"><Receipt /> {STATUS_LABEL[expense.status]}</span>
              <span className="expd__hero-cat">{CATEGORY_LABEL[expense.category] ?? expense.category}</span>
              <span className="expd__hero-date"><Calendar /> {new Date(expense.expenseDate).toLocaleDateString()}</span>
            </div>
            <h1 className="expd__hero-title">{expense.description}</h1>
            {expense.reporter && (
              <div className="expd__hero-reporter">
                <UserIcon /> Reported by {expense.reporter.firstName} {expense.reporter.lastName}
              </div>
            )}
          </div>
          <div className="expd__hero-r">
            <div className="expd__hero-amt">{fmtMoney(amount, expense.currency)}</div>
            <div className="expd__hero-amt-sub">amount claimed</div>
          </div>
        </div>
        <div className="expd__flow">
          {expense.status === "REJECTED" ? (
            <>
              <FlowStep label="Draft" state="past" />
              <FlowStep label="Submitted" state="past" />
              <FlowStep label="Rejected" state="current" color="var(--os-c-red)" />
            </>
          ) : (
            <>
              <FlowStep label="Draft" state={flowState(expense.status, "DRAFT")} color={STATUS_COLOR.DRAFT} />
              <FlowStep label="Submitted" state={flowState(expense.status, "SUBMITTED")} color={STATUS_COLOR.SUBMITTED} />
              <FlowStep label="Approved" state={flowState(expense.status, "APPROVED")} color={STATUS_COLOR.APPROVED} />
              <FlowStep label="Reimbursed" state={flowState(expense.status, "REIMBURSED")} color={STATUS_COLOR.REIMBURSED} last />
            </>
          )}
        </div>
      </section>

      {canDecide && (
        <section className="expd__decision">
          <ExpenseDecisionPanel expenseId={expense.id} status={expense.status} />
        </section>
      )}

      <div className="expd__grid">
        <section className="expd__card expd__card--span">
          <header className="expd__card-head">
            <h2><Layers /> Cost attribution</h2>
            <p>Tag with cost center, project, business unit, or region. Drives budget rollups in Reports.</p>
          </header>
          <div className="expd__card-body">
            <TagPicker
              entityType="EXPENSE"
              entityId={expense.id}
              canEdit={isReporter || isManager}
            />
          </div>
        </section>

        {expense.notes && (
          <section className="expd__card">
            <header className="expd__card-head">
              <h2><FileText /> Notes</h2>
            </header>
            <div className="expd__card-body">
              <p className="expd__notes">{expense.notes}</p>
            </div>
          </section>
        )}

        {expense.receiptUrl && (
          <section className="expd__card">
            <header className="expd__card-head">
              <h2><ImageIcon /> Receipt</h2>
            </header>
            <div className="expd__card-body">
              <a href={expense.receiptUrl} target="_blank" rel="noopener noreferrer" className="expd__receipt">
                <ImageIcon /> Open receipt <ExternalLink />
              </a>
            </div>
          </section>
        )}

        <section className="expd__card expd__card--span">
          <header className="expd__card-head">
            <h2><Clock /> Timeline</h2>
          </header>
          <div className="expd__card-body">
            <ul className="expd__timeline">
              <li className="expd__tl expd__tl--ok">
                <Clock />
                <div>
                  <strong>Created</strong>
                  <span>{new Date(expense.createdAt).toLocaleString()}</span>
                </div>
              </li>
              {expense.submittedAt && (
                <li className="expd__tl expd__tl--ok" style={{ ["--tl-c" as unknown as string]: STATUS_COLOR.SUBMITTED }}>
                  <Send />
                  <div>
                    <strong>Submitted for approval</strong>
                    <span>{new Date(expense.submittedAt).toLocaleString()}</span>
                  </div>
                </li>
              )}
              {expense.decisionAt && (expense.status === "APPROVED" || expense.status === "REJECTED" || expense.status === "REIMBURSED") && (
                <li
                  className={`expd__tl ${expense.status === "REJECTED" ? "expd__tl--bad" : "expd__tl--ok"}`}
                  style={{ ["--tl-c" as unknown as string]: expense.status === "REJECTED" ? STATUS_COLOR.REJECTED : STATUS_COLOR.APPROVED }}
                >
                  {expense.status === "REJECTED" ? <XCircle /> : <CheckCircle2 />}
                  <div>
                    <strong>
                      {expense.status === "REJECTED" ? "Rejected" : "Approved"}
                      {expense.approver && ` by ${expense.approver.firstName} ${expense.approver.lastName}`}
                    </strong>
                    <span>{new Date(expense.decisionAt).toLocaleString()}</span>
                  </div>
                </li>
              )}
              {expense.reimbursedAt && (
                <li className="expd__tl expd__tl--ok" style={{ ["--tl-c" as unknown as string]: STATUS_COLOR.REIMBURSED }}>
                  <Banknote />
                  <div>
                    <strong>Reimbursed</strong>
                    <span>{new Date(expense.reimbursedAt).toLocaleString()}</span>
                  </div>
                </li>
              )}
            </ul>
            {expense.decisionNote && (
              <blockquote className="expd__decision-note">&ldquo;{expense.decisionNote}&rdquo;</blockquote>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function FlowStep({ label, state, color, last }: { label: string; state: "past" | "current" | "future"; color?: string; last?: boolean }) {
  return (
    <div className={`expd__flow-step expd__flow-step--${state}${last ? " is-last" : ""}`} style={color ? { ["--st-c" as unknown as string]: color } : undefined}>
      <span className="expd__flow-dot" />
      <span className="expd__flow-label">{label}</span>
      {!last && <span className="expd__flow-line" />}
    </div>
  );
}
