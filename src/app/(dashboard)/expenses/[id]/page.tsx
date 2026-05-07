// Expense detail. Server-rendered for fast first paint with inline
// approve/reject for the assigned approver. Cost-center / project
// tagging via the polymorphic TagPicker — the same component on User
// detail, future Tasks, future Compensation, etc. Tags drive
// downstream financial reporting.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TagPicker } from "@/components/tags/tag-picker";
import { ExpenseDecisionPanel } from "./decision-panel";
import {
  ChevronLeft,
  Receipt,
  Calendar,
  User as UserIcon,
  CheckCircle2,
  XCircle,
  Send,
  Clock,
} from "lucide-react";

const CATEGORY_LABEL: Record<string, string> = {
  TRAVEL: "Travel",
  MEALS: "Meals",
  LODGING: "Lodging",
  TRANSPORT: "Transport",
  SUPPLIES: "Supplies",
  SUBSCRIPTION: "Subscription",
  EQUIPMENT: "Equipment",
  CLIENT_ENTERTAINMENT: "Client entertainment",
  TRAINING: "Training",
  OTHER: "Other",
};

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "text-muted border-white/20" },
  SUBMITTED: { label: "Submitted", className: "text-blue-400 border-blue-400/30" },
  APPROVED: { label: "Approved", className: "text-green-400 border-green-400/30" },
  REJECTED: { label: "Rejected", className: "text-red-400 border-red-400/30" },
  REIMBURSED: { label: "Reimbursed", className: "text-[#d4ff2e] border-[#d4ff2e]/30" },
};

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const MANAGER_LEVELS = new Set([
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "C_LEVEL",
  "VP",
  "DIRECTOR",
  "MANAGER",
  "TEAM_LEAD",
  "HR",
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

  const style = STATUS_STYLE[expense.status] ?? STATUS_STYLE.DRAFT;
  const amount = Number(expense.amount);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/expenses"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg transition-colors mb-3"
        >
          <ChevronLeft size={12} /> Back to expenses
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Receipt size={20} />
              <h1 className="text-2xl font-bold tracking-tight">{expense.description}</h1>
              <Badge variant="outline" className={`text-[10px] ${style.className}`}>
                {style.label}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted mt-2">
              <span>{CATEGORY_LABEL[expense.category]}</span>
              <span className="flex items-center gap-1">
                <Calendar size={11} /> {new Date(expense.expenseDate).toLocaleDateString()}
              </span>
              {expense.reporter && (
                <span className="flex items-center gap-1">
                  <UserIcon size={11} /> {expense.reporter.firstName} {expense.reporter.lastName}
                </span>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-3xl font-bold font-mono">{fmtMoney(amount, expense.currency)}</div>
            <div className="text-xs text-muted">amount claimed</div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Cost attribution</CardTitle>
          <p className="text-xs text-muted mt-1">
            Tag this expense with cost center, project, business unit, or
            region. Drives budget rollups in Reports.
          </p>
        </CardHeader>
        <CardContent>
          <TagPicker
            entityType="EXPENSE"
            entityId={expense.id}
            canEdit={isReporter || isManager}
          />
        </CardContent>
      </Card>

      {expense.notes && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{expense.notes}</p>
          </CardContent>
        </Card>
      )}

      {expense.receiptUrl && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Receipt</CardTitle>
          </CardHeader>
          <CardContent>
            <a
              href={expense.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#d4ff2e] hover:underline"
            >
              Open receipt ↗
            </a>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-3">
              <Clock size={12} className="text-muted" />
              <span className="text-muted">Created</span>
              <span className="ml-auto text-xs text-muted">
                {new Date(expense.createdAt).toLocaleString()}
              </span>
            </li>
            {expense.submittedAt && (
              <li className="flex items-center gap-3">
                <Send size={12} className="text-blue-400" />
                <span>Submitted for approval</span>
                <span className="ml-auto text-xs text-muted">
                  {new Date(expense.submittedAt).toLocaleString()}
                </span>
              </li>
            )}
            {expense.decisionAt && (expense.status === "APPROVED" || expense.status === "REJECTED" || expense.status === "REIMBURSED") && (
              <li className="flex items-center gap-3">
                {expense.status === "REJECTED" ? (
                  <XCircle size={12} className="text-red-400" />
                ) : (
                  <CheckCircle2 size={12} className="text-green-400" />
                )}
                <span>
                  {expense.status === "REJECTED" ? "Rejected" : "Approved"}
                  {expense.approver && ` by ${expense.approver.firstName} ${expense.approver.lastName}`}
                </span>
                <span className="ml-auto text-xs text-muted">
                  {new Date(expense.decisionAt).toLocaleString()}
                </span>
              </li>
            )}
            {expense.reimbursedAt && (
              <li className="flex items-center gap-3">
                <CheckCircle2 size={12} className="text-[#d4ff2e]" />
                <span>Reimbursed</span>
                <span className="ml-auto text-xs text-muted">
                  {new Date(expense.reimbursedAt).toLocaleString()}
                </span>
              </li>
            )}
          </ul>
          {expense.decisionNote && (
            <p className="text-xs text-muted italic mt-3">"{expense.decisionNote}"</p>
          )}
        </CardContent>
      </Card>

      {canDecide && (
        <ExpenseDecisionPanel
          expenseId={expense.id}
          status={expense.status}
        />
      )}
    </div>
  );
}
