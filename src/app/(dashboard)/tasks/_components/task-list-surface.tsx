"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  Activity,
  AlignLeft,
  ArrowRightLeft,
  BarChart3,
  Bot,
  Box,
  Brush,
  Calendar as CalendarIcon,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  Columns3,
  Layers,
  Download,
  Trash2,
  Info,
  ClipboardList,
  Copy,
  DollarSign,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Flag,
  GanttChart,
  GaugeCircle,
  GitBranch,
  Globe,
  Hash,
  LayoutGrid,
  Link2,
  List as ListIcon,
  ListFilter,
  Mail,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Search,
  Settings,
  Star,
  Table2,
  Tag,
  UserRound,
  Users,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

type ViewKind =
  | "list"
  | "board"
  | "calendar"
  | "gantt"
  | "doc"
  | "form"
  | "dashboard"
  | "table"
  | "whiteboard"
  | "timeline"
  | "activity"
  | "workload"
  | "mind-map"
  | "team"
  | "map"
  | "embed";

type GroupKey = "none" | "name" | "status" | "assignee" | "priority" | "tags" | "dueDate" | "taskType";
type PanelKey = "fields" | "customize" | null;
type FieldMode = "create" | "existing";
type TaskPriority = "" | "Urgent" | "High" | "Normal" | "Low";
type TaskOptionMenu = "type" | "assignee" | "date" | "priority" | "tags" | null;
type ChecklistItem = { id: string; label: string; done: boolean };
type TaskCellMenu = "status" | "assignee" | "date" | "priority" | "tags" | "type" | "custom" | null;
type TaskSortKey = "none" | "name" | "dueDate" | "dateCreated" | "priority";
type TaskSidePanel = "activity" | "related" | "links" | "fields" | "checklist" | null;

// Rule-based filtering (Filters popover). Each rule targets one field with
// an operator; rules combine with a single AND/OR connector.
type FilterField = "status" | "priority" | "dueDate" | "tags" | "assignee" | "taskType" | "dateCreated";
type FilterOperator = "is" | "isNot" | "contains" | "isSet" | "isNotSet" | "overdue";
type FilterConnector = "AND" | "OR";
interface FilterRule {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: string;
}
type GroupDir = "asc" | "desc";

interface ViewOptions {
  stackFields: boolean;
  showEmptyFields: boolean;
  collapseEmptyColumns: boolean;
  autosave: boolean;
  privateView: boolean;
  protectView: boolean;
  defaultView: boolean;
  showEmptyStatuses: boolean;
  wrapText: boolean;
  showTaskLocations: boolean;
  showSubtaskParentNames: boolean;
}

interface ViewDef {
  id: string;
  kind: ViewKind;
  label: string;
  tag?: string;
  Icon: LucideIcon;
  swatch: string;
  pinned?: boolean;
}

interface ColumnDef {
  key: string;
  label: string;
  Icon: LucideIcon;
  width: number;
  visible: boolean;
  custom?: boolean;
}

interface TaskItem {
  id: string;
  name: string;
  description?: string;
  status: "to_do" | "in_progress" | "complete";
  assignee: string;
  assigneeId?: string;
  dueDate: string;
  dueDateISO?: string;
  priority: TaskPriority;
  dateCreated: string;
  taskType: string;
  tags: string[];
  customFields?: Record<string, string>;
  subtaskCount: number;
  comments: number;
  attachments: number;
  parentId?: string;
}

interface TaskListSurfaceProps {
  initialAssignedOnly?: boolean;
  initialGroupBy?: GroupKey;
  initialSortKey?: TaskSortKey;
  initialVisibleColumns?: string[];
}

interface DraftTask {
  name: string;
  description?: string;
  status: TaskItem["status"];
  assignee: string;
  assigneeId?: string;
  dueDate: string;
  dueDateISO?: string;
  priority: TaskPriority;
  taskType: string;
  tags: string[];
  parentId?: string;
}

interface ApiTask {
  id: string;
  title: string;
  description?: string | null;
  date: string;
  createdAt?: string;
  status?: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  category?: string | null;
  parentTaskId?: string | null;
  assignee?: {
    id?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    avatar?: string | null;
  } | null;
  labels?: { label?: { name?: string | null } | null }[];
  _count?: { subTasks?: number; comments?: number };
  customFields?: Record<string, string | number | boolean | null>;
}

interface ApiLabel {
  id: string;
  name: string;
}

interface ApiCustomField {
  key: string;
  label: string;
  fieldType: string;
}

interface ApiPerson {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
}

interface ApiTaskComment {
  id: string;
  body: string;
  createdAt?: string;
  author?: {
    firstName?: string | null;
    lastName?: string | null;
    avatar?: string | null;
  } | null;
}

interface AssigneeOption {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  initials: string;
}

const INITIAL_VIEWS: ViewDef[] = [
  { id: "board", kind: "board", label: "Board", Icon: LayoutGrid, swatch: "#4F46E5", pinned: true },
  { id: "list", kind: "list", label: "List", Icon: ListIcon, swatch: "#71717A", pinned: true },
];

const VIEW_CATALOG: ViewDef[] = [
  { id: "view-list", kind: "list", label: "List", Icon: ListIcon, swatch: "#71717A" },
  { id: "view-gantt", kind: "gantt", label: "Gantt", tag: "Chart", Icon: GanttChart, swatch: "#EF4444" },
  { id: "view-calendar", kind: "calendar", label: "Calendar", Icon: CalendarIcon, swatch: "#F97316" },
  { id: "view-doc", kind: "doc", label: "Doc", tag: "Wiki", Icon: FileText, swatch: "#3B82F6" },
  { id: "view-board", kind: "board", label: "Board", tag: "Kanban", Icon: LayoutGrid, swatch: "#4F46E5" },
  { id: "view-form", kind: "form", label: "Form", tag: "Survey", Icon: CheckCircle2, swatch: "#8B5CF6" },
  { id: "view-ai", kind: "doc", label: "Create with AI", Icon: Bot, swatch: "#D946EF" },
  { id: "view-dashboard", kind: "dashboard", label: "Dashboard", tag: "Report", Icon: BarChart3, swatch: "#EC4899" },
  { id: "view-table", kind: "table", label: "Table", Icon: Table2, swatch: "#10B981" },
  { id: "view-whiteboard", kind: "whiteboard", label: "Whiteboard", Icon: Brush, swatch: "#FACC15" },
  { id: "view-timeline", kind: "timeline", label: "Timeline", Icon: AlignLeft, swatch: "#F97316" },
  { id: "view-activity", kind: "activity", label: "Activity", tag: "Feed", Icon: Activity, swatch: "#0EA5E9" },
  { id: "view-workload", kind: "workload", label: "Workload", tag: "Capacity", Icon: GaugeCircle, swatch: "#14B8A6" },
  { id: "view-mind-map", kind: "mind-map", label: "Mind Map", Icon: Workflow, swatch: "#EC4899" },
  { id: "view-team", kind: "team", label: "Team", Icon: Users, swatch: "#A855F7" },
  { id: "view-map", kind: "map", label: "Map", Icon: MapPin, swatch: "#EA580C" },
];

const EMBED_VIEWS: ViewDef[] = [
  { id: "embed-website", kind: "embed", label: "Any website", Icon: Globe, swatch: "#71717A" },
  { id: "embed-sheets", kind: "embed", label: "Google Sheets", Icon: FileSpreadsheet, swatch: "#10B981" },
  { id: "embed-docs", kind: "embed", label: "Google Docs", Icon: FileType, swatch: "#3B82F6" },
  { id: "embed-calendar", kind: "embed", label: "Google Calendar", Icon: CalendarIcon, swatch: "#F97316" },
  { id: "embed-maps", kind: "embed", label: "Google Maps", Icon: MapPin, swatch: "#EA580C" },
  { id: "embed-youtube", kind: "embed", label: "YouTube", Icon: FileImage, swatch: "#EF4444" },
  { id: "embed-figma", kind: "embed", label: "Figma", Icon: FileImage, swatch: "#A855F7" },
];

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name", Icon: ListIcon, width: 360, visible: true },
  { key: "assignee", label: "Assignee", Icon: UserRound, width: 120, visible: true },
  { key: "dueDate", label: "Due date", Icon: CalendarDays, width: 120, visible: true },
  { key: "priority", label: "Priority", Icon: Flag, width: 115, visible: true },
  { key: "dateCreated", label: "Date created", Icon: CalendarDays, width: 130, visible: true },
];

const OPTIONAL_FIELDS: ColumnDef[] = [
  { key: "assignedComments", label: "Assigned Comments", Icon: MessageSquare, width: 185, visible: false },
  { key: "comments", label: "Comments", Icon: MessageSquare, width: 130, visible: false },
  { key: "createdBy", label: "Created by", Icon: UserRound, width: 135, visible: false },
  { key: "customTaskId", label: "Custom Task ID", Icon: Hash, width: 155, visible: false },
  { key: "dateClosed", label: "Date closed", Icon: CalendarDays, width: 145, visible: false },
  { key: "dateDone", label: "Date done", Icon: CalendarDays, width: 140, visible: false },
  { key: "dateUpdated", label: "Date updated", Icon: CalendarDays, width: 155, visible: false },
  { key: "dependencies", label: "Dependencies", Icon: GitBranch, width: 160, visible: false },
  { key: "latestComment", label: "Latest comment", Icon: MessageSquare, width: 170, visible: false },
  { key: "linkedDocs", label: "Linked Docs", Icon: FileText, width: 145, visible: false },
  { key: "notes", label: "Notes", Icon: FileText, width: 150, visible: false },
  { key: "linkedTasks", label: "Linked tasks", Icon: Link2, width: 150, visible: false },
  { key: "lists", label: "Lists", Icon: ListIcon, width: 110, visible: false },
  { key: "pullRequests", label: "Pull Requests", Icon: GitBranch, width: 160, visible: false },
  { key: "startDate", label: "Start date", Icon: CalendarDays, width: 140, visible: false },
  { key: "status", label: "Status", Icon: Circle, width: 140, visible: false },
  { key: "tags", label: "Tags", Icon: Tag, width: 130, visible: false },
  { key: "taskId", label: "Task ID", Icon: Hash, width: 120, visible: false },
  { key: "taskType", label: "Task Type", Icon: Box, width: 145, visible: false },
  { key: "timeEstimate", label: "Time estimate", Icon: CalendarDays, width: 155, visible: false },
  { key: "timeTracked", label: "Time tracked", Icon: CalendarDays, width: 155, visible: false },
  { key: "timeline", label: "Timeline", Icon: AlignLeft, width: 140, visible: false },
];

const CREATE_FIELD_TYPES = [
  { label: "Completion Date", Icon: CalendarDays, color: "#A16207" },
  { label: "Motivation Level", Icon: GaugeCircle, color: "#A855F7" },
  { label: "Reflection Notes", Icon: AlignLeft, color: "#3B82F6" },
  { label: "Summary", Icon: Bot, color: "#A855F7" },
  { label: "Custom Text", Icon: FileText, color: "#A855F7" },
  { label: "Custom Dropdown", Icon: Columns3, color: "#A855F7" },
  { label: "Dropdown", Icon: Columns3, color: "#14B8A6" },
  { label: "Text", Icon: FileText, color: "#2563EB" },
  { label: "Date", Icon: CalendarDays, color: "#A16207" },
  { label: "Text area (Long Text)", Icon: AlignLeft, color: "#2563EB" },
  { label: "Number", Icon: Hash, color: "#059669" },
  { label: "Labels", Icon: Tag, color: "#10B981" },
  { label: "Checkbox", Icon: CheckCircle2, color: "#EC4899" },
  { label: "Money", Icon: DollarSign, color: "#059669" },
  { label: "Website", Icon: Globe, color: "#EF4444" },
  { label: "Formula", Icon: Bot, color: "#16A34A" },
  { label: "Files", Icon: Paperclip, color: "#EC4899" },
  { label: "Relationship", Icon: GitBranch, color: "#4F46E5" },
  { label: "People", Icon: UserRound, color: "#EF4444" },
  { label: "Progress (Auto)", Icon: Activity, color: "#A16207" },
  { label: "Email", Icon: Mail, color: "#EF4444" },
  { label: "Phone", Icon: Phone, color: "#EF4444" },
  { label: "Location", Icon: MapPin, color: "#EF4444" },
  { label: "Rating", Icon: Star, color: "#EF4444" },
];

const GROUP_OPTIONS: { key: GroupKey; label: string; Icon: LucideIcon }[] = [
  { key: "none", label: "None", Icon: CircleDashed },
  { key: "name", label: "Name", Icon: ListIcon },
  { key: "status", label: "Status", Icon: CheckCircle2 },
  { key: "assignee", label: "Assignee", Icon: UserRound },
  { key: "priority", label: "Priority", Icon: Flag },
  { key: "tags", label: "Tags", Icon: Tag },
  { key: "dueDate", label: "Due date", Icon: CalendarDays },
  { key: "taskType", label: "Task Type", Icon: Box },
];

const SORT_OPTIONS: { key: TaskSortKey; label: string; Icon: LucideIcon }[] = [
  { key: "none", label: "None", Icon: CircleDashed },
  { key: "name", label: "Name", Icon: ListIcon },
  { key: "dueDate", label: "Due date", Icon: CalendarDays },
  { key: "dateCreated", label: "Date created", Icon: CalendarDays },
  { key: "priority", label: "Priority", Icon: Flag },
];

// Filter field catalog for the Filters rule-builder. `valueKind` drives
// which value editor renders; `operators` limits the operator dropdown.
const FILTER_FIELDS: {
  key: FilterField;
  label: string;
  Icon: LucideIcon;
  operators: FilterOperator[];
  valueKind: "status" | "priority" | "text" | "none";
}[] = [
  { key: "status", label: "Status", Icon: CheckCircle2, operators: ["is", "isNot"], valueKind: "status" },
  { key: "priority", label: "Priority", Icon: Flag, operators: ["is", "isNot"], valueKind: "priority" },
  { key: "dueDate", label: "Due date", Icon: CalendarDays, operators: ["overdue", "isSet", "isNotSet"], valueKind: "none" },
  { key: "tags", label: "Tags", Icon: Tag, operators: ["contains"], valueKind: "text" },
  { key: "assignee", label: "Assignee", Icon: UserRound, operators: ["contains", "isSet", "isNotSet"], valueKind: "text" },
  { key: "taskType", label: "Task Type", Icon: Box, operators: ["contains"], valueKind: "text" },
  { key: "dateCreated", label: "Date created", Icon: CalendarDays, operators: ["contains"], valueKind: "text" },
];

const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  isNot: "is not",
  contains: "contains",
  isSet: "is set",
  isNotSet: "is not set",
  overdue: "is overdue",
};

/** Operators that don't need a value (the rule is complete without one). */
const VALUELESS_OPERATORS: FilterOperator[] = ["isSet", "isNotSet", "overdue"];

function filterFieldMeta(field: FilterField) {
  return FILTER_FIELDS.find((f) => f.key === field) ?? FILTER_FIELDS[0];
}

/** Does a single rule match a task? Incomplete rules (need a value, none set) match everything. */
function matchesFilterRule(task: TaskItem, rule: FilterRule): boolean {
  const needsValue = !VALUELESS_OPERATORS.includes(rule.operator);
  if (needsValue && !rule.value.trim()) return true; // ignore half-built rules
  const v = rule.value.trim().toLowerCase();
  switch (rule.field) {
    case "status":
      return rule.operator === "isNot" ? task.status !== rule.value : task.status === rule.value;
    case "priority":
      return rule.operator === "isNot" ? task.priority !== rule.value : task.priority === rule.value;
    case "tags":
      return task.tags.some((t) => t.toLowerCase().includes(v));
    case "assignee":
      if (rule.operator === "isSet") return Boolean(task.assignee);
      if (rule.operator === "isNotSet") return !task.assignee;
      return task.assignee.toLowerCase().includes(v);
    case "taskType":
      return task.taskType.toLowerCase().includes(v);
    case "dateCreated":
      return task.dateCreated.toLowerCase().includes(v);
    case "dueDate": {
      const hasDue = Boolean(task.dueDateISO || task.dueDate);
      if (rule.operator === "isSet") return hasDue;
      if (rule.operator === "isNotSet") return !hasDue;
      // overdue
      const due = task.dueDateISO ? new Date(task.dueDateISO) : null;
      return Boolean(due) && due!.getTime() < Date.now() && task.status !== "complete";
    }
    default:
      return true;
  }
}

const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  stackFields: false,
  showEmptyFields: true,
  collapseEmptyColumns: false,
  autosave: false,
  privateView: false,
  protectView: false,
  defaultView: false,
  showEmptyStatuses: false,
  wrapText: false,
  showTaskLocations: false,
  showSubtaskParentNames: false,
};

const STATUS_COLUMNS = [
  { key: "to_do" as const, label: "TO DO", color: "#71717A", bg: "#F4F4F5" },
  { key: "in_progress" as const, label: "IN PROGRESS", color: "#6D4AFF", bg: "#F5F2FF" },
  { key: "complete" as const, label: "COMPLETE", color: "#16A34A", bg: "#F0FDF4" },
];

export function TaskListSurface({
  initialAssignedOnly = false,
  initialGroupBy = "none",
  initialSortKey = "none",
  initialVisibleColumns,
}: TaskListSurfaceProps = {}) {
  const [views, setViews] = useState<ViewDef[]>(INITIAL_VIEWS);
  const [activeViewId, setActiveViewId] = useState("list");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [panel, setPanel] = useState<PanelKey>(null);
  const [fieldMode, setFieldMode] = useState<FieldMode>("existing");
  const [groupBy, setGroupBy] = useState<GroupKey>(initialGroupBy);
  const [subtasksCollapsed, setSubtasksCollapsed] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    if (!initialVisibleColumns) return [...DEFAULT_COLUMNS, ...OPTIONAL_FIELDS];
    const visibleKeys = new Set(["name", ...initialVisibleColumns]);
    return [...DEFAULT_COLUMNS, ...OPTIONAL_FIELDS].map((column) => ({
      ...column,
      visible: visibleKeys.has(column.key),
    }));
  });
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [draftTask, setDraftTask] = useState<DraftTask | null>(null);
  const [openDraftMenu, setOpenDraftMenu] = useState<TaskOptionMenu>(null);
  const [pinNewView, setPinNewView] = useState(false);
  const [privateNewView, setPrivateNewView] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(true);
  const [assignedOnly] = useState(initialAssignedOnly);
  const [sortKey, setSortKey] = useState<TaskSortKey>(initialSortKey);
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [filterConnector, setFilterConnector] = useState<FilterConnector>("AND");
  const [groupDir, setGroupDir] = useState<GroupDir>("asc");
  const [alsoGroupByList, setAlsoGroupByList] = useState(false);
  const [viewOptions, setViewOptions] = useState<ViewOptions>(DEFAULT_VIEW_OPTIONS);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);

  const visibleViews = useMemo(() => dedupeViews(views), [views]);
  const activeView = visibleViews.find((view) => view.id === activeViewId) ?? visibleViews[0];
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) ?? null : null;
  const visibleColumns = columns.filter((column) => column.visible);
  const tableColumns = visibleColumns.filter((column) => column.key !== "name");
  const tableTemplate = useMemo(() => {
    const trailing = tableColumns.map((column) => `minmax(${column.width}px, ${column.width}px)`).join(" ");
    return `minmax(300px,1fr) ${trailing} 36px`;
  }, [tableColumns]);
  const assigneeOptions = useMemo(() => {
    const byId = new Map<string, AssigneeOption>();
    assignees.forEach((assignee) => byId.set(assignee.id, assignee));
    tasks.forEach((task) => {
      if (!task.assigneeId || byId.has(task.assigneeId)) return;
      byId.set(task.assigneeId, {
        id: task.assigneeId,
        name: task.assignee || "Unassigned",
        initials: initialsFromName(task.assignee || "Unassigned"),
      });
    });
    return Array.from(byId.values()).sort((first, second) => first.name.localeCompare(second.name));
  }, [assignees, tasks]);

  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      setTasksLoading(true);
      setTaskError(null);
      try {
        const response = await fetch("/api/tasks", { cache: "no-store" });
        if (!response.ok) throw new Error(await readApiError(response, "Failed to load tasks"));
        const data = (await response.json()) as ApiTask[];
        if (!cancelled) setTasks(data.map(mapApiTaskToTaskItem));
      } catch (error) {
        if (!cancelled) setTaskError(error instanceof Error ? error.message : "Failed to load tasks");
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    }

    void loadTasks();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAssignees() {
      try {
        const response = await fetch("/api/v1/people?limit=100", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { data?: ApiPerson[] };
        if (cancelled || !Array.isArray(data.data)) return;
        setAssignees(data.data.map(mapApiPersonToAssigneeOption).filter(Boolean));
      } catch {
      }
    }

    void loadAssignees();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCustomFieldColumns() {
      try {
        const response = await fetch("/api/custom-fields/values?entityType=TASK", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { fields?: ApiCustomField[] };
        if (cancelled || !Array.isArray(data.fields)) return;
        const fields = data.fields;
        setColumns((current) => {
          const existingKeys = new Set(current.map((column) => column.key));
          const additions = fields
            .filter((field) => !existingKeys.has(field.key))
            .map((field) => ({
              key: field.key,
              label: field.label,
              Icon: customFieldIcon(field.fieldType),
              width: 170,
              visible: true,
              custom: true,
            }));
          return additions.length > 0 ? [...current, ...additions] : current;
        });
      } catch {
      }
    }

    void loadCustomFieldColumns();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTasks = useMemo(() => {
    const query = taskQuery.trim().toLowerCase();
    const next = tasks.filter((task) => {
      if (!showClosed && task.status === "complete") return false;
      if (assignedOnly && !task.assignee) return false;
      if (query) {
        const matchesQuery = [
          task.name,
          task.assignee,
          task.dueDate,
          task.priority,
          task.taskType,
          task.tags.join(" "),
        ].some((value) => value.toLowerCase().includes(query));
        if (!matchesQuery) return false;
      }
      // Rule-based filters combine with the chosen AND/OR connector.
      if (filters.length > 0) {
        const results = filters.map((rule) => matchesFilterRule(task, rule));
        const pass = filterConnector === "OR" ? results.some(Boolean) : results.every(Boolean);
        if (!pass) return false;
      }
      return true;
    });

    return sortTasks(next, sortKey);
  }, [assignedOnly, showClosed, sortKey, taskQuery, tasks, filters, filterConnector]);

  const displayTasks = useMemo(
    () => filteredTasks.filter((task) => !subtasksCollapsed || !task.parentId),
    [filteredTasks, subtasksCollapsed],
  );

  const groupedTasks = useMemo(() => {
    if (groupBy === "none") return [];
    const groups = new Map<string, TaskItem[]>();
    const labels = groupBy === "status"
      ? STATUS_COLUMNS.map((status) => status.label)
      : groupBy === "dueDate"
        ? ["Overdue", "Today", "Tomorrow", "Upcoming", "No due date"]
        : [];
    labels.forEach((label) => groups.set(label, []));
    displayTasks.forEach((task) => {
      const label = getGroupLabel(task, groupBy);
      groups.set(label, [...(groups.get(label) ?? []), task]);
    });
    let result = Array.from(groups.entries())
      .filter(([, items]) => groupBy !== "dueDate" || items.length > 0)
      .map(([label, items]) => ({ label, items }));
    // Group sort direction (the Group-by popover's Ascending/Descending).
    if (groupDir === "desc") result = result.reverse();
    // "Also group by List" — without a list/board field on tasks we can't
    // build true nested sub-groups, so we cluster items by task type within
    // each group as the closest available secondary key.
    if (alsoGroupByList) {
      result = result.map((g) => ({
        ...g,
        items: [...g.items].sort((a, b) => a.taskType.localeCompare(b.taskType)),
      }));
    }
    return result;
  }, [displayTasks, groupBy, groupDir, alsoGroupByList]);

  const ensureLabelIds = async (tagNames: string[]) => {
    const uniqueTags = Array.from(new Set(tagNames.map((tag) => tag.trim()).filter(Boolean)));
    if (uniqueTags.length === 0) return undefined;

    try {
      const labelsResponse = await fetch("/api/labels", { cache: "no-store" });
      const labels = labelsResponse.ok ? ((await labelsResponse.json()) as ApiLabel[]) : [];
      const existingLabels = new Map(labels.map((label) => [label.name.toLowerCase(), label.id]));
      const labelIds: string[] = [];

      for (const tag of uniqueTags) {
        const existingId = existingLabels.get(tag.toLowerCase());
        if (existingId) {
          labelIds.push(existingId);
          continue;
        }

        const createResponse = await fetch("/api/labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: tag }),
        });
        if (!createResponse.ok) continue;
        const createdLabel = (await createResponse.json()) as ApiLabel;
        labelIds.push(createdLabel.id);
      }

      return labelIds.length > 0 ? labelIds : undefined;
    } catch {
      return undefined;
    }
  };

  const persistTask = async (taskDraft: DraftTask, fallbackName: string) => {
    const labelIds = await ensureLabelIds(taskDraft.tags);
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: taskDraft.name.trim() || fallbackName,
        description: taskDraft.description?.trim() || undefined,
        date: taskDraft.dueDateISO ?? formatDateInput(new Date()),
        status: uiStatusToApiStatus(taskDraft.status),
        priority: uiPriorityToApiPriority(taskDraft.priority),
        category: taskDraft.taskType || (taskDraft.parentId ? "Subtask" : "Task"),
        assigneeId: taskDraft.assigneeId,
        parentTaskId: taskDraft.parentId,
        labelIds,
      }),
    });

    if (!response.ok) throw new Error(await readApiError(response, "Failed to create task"));
    return mapApiTaskToTaskItem((await response.json()) as ApiTask);
  };

  const startDraftTask = (status: TaskItem["status"] = "to_do", parentId?: string) => {
    if (parentId) setSubtasksCollapsed(false);
    setDraftTask({
      name: "",
      status,
      assignee: "",
      dueDate: "",
      priority: "",
      taskType: parentId ? "Subtask" : "Task",
      tags: [],
      parentId,
    });
    setOpenDraftMenu(null);
  };

  const updateDraftTask = (patch: Partial<DraftTask>) => {
    setDraftTask((current) => (current ? { ...current, ...patch } : current));
  };

  const saveDraftTask = async () => {
    if (!draftTask || savingTask) return;
    const count = tasks.length + 1;
    setSavingTask(true);
    setTaskError(null);
    try {
      const createdTask = await persistTask(
        draftTask,
        draftTask.parentId ? `New subtask ${count}` : `New task ${count}`,
      );
      setTasks((current) => [
        ...current,
        {
          ...createdTask,
          assignee: draftTask.assignee || createdTask.assignee,
          assigneeId: draftTask.assigneeId || createdTask.assigneeId,
          dueDate: draftTask.dueDate,
          priority: draftTask.priority || createdTask.priority,
          tags: createdTask.tags.length > 0 ? createdTask.tags : draftTask.tags,
        },
      ]);
      setDraftTask(null);
      setOpenDraftMenu(null);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setSavingTask(false);
    }
  };

  const toggleColumn = (key: string) => {
    setColumns((current) =>
      current.map((column) => (
        column.key === key && column.key !== "name"
          ? { ...column, visible: !column.visible }
          : column
      )),
    );
  };

  const createColumn = async (label: string) => {
    let key = makeCustomFieldKey(label);
    let persisted = false;
    let persistenceWarning: string | null = null;
    setTaskError(null);

    try {
      const response = await fetch("/api/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "TASK",
          key,
          label,
          fieldType: customFieldTypeForLabel(label),
        }),
      });

      if (response.ok) {
        const definition = (await response.json()) as { key?: string; label?: string };
        key = definition.key || key;
        persisted = true;
      } else if (response.status === 409) {
        persisted = true;
      } else if (response.status !== 403) {
        throw new Error(await readApiError(response, "Failed to create custom field"));
      } else {
        persistenceWarning = "Custom field added to this view. Admin permission is required to persist new workspace fields.";
      }
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Failed to create custom field");
    }

    setColumns((current) => [
      ...current.filter((column) => column.key !== key),
      { key, label, Icon: customFieldIcon(customFieldTypeForLabel(label)), width: 170, visible: true, custom: true },
    ]);
    if (!persisted && persistenceWarning) {
      setTaskError(persistenceWarning);
    }
    setPanel("fields");
    setFieldMode("existing");
  };

  const createView = (view: ViewDef) => {
    const existing = views.find((item) => viewSignature(item) === viewSignature(view));
    if (existing) {
      setActiveViewId(existing.id);
    } else {
      const nextView = {
        ...view,
        id: `${view.kind}-${Date.now()}`,
        pinned: pinNewView,
      };
      setViews((current) => [...current, nextView]);
      setActiveViewId(nextView.id);
    }
    setViewMenuOpen(false);
  };

  const toggleViewPin = (viewId: string) => {
    setViews((current) => current.map((view) => (view.id === viewId ? { ...view, pinned: !view.pinned } : view)));
  };

  const toggleGroup = (label: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const updateTask = async (taskId: string, patch: Partial<TaskItem>) => {
    const previousTasks = tasks;
    const customFieldPatch = patch.customFields;
    setTasks((current) => current.map((task) => (
      task.id === taskId
        ? {
            ...task,
            ...patch,
            customFields: customFieldPatch
              ? mergeCustomFields(task.customFields, customFieldPatch)
              : task.customFields,
          }
        : task
    )));

    const body: Record<string, unknown> = { id: taskId };
    if (patch.name !== undefined) body.title = patch.name;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.status !== undefined) body.status = uiStatusToApiStatus(patch.status);
    if (patch.priority !== undefined) body.priority = patch.priority ? uiPriorityToApiPriority(patch.priority) : null;
    if (patch.assigneeId !== undefined) body.assigneeId = patch.assigneeId || null;
    if (patch.dueDateISO !== undefined) body.date = patch.dueDateISO;
    else if (patch.dueDate !== undefined) {
      const dateInput = displayDateToInputDate(patch.dueDate);
      if (dateInput) body.date = dateInput;
    }
    if (patch.taskType !== undefined) body.category = patch.taskType;
    if (patch.tags !== undefined) body.labelIds = await ensureLabelIds(patch.tags) ?? [];

    try {
      let savedTask: TaskItem | null = null;
      if (Object.keys(body).length > 1) {
        const response = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(await readApiError(response, "Failed to update task"));
        savedTask = mapApiTaskToTaskItem((await response.json()) as ApiTask);
      }

      if (customFieldPatch) {
        const response = await fetch("/api/custom-fields/values", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "TASK", entityId: taskId, values: customFieldPatch }),
        });
        if (!response.ok) throw new Error(await readApiError(response, "Failed to update custom field"));
      }

      if (savedTask) {
        setTasks((current) => current.map((task) => (
          task.id === taskId
            ? { ...task, ...savedTask, customFields: task.customFields }
            : task
        )));
      }
    } catch (error) {
      setTasks(previousTasks);
      setTaskError(error instanceof Error ? error.message : "Failed to update task");
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 bg-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-zinc-200 !px-4">
          {visibleViews.map((view) => (
            <ViewTabButton
              key={view.id}
              view={view}
              active={activeView.id === view.id}
              onClick={() => setActiveViewId(view.id)}
            />
          ))}
          <span className="mx-1 h-5 w-px bg-zinc-200" aria-hidden />
          <div className="relative">
            <button
              type="button"
              className={`inline-flex h-[26px] items-center gap-1 rounded-md !px-2 text-[12px] font-medium ${
                viewMenuOpen ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-100"
              }`}
              onClick={() => setViewMenuOpen((open) => !open)}
            >
              <Plus className="h-3.5 w-3.5" />
              View
            </button>
            {viewMenuOpen ? (
              <ViewCreatePanel
                onCreate={createView}
                privateView={privateNewView}
                pinView={pinNewView}
                onPrivateChange={setPrivateNewView}
                onPinChange={setPinNewView}
                onClose={() => setViewMenuOpen(false)}
              />
            ) : null}
          </div>
        </div>

        <div className="flex h-8 shrink-0 items-center justify-between border-b border-zinc-100 !px-4">
          <div className="flex items-center gap-1.5 text-zinc-500">
            <div className="relative">
              <button
                type="button"
                className={`inline-flex h-6 items-center gap-1.5 rounded-full !px-2.5 text-[11px] font-medium ${
                  groupMenuOpen || groupBy !== "none"
                    ? "border border-[color-mix(in_srgb,var(--os-brand-rail)_18%,transparent)] bg-[color-mix(in_srgb,var(--os-brand-rail)_9%,white)] text-[var(--os-brand-rail)]"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
                onClick={() => setGroupMenuOpen((open) => !open)}
              >
                <Layers className="h-3 w-3" />
                {groupBy === "none" ? "Group" : getGroupName(groupBy)}
              </button>
              {groupMenuOpen ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setGroupMenuOpen(false)} />
                  <GroupMenu
                    value={groupBy}
                    direction={groupDir}
                    alsoGroupByList={alsoGroupByList}
                    onChange={(nextGroup) => {
                      setGroupBy(nextGroup);
                      setCollapsedGroups(new Set());
                    }}
                    onDirectionChange={setGroupDir}
                    onAlsoGroupByListChange={setAlsoGroupByList}
                    onClear={() => {
                      setGroupBy("none");
                      setCollapsedGroups(new Set());
                      setGroupMenuOpen(false);
                    }}
                    onClose={() => setGroupMenuOpen(false)}
                  />
                </>
              ) : null}
            </div>
            <ToolbarIconButton
              Icon={GitBranch}
              label={subtasksCollapsed ? "Subtasks: Collapsed" : "Subtasks: Expanded"}
              active={!subtasksCollapsed}
              onClick={() => setSubtasksCollapsed((collapsed) => !collapsed)}
            />
          </div>

          <div className="flex items-center gap-1.5 text-zinc-500">
            <div className="relative">
              <ToolbarIconButton
                Icon={ListFilter}
                label="Filter"
                active={filterMenuOpen || filters.length > 0}
                onClick={() => setFilterMenuOpen((open) => !open)}
              />
              {filterMenuOpen ? (
                <FilterMenu
                  filters={filters}
                  connector={filterConnector}
                  sortKey={sortKey}
                  onFiltersChange={setFilters}
                  onConnectorChange={setFilterConnector}
                  onSortChange={setSortKey}
                  onClose={() => setFilterMenuOpen(false)}
                />
              ) : null}
            </div>
            <ToolbarIconButton
              Icon={CheckCircle2}
              label={showClosed ? "Hide closed tasks" : "Show closed tasks"}
              active={showClosed}
              onClick={() => setShowClosed((shown) => !shown)}
            />
            {searchOpen ? (
              <div className="flex h-6 items-center gap-1 rounded-md border border-zinc-200 bg-white !px-1.5">
                <Search className="h-3.5 w-3.5 text-zinc-400" />
                <input
                  value={taskQuery}
                  onChange={(event) => setTaskQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setTaskQuery("");
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="Search tasks"
                  className="h-full w-36 bg-transparent text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400"
                  autoFocus
                />
                <button
                  type="button"
                  className="text-zinc-400 hover:text-zinc-700"
                  aria-label="Close search"
                  onClick={() => {
                    setTaskQuery("");
                    setSearchOpen(false);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <ToolbarIconButton Icon={Search} label="Search" active={taskQuery !== ""} onClick={() => setSearchOpen(true)} />
            )}
            <ToolbarIconButton
              Icon={Settings}
              label="Customize view"
              active={panel === "customize"}
              onClick={() => setPanel(panel === "customize" ? null : "customize")}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {activeView.kind === "list" || activeView.kind === "table" ? (
            <ListMode
              tasks={displayTasks}
              allTasks={filteredTasks}
              groupedTasks={groupedTasks}
              groupBy={groupBy}
              tableColumns={tableColumns}
              tableTemplate={tableTemplate}
              assigneeOptions={assigneeOptions}
              loading={tasksLoading}
              error={taskError}
              saving={savingTask}
              draftTask={draftTask}
              openDraftMenu={openDraftMenu}
              collapsedGroups={collapsedGroups}
              subtasksCollapsed={subtasksCollapsed}
              onToggleGroup={toggleGroup}
              onStartTask={startDraftTask}
              onDraftChange={updateDraftTask}
              onOpenDraftMenuChange={setOpenDraftMenu}
              onSaveDraft={saveDraftTask}
              onCancelDraft={() => {
                setDraftTask(null);
                setOpenDraftMenu(null);
              }}
              onTaskChange={updateTask}
              onOpenTask={(task) => setSelectedTaskId(task.id)}
              onToggleColumn={toggleColumn}
              onHideColumns={() => {
                setColumns((current) => current.map((column) => (
                  column.key === "name" ? column : { ...column, visible: false }
                )));
              }}
              onCreateColumn={createColumn}
            />
          ) : activeView.kind === "board" ? (
            <BoardMode
              tasks={displayTasks}
              draftTask={draftTask}
              saving={savingTask}
              onAddTask={startDraftTask}
              onDraftChange={updateDraftTask}
              onSaveDraft={saveDraftTask}
              onCancelDraft={() => {
                setDraftTask(null);
                setOpenDraftMenu(null);
              }}
              onTaskChange={updateTask}
              onOpenTask={(task) => setSelectedTaskId(task.id)}
              onCustomize={() => setPanel("customize")}
            />
          ) : activeView.kind === "calendar" ? (
            <CalendarMode tasks={displayTasks} activeView={activeView} onOpenTask={(task) => setSelectedTaskId(task.id)} />
          ) : activeView.kind === "gantt" || activeView.kind === "timeline" ? (
            <GanttMode tasks={displayTasks} activeView={activeView} onOpenTask={(task) => setSelectedTaskId(task.id)} />
          ) : activeView.kind === "doc" ? (
            <DocMode tasks={displayTasks} activeView={activeView} />
          ) : activeView.kind === "form" ? (
            <FormMode
              activeView={activeView}
              saving={savingTask}
              onCreateTask={async (formDraft) => {
                if (savingTask) return;
                setSavingTask(true);
                setTaskError(null);
                try {
                  const createdTask = await persistTask(formDraft, formDraft.name || `New task ${tasks.length + 1}`);
                  setTasks((current) => [
                    ...current,
                    {
                      ...createdTask,
                      assignee: formDraft.assignee || createdTask.assignee,
                      assigneeId: formDraft.assigneeId || createdTask.assigneeId,
                      dueDate: formDraft.dueDate || createdTask.dueDate,
                      dueDateISO: formDraft.dueDateISO ?? createdTask.dueDateISO,
                      priority: formDraft.priority || createdTask.priority,
                      tags: createdTask.tags.length > 0 ? createdTask.tags : formDraft.tags,
                    },
                  ]);
                } catch (error) {
                  setTaskError(error instanceof Error ? error.message : "Failed to create task");
                } finally {
                  setSavingTask(false);
                }
              }}
              assigneeOptions={assigneeOptions}
            />
          ) : (
            <PlaceholderMode activeView={activeView} tasks={displayTasks} onOpenTask={(task) => setSelectedTaskId(task.id)} />
          )}
        </div>
      </div>

      {panel === "fields" ? (
        <FieldsPanel
          columns={columns}
          fieldMode={fieldMode}
          onFieldModeChange={setFieldMode}
          onToggleColumn={toggleColumn}
          onHideColumns={() => {
            setColumns((current) => current.map((column) => (
              column.key === "name" ? column : { ...column, visible: false }
            )));
          }}
          onCreateColumn={createColumn}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel === "customize" ? (
        <CustomizePanel
          activeView={activeView}
          groupBy={groupBy}
          subtasksCollapsed={subtasksCollapsed}
          shownCount={visibleColumns.length}
          options={viewOptions}
          onToggleOption={(key) => setViewOptions((current) => ({ ...current, [key]: !current[key] }))}
          onTogglePin={() => toggleViewPin(activeView.id)}
          onOpenFilter={() => setFilterMenuOpen(true)}
          onOpenFields={() => {
            setPanel("fields");
            setFieldMode("existing");
          }}
          onOpenGroup={() => setGroupMenuOpen(true)}
          onToggleSubtasks={() => setSubtasksCollapsed((collapsed) => !collapsed)}
          showClosed={showClosed}
          onToggleClosed={() => setShowClosed((shown) => !shown)}
          onExport={() => {
            const header = ["Name", "Status", "Priority", "Due date", "Assignee"];
            const rows = filteredTasks.map((t) => [
              t.name, statusLabel(t.status), t.priority ?? "", t.dueDate ?? "", t.assignee ?? "",
            ]);
            const csv = [header, ...rows]
              .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
              .join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${activeView.label || "view"}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {selectedTask ? (
        <TaskDetailModal
          task={selectedTask}
          assigneeOptions={assigneeOptions}
          onClose={() => setSelectedTaskId(null)}
          onTaskChange={updateTask}
          onAddSubtask={(parentId) => {
            startDraftTask("to_do", parentId);
            setSelectedTaskId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ViewTabButton({ view, active, onClick }: { view: ViewDef; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`relative inline-flex h-full items-center gap-1.5 !px-1.5 text-[12px] font-medium ${
        active ? "text-zinc-900 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-zinc-900" : "text-zinc-600 hover:text-zinc-900"
      }`}
      onClick={onClick}
    >
      <view.Icon className="h-3.5 w-3.5" style={{ color: view.swatch }} />
      {view.label}
    </button>
  );
}

function ViewCreatePanel({
  onCreate,
  privateView,
  pinView,
  onPrivateChange,
  onPinChange,
  onClose,
}: {
  onCreate: (view: ViewDef) => void;
  privateView: boolean;
  pinView: boolean;
  onPrivateChange: (value: boolean) => void;
  onPinChange: (value: boolean) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredViews = filterViews(VIEW_CATALOG, query);
  const filteredEmbeds = filterViews(EMBED_VIEWS, query);

  return (
    <>
      <div className="fixed inset-0 z-[75]" onClick={onClose} aria-hidden />
      <div className="absolute left-0 top-8 z-[80] w-[360px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl">
        <div className="border-b border-zinc-100 !p-2">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search or describe a view to create"
            className="h-8 w-full rounded-md border border-[color-mix(in_srgb,var(--os-brand-rail)_35%,#e4e4e7)] bg-white !pl-3 !pr-8 text-[12px] outline-none focus:border-[var(--os-brand-rail)]"
            autoFocus
          />
          <button
            type="button"
            className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md bg-zinc-100 text-zinc-400"
            aria-label="Create view from prompt"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="max-h-[430px] overflow-y-auto !p-2">
        <PanelLabel>Popular</PanelLabel>
        <div className="grid grid-cols-2 gap-1">
          {filteredViews.slice(0, 8).map((view) => (
            <ViewCatalogItem key={view.id} view={view} onClick={() => onCreate(view)} />
          ))}
        </div>
        <div className="my-2 h-px bg-zinc-100" />
        <div className="grid grid-cols-2 gap-1">
          {filteredViews.slice(8).map((view) => (
            <ViewCatalogItem key={view.id} view={view} onClick={() => onCreate(view)} />
          ))}
        </div>
        <div className="my-2 h-px bg-zinc-100" />
        <div className="grid grid-cols-2 gap-1">
          {filteredEmbeds.map((view) => (
            <ViewCatalogItem key={view.id} view={view} onClick={() => onCreate(view)} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 border-t border-zinc-100 !px-2.5 py-1.5 text-[11px] text-zinc-600">
        <Checkbox checked={privateView} label="Private view" onChange={onPrivateChange} />
        <Checkbox checked={pinView} label="Pin view" onChange={onPinChange} />
      </div>
      </div>
    </>
  );
}

function ViewCatalogItem({ view, onClick }: { view: ViewDef; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex h-8 items-center gap-2 rounded-md !px-2 text-left text-[12px] text-zinc-800 hover:bg-zinc-100"
      onClick={onClick}
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-white" style={{ backgroundColor: view.swatch }}>
        <view.Icon className="h-3 w-3" />
      </span>
      <span className="truncate font-medium">{view.label}</span>
      {view.tag ? <span className="truncate text-zinc-500">{view.tag}</span> : null}
    </button>
  );
}

function ListMode({
  tasks,
  allTasks,
  groupedTasks,
  groupBy,
  tableColumns,
  tableTemplate,
  assigneeOptions,
  loading,
  error,
  saving,
  draftTask,
  openDraftMenu,
  collapsedGroups,
  subtasksCollapsed,
  onToggleGroup,
  onStartTask,
  onDraftChange,
  onOpenDraftMenuChange,
  onSaveDraft,
  onCancelDraft,
  onTaskChange,
  onOpenTask,
  onToggleColumn,
  onHideColumns,
  onCreateColumn,
}: {
  tasks: TaskItem[];
  allTasks: TaskItem[];
  groupedTasks: { label: string; items: TaskItem[] }[];
  groupBy: GroupKey;
  tableColumns: ColumnDef[];
  tableTemplate: string;
  assigneeOptions: AssigneeOption[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  draftTask: DraftTask | null;
  openDraftMenu: TaskOptionMenu;
  collapsedGroups: Set<string>;
  subtasksCollapsed: boolean;
  onToggleGroup: (label: string) => void;
  onStartTask: (status?: TaskItem["status"], parentId?: string) => void;
  onDraftChange: (patch: Partial<DraftTask>) => void;
  onOpenDraftMenuChange: (menu: TaskOptionMenu) => void;
  onSaveDraft: () => void | Promise<void>;
  onCancelDraft: () => void;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
  onOpenTask: (task: TaskItem) => void;
  onToggleColumn: (key: string) => void;
  onHideColumns: () => void;
  onCreateColumn: (label: string) => void;
}) {
  const [openGroupMenu, setOpenGroupMenu] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [openColumnMenu, setOpenColumnMenu] = useState(false);
  const [columnMenuMode, setColumnMenuMode] = useState<FieldMode>("create");
  
  const rootTasks = tasks.filter((task) => !task.parentId);
  const parentIds = new Set(rootTasks.map((task) => task.id));
  const orphanSubtasks = tasks.filter((task) => task.parentId && !parentIds.has(task.parentId));
  const draftRendersUnderParent = Boolean(draftTask?.parentId && parentIds.has(draftTask.parentId));

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const isTaskExpanded = (taskId: string) => !subtasksCollapsed || expandedTaskIds.has(taskId);

  const setTaskSelected = (taskId: string, selected: boolean) => {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (selected) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  };

  const selectTasks = (taskIds: string[]) => {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      taskIds.forEach((taskId) => next.add(taskId));
      return next;
    });
  };

  const renderCreateRow = (draft: DraftTask) => (
    <CreateTaskRow
      draftTask={draft}
      openMenu={openDraftMenu}
      onDraftChange={onDraftChange}
      onOpenMenuChange={onOpenDraftMenuChange}
      onSave={onSaveDraft}
      onCancel={onCancelDraft}
      saving={saving}
      tableTemplate={tableTemplate}
      assigneeOptions={assigneeOptions}
    />
  );

  return (
    <div className="min-w-[860px] !px-4 py-3">
      {error ? (
        <div className="mb-3 rounded-lg border border-red-100 bg-red-50 !px-3 py-2 text-[12px] font-medium text-red-700">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="mb-3 text-[12px] font-medium text-zinc-400">Loading tasks…</div>
      ) : null}
      {tasks.length > 0 ? (
        <div className="mb-2 text-[12px] font-medium text-zinc-500">
          {tasks.length} Task{tasks.length === 1 ? "" : "s"}
        </div>
      ) : null}
      <div
        className="grid h-8 items-center border-b border-zinc-200 text-[12px] font-medium text-zinc-500"
        style={{ gridTemplateColumns: tableTemplate }}
      >
        <span>Name</span>
        {tableColumns.map((column) => (
          <span key={column.key} className="truncate">{column.label}</span>
        ))}
        <span className="relative flex items-center justify-end">
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            title="Add a Column"
            aria-label="Add a Column"
            onClick={() => setOpenColumnMenu(true)}
          >
            <Plus className="h-4 w-4" />
          </button>
          {openColumnMenu ? (
            <ColumnMenuPopover
              columns={tableColumns}
              fieldMode={columnMenuMode}
              onFieldModeChange={setColumnMenuMode}
              onToggleColumn={onToggleColumn}
              onHideColumns={onHideColumns}
              onCreateColumn={onCreateColumn}
              onClose={() => setOpenColumnMenu(false)}
            />
          ) : null}
        </span>
      </div>

      {groupBy === "none" ? (
        <>
          {[...rootTasks, ...orphanSubtasks].map((task) => {
            const childTasks = allTasks.filter((candidate) => candidate.parentId === task.id);
            const expanded = isTaskExpanded(task.id);
            return (
              <Fragment key={task.id}>
                <TaskRow
                  task={task}
                  tableColumns={tableColumns}
                  tableTemplate={tableTemplate}
                  assigneeOptions={assigneeOptions}
                  selected={selectedTaskIds.has(task.id)}
                  expanded={expanded}
                  onToggleExpand={() => toggleTaskExpanded(task.id)}
                  onSelectedChange={(selected) => setTaskSelected(task.id, selected)}
                  onAddSubtask={() => {
                    if (!expanded) toggleTaskExpanded(task.id);
                    onStartTask(task.status, task.id);
                  }}
                  onTaskChange={onTaskChange}
                  onOpenTask={() => onOpenTask(task)}
                />
                {expanded && childTasks.map((childTask) => (
                  <TaskRow
                    key={childTask.id}
                    task={childTask}
                    tableColumns={tableColumns}
                    tableTemplate={tableTemplate}
                    assigneeOptions={assigneeOptions}
                    selected={selectedTaskIds.has(childTask.id)}
                    expanded={false}
                    onToggleExpand={() => toggleTaskExpanded(childTask.id)}
                    onSelectedChange={(selected) => setTaskSelected(childTask.id, selected)}
                    onAddSubtask={() => onStartTask(childTask.status, childTask.id)}
                    onTaskChange={onTaskChange}
                    onOpenTask={() => onOpenTask(childTask)}
                  />
                ))}
                {expanded && draftTask?.parentId === task.id ? renderCreateRow(draftTask) : null}
              </Fragment>
            );
          })}
          {draftTask && !draftRendersUnderParent ? renderCreateRow(draftTask) : null}
          <AddTaskRow tableTemplate={tableTemplate} onClick={() => onStartTask()} />
        </>
      ) : (
        <div className="space-y-5 pt-4">
          {groupedTasks.map((group) => {
            const collapsed = collapsedGroups.has(group.label);
            return (
              <section key={group.label} className="group/listgroup relative">
                <div className="mb-2 flex h-7 items-center gap-1.5">
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-2 rounded-md text-left text-[13px] font-medium text-zinc-700"
                    onClick={() => onToggleGroup(group.label)}
                  >
                    <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
                    <GroupBadge label={group.label} />
                    <span className="text-zinc-500">{group.items.length}</span>
                  </button>
                  <div className="relative opacity-0 transition-opacity group-hover/listgroup:opacity-100 group-focus-within/listgroup:opacity-100">
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 hover:text-zinc-900"
                      aria-label={`${group.label} group options`}
                      onClick={() => setOpenGroupMenu((current) => (current === group.label ? null : group.label))}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                    {openGroupMenu === group.label ? (
                      <GroupOptionsMenu
                        groupLabel={group.label}
                        groupName={getGroupName(groupBy).toLowerCase()}
                        onSelectAll={() => {
                          selectTasks(group.items.map((task) => task.id));
                          setOpenGroupMenu(null);
                        }}
                        onCollapseGroup={() => {
                          if (!collapsedGroups.has(group.label)) onToggleGroup(group.label);
                          setOpenGroupMenu(null);
                        }}
                        onCollapseAll={() => {
                          groupedTasks.forEach((item) => {
                            if (!collapsedGroups.has(item.label)) onToggleGroup(item.label);
                          });
                          setOpenGroupMenu(null);
                        }}
                        onClose={() => setOpenGroupMenu(null)}
                      />
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 opacity-0 hover:bg-zinc-100 hover:text-zinc-900 group-hover/listgroup:opacity-100"
                    aria-label={`Add task to ${group.label}`}
                    onClick={() => onStartTask(statusFromGroup(group.label))}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {!collapsed ? (
                  <>
                    <div
                      className="grid border-b border-zinc-100 pb-2 text-[12px] font-medium text-zinc-400"
                      style={{ gridTemplateColumns: tableTemplate }}
                    >
                      <span>Name</span>
                      {tableColumns.map((column) => (
                        <span key={column.key} className="truncate">{column.label}</span>
                      ))}
                      <span />
                    </div>
                    {group.items.map((task) => {
                      const childTasks = allTasks.filter((candidate) => candidate.parentId === task.id);
                      const expanded = isTaskExpanded(task.id);
                      return (
                        <Fragment key={task.id}>
                          <TaskRow
                            task={task}
                            tableColumns={tableColumns}
                            tableTemplate={tableTemplate}
                            assigneeOptions={assigneeOptions}
                            selected={selectedTaskIds.has(task.id)}
                            expanded={expanded}
                            onToggleExpand={() => toggleTaskExpanded(task.id)}
                            onSelectedChange={(selected) => setTaskSelected(task.id, selected)}
                            onAddSubtask={() => {
                              if (!expanded) toggleTaskExpanded(task.id);
                              onStartTask(task.status, task.id);
                            }}
                            onTaskChange={onTaskChange}
                            onOpenTask={() => onOpenTask(task)}
                          />
                          {expanded && childTasks.map((childTask) => (
                            <TaskRow
                              key={childTask.id}
                              task={childTask}
                              tableColumns={tableColumns}
                              tableTemplate={tableTemplate}
                              assigneeOptions={assigneeOptions}
                              selected={selectedTaskIds.has(childTask.id)}
                              expanded={false}
                              onToggleExpand={() => toggleTaskExpanded(childTask.id)}
                              onSelectedChange={(selected) => setTaskSelected(childTask.id, selected)}
                              onAddSubtask={() => onStartTask(childTask.status, childTask.id)}
                              onTaskChange={onTaskChange}
                              onOpenTask={() => onOpenTask(childTask)}
                            />
                          ))}
                          {expanded && draftTask?.parentId === task.id ? renderCreateRow(draftTask) : null}
                        </Fragment>
                      );
                    })}
                    {draftTask && !draftTask.parentId && shouldShowDraftInGroup(draftTask, groupBy, group.label) ? (
                      <CreateTaskRow
                        draftTask={draftTask}
                        openMenu={openDraftMenu}
                        onDraftChange={onDraftChange}
                        onOpenMenuChange={onOpenDraftMenuChange}
                        onSave={onSaveDraft}
                        onCancel={onCancelDraft}
                        saving={saving}
                        tableTemplate={tableTemplate}
                        assigneeOptions={assigneeOptions}
                      />
                    ) : null}
                    <AddTaskRow tableTemplate={tableTemplate} onClick={() => onStartTask(statusFromGroup(group.label))} />
                  </>
                ) : null}
              </section>
            );
          })}
          {groupedTasks.length === 0 || (draftTask && !groupedTasks.some((group) => shouldShowDraftInGroup(draftTask, groupBy, group.label))) ? (
            <section>
              {draftTask ? (
                <CreateTaskRow
                  draftTask={draftTask}
                  openMenu={openDraftMenu}
                  onDraftChange={onDraftChange}
                  onOpenMenuChange={onOpenDraftMenuChange}
                  onSave={onSaveDraft}
                  onCancel={onCancelDraft}
                  saving={saving}
                  tableTemplate={tableTemplate}
                  assigneeOptions={assigneeOptions}
                />
              ) : null}
              <AddTaskRow tableTemplate={tableTemplate} onClick={() => onStartTask()} />
            </section>
          ) : null}
        </div>
      )}
      {selectedTaskIds.size > 0 ? (
        <MultiSelectActionBar count={selectedTaskIds.size} onClear={() => setSelectedTaskIds(new Set())} />
      ) : null}
    </div>
  );
}

function CreateTaskRow({
  draftTask,
  openMenu,
  assigneeOptions,
  onDraftChange,
  onOpenMenuChange,
  onSave,
  onCancel,
  saving,
  tableTemplate,
}: {
  draftTask: DraftTask;
  openMenu: TaskOptionMenu;
  assigneeOptions: AssigneeOption[];
  onDraftChange: (patch: Partial<DraftTask>) => void;
  onOpenMenuChange: (menu: TaskOptionMenu) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  saving: boolean;
  tableTemplate: string;
}) {
  const [tagQuery, setTagQuery] = useState("");

  return (
    <div
      className="relative grid min-h-7 items-center border-b border-zinc-100 bg-white text-[12px]"
      style={{ gridTemplateColumns: tableTemplate }}
    >
      <span className="flex min-w-0 items-center gap-1.5 pr-2">
        <CircleDashed className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <input
          value={draftTask.name}
          onChange={(event) => onDraftChange({ name: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") void onSave();
            if (event.key === "Escape") onCancel();
          }}
          placeholder="Task Name or type '/' for commands"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-900 outline-none placeholder:text-zinc-400"
          autoFocus
        />
        <div className="relative flex shrink-0 items-center gap-0.5">
          <ComposerButton
            Icon={Box}
            label="Task type"
            text={draftTask.taskType || "Task"}
            active={openMenu === "type"}
            onClick={() => onOpenMenuChange(openMenu === "type" ? null : "type")}
          />
          <ComposerButton
            Icon={Users}
            label="Assign"
            active={openMenu === "assignee"}
            onClick={() => onOpenMenuChange(openMenu === "assignee" ? null : "assignee")}
          />
          <ComposerButton
            Icon={CalendarDays}
            label="Dates"
            active={openMenu === "date"}
            onClick={() => onOpenMenuChange(openMenu === "date" ? null : "date")}
          />
          <ComposerButton
            Icon={Flag}
            label="Priority"
            active={openMenu === "priority"}
            onClick={() => onOpenMenuChange(openMenu === "priority" ? null : "priority")}
          />
          <ComposerButton
            Icon={Tag}
            label="Tags"
            active={openMenu === "tags"}
            onClick={() => onOpenMenuChange(openMenu === "tags" ? null : "tags")}
          />
          <button
            type="button"
            className="ml-1 inline-flex h-6 items-center rounded-md !px-2 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex h-6 items-center rounded-md bg-[var(--os-brand-rail)] !px-2 text-[11px] font-medium text-white disabled:opacity-60"
            onClick={() => {
              void onSave();
            }}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save ↵"}
          </button>

          {openMenu === "type" ? (
            <TaskTypeMenu
              value={draftTask.taskType}
              onSelect={(taskType) => {
                onDraftChange({ taskType });
                onOpenMenuChange(null);
              }}
              onClose={() => onOpenMenuChange(null)}
            />
          ) : null}
          {openMenu === "assignee" ? (
            <AssigneeMenu
              options={assigneeOptions}
              onSelect={(assignee) => {
                onDraftChange({ assignee: assignee.name, assigneeId: assignee.id });
                onOpenMenuChange(null);
              }}
              onClose={() => onOpenMenuChange(null)}
            />
          ) : null}
          {openMenu === "date" ? (
            <DateMenu
              onSelect={(dueDate, dueDateISO) => {
                onDraftChange({ dueDate, dueDateISO });
                onOpenMenuChange(null);
              }}
              onClose={() => onOpenMenuChange(null)}
            />
          ) : null}
          {openMenu === "priority" ? (
            <PriorityMenu
              onSelect={(priority) => {
                onDraftChange({ priority });
                onOpenMenuChange(null);
              }}
              onClose={() => onOpenMenuChange(null)}
            />
          ) : null}
          {openMenu === "tags" ? (
            <TagsMenu
              query={tagQuery}
              onQueryChange={setTagQuery}
              onCreate={() => {
                const label = tagQuery.trim();
                if (!label) return;
                onDraftChange({ tags: [...draftTask.tags, label] });
                setTagQuery("");
                onOpenMenuChange(null);
              }}
              onClose={() => onOpenMenuChange(null)}
            />
          ) : null}
        </div>
      </span>
    </div>
  );
}

function TaskRow({
  task,
  tableColumns,
  tableTemplate,
  assigneeOptions,
  selected,
  expanded,
  onToggleExpand,
  onSelectedChange,
  onAddSubtask,
  onTaskChange,
  onOpenTask,
}: {
  task: TaskItem;
  tableColumns: ColumnDef[];
  tableTemplate: string;
  assigneeOptions: AssigneeOption[];
  selected: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onSelectedChange: (selected: boolean) => void;
  onAddSubtask: () => void;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
  onOpenTask: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(task.name);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");

  const commitRename = () => {
    const nextName = draftName.trim();
    if (!nextName) {
      setDraftName(task.name);
      setEditing(false);
      return;
    }
    if (nextName !== task.name) void onTaskChange(task.id, { name: nextName });
    setEditing(false);
  };

  const addTag = () => {
    const nextTag = tagQuery.trim();
    if (!nextTag) return;
    const existing = new Set(task.tags.map((tag) => tag.toLowerCase()));
    if (!existing.has(nextTag.toLowerCase())) {
      void onTaskChange(task.id, { tags: [...task.tags, nextTag] });
    }
    setTagQuery("");
    setTagMenuOpen(false);
  };

  return (
    <div
      className="group grid min-h-7 items-center border-b border-zinc-100 text-[12px] text-zinc-700 hover:bg-zinc-50"
      style={{ gridTemplateColumns: tableTemplate }}
    >
      <span className={`flex min-w-0 items-center gap-1.5 ${task.parentId ? "pl-7" : ""}`}>
        <span className="w-4 shrink-0 opacity-0 group-hover:opacity-100">
          <MoreHorizontal className="h-3.5 w-3.5 rotate-90 text-zinc-400" />
        </span>
        <button
          type="button"
          className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
            selected
              ? "border-[var(--os-brand-rail)] bg-[var(--os-brand-rail)] text-white opacity-100"
              : "border-zinc-300 bg-white opacity-0 group-hover:opacity-100"
          }`}
          aria-label={selected ? "Deselect task" : "Select task"}
          onClick={(event) => {
            event.stopPropagation();
            onSelectedChange(!selected);
          }}
        >
          {selected ? <Check className="h-3 w-3" /> : null}
        </button>
        {!task.parentId && task.subtaskCount > 0 ? (
          <button 
            type="button" 
            className={`inline-flex h-4 w-4 items-center justify-center rounded-sm hover:bg-zinc-200 transition-transform ${expanded ? "rotate-90" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
          >
            <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          className={`h-3.5 w-3.5 shrink-0 rounded-full ${
            task.status === "complete"
              ? "text-emerald-600"
              : "border-2 border-dashed border-zinc-400 hover:border-zinc-600"
          }`}
          aria-label={task.status === "complete" ? "Reopen task" : "Complete task"}
          onClick={() => void onTaskChange(task.id, { status: task.status === "complete" ? "to_do" : "complete" })}
        >
          {task.status === "complete" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
        </button>
        {editing ? (
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") {
                setDraftName(task.name);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded-sm bg-white text-[12px] font-medium text-zinc-900 outline-none ring-1 ring-[var(--os-brand-rail)]"
            autoFocus
          />
        ) : (
          <span 
            className="truncate text-left font-medium text-zinc-900 cursor-text hover:bg-zinc-100 rounded-sm px-1 -ml-1 transition-colors"
            onClick={() => {
              setDraftName(task.name);
              setEditing(true);
            }}
          >
            {task.name}
          </span>
        )}
        {task.subtaskCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <GitBranch className="h-3.5 w-3.5" />
            {task.subtaskCount}
          </span>
        ) : null}
        {task.attachments > 0 ? (
          <span className="inline-flex items-center gap-1 text-zinc-400 px-1 rounded-sm bg-zinc-100" title="Attachments">
            <Paperclip className="h-3 w-3" />
            <span className="h-3 w-3 rounded-sm bg-zinc-300 inline-block overflow-hidden relative">
              <FileImage className="h-4 w-4 text-zinc-500 absolute -top-0.5 -left-0.5 opacity-50" />
            </span>
          </span>
        ) : null}
        {!task.parentId ? (
          <span className="ml-2 hidden items-center gap-1 group-hover:inline-flex">
            <RowHoverButton Icon={MoreHorizontal} label="Open task" onClick={onOpenTask} />
            <RowHoverButton Icon={Plus} label="Add subtask" onClick={onAddSubtask} />
            <RowHoverButton Icon={FileText} label="Notes" onClick={onOpenTask} />
            <RowHoverButton Icon={MessageSquare} label="Comments" onClick={onOpenTask} />
            <span className="relative">
              <RowHoverButton Icon={Tag} label="Edit tags" onClick={() => setTagMenuOpen((open) => !open)} />
              {tagMenuOpen ? (
                <TagEditorPopover
                  tags={task.tags}
                  query={tagQuery}
                  onQueryChange={setTagQuery}
                  onCreate={addTag}
                  onRemove={(tag) => void onTaskChange(task.id, { tags: task.tags.filter((item) => item !== tag) })}
                  onClose={() => setTagMenuOpen(false)}
                />
              ) : null}
            </span>
          </span>
        ) : (
          <span className="ml-2 hidden items-center gap-1 group-hover:inline-flex">
            <RowHoverButton Icon={MoreHorizontal} label="Open task" onClick={onOpenTask} />
          </span>
        )}
      </span>
      {tableColumns.map((column) => (
        <TaskFieldCell
          key={column.key}
          task={task}
          column={column}
          assigneeOptions={assigneeOptions}
          onTaskChange={onTaskChange}
        />
      ))}
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center justify-self-end rounded-md text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100"
        aria-label="Task actions"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function TaskFieldCell({
  task,
  column,
  assigneeOptions,
  onTaskChange,
}: {
  task: TaskItem;
  column: ColumnDef;
  assigneeOptions: AssigneeOption[];
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
}) {
  const [openMenu, setOpenMenu] = useState<TaskCellMenu>(null);
  const [tagQuery, setTagQuery] = useState("");
  const [customDraft, setCustomDraft] = useState(task.customFields?.[column.key] ?? "");

  const buttonClass = "inline-flex h-6 max-w-full items-center gap-1.5 truncate rounded-md !px-1.5 text-left text-[12px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900";

  const addTag = () => {
    const nextTag = tagQuery.trim();
    if (!nextTag) return;
    const existingTags = new Set(task.tags.map((tag) => tag.toLowerCase()));
    if (!existingTags.has(nextTag.toLowerCase())) {
      void onTaskChange(task.id, { tags: [...task.tags, nextTag] });
    }
    setTagQuery("");
    setOpenMenu(null);
  };

  const saveCustomField = () => {
    const value = customDraft.trim();
    void onTaskChange(task.id, { customFields: { [column.key]: value } });
    setOpenMenu(null);
  };

  if (column.key === "dateCreated") {
    return <span className="truncate pr-3 text-[12px] text-zinc-600">{task.dateCreated}</span>;
  }

  if (column.custom || column.key === "notes" || column.key === "linkedDocs") {
    const value = task.customFields?.[column.key] ?? "";
    return (
      <span className="relative min-w-0 pr-3">
        <button
          type="button"
          className={`${buttonClass} ${value ? "" : "text-zinc-400 opacity-0 group-hover:opacity-100"}`}
          onClick={() => {
            setCustomDraft(value);
            setOpenMenu(openMenu === "custom" ? null : "custom");
          }}
        >
          {value || `Add ${column.label.toLowerCase()}`}
        </button>
        {openMenu === "custom" ? (
          <CustomFieldPopover
            label={column.label}
            value={customDraft}
            onChange={setCustomDraft}
            onSave={saveCustomField}
            onClear={() => {
              setCustomDraft("");
              void onTaskChange(task.id, { customFields: { [column.key]: "" } });
              setOpenMenu(null);
            }}
          />
        ) : null}
      </span>
    );
  }

  switch (column.key) {
    case "status": {
      const statusMeta = getStatusMeta(task.status);
      return (
        <span className="relative min-w-0 pr-3">
          <button
            type="button"
            className={buttonClass}
            onClick={() => setOpenMenu(openMenu === "status" ? null : "status")}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: statusMeta.color }} />
            <span className="truncate">{statusMeta.label}</span>
          </button>
          {openMenu === "status" ? (
            <StatusMenu
              onSelect={(status) => {
                void onTaskChange(task.id, { status });
                setOpenMenu(null);
              }}
              onClose={() => setOpenMenu(null)}
            />
          ) : null}
        </span>
      );
    }
    case "assignee":
      return (
        <span className="relative min-w-0 pr-3">
          <button
            type="button"
            className={`${buttonClass} ${task.assignee ? "" : "text-zinc-400 opacity-0 group-hover:opacity-100"}`}
            onClick={() => setOpenMenu(openMenu === "assignee" ? null : "assignee")}
          >
            <UserRound className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{task.assignee || "Assign"}</span>
          </button>
          {openMenu === "assignee" ? (
            <AssigneeMenu
              options={assigneeOptions}
              onSelect={(assignee) => {
                void onTaskChange(task.id, { assignee: assignee.name, assigneeId: assignee.id });
                setOpenMenu(null);
              }}
              onClose={() => setOpenMenu(null)}
            />
          ) : null}
        </span>
      );
    case "dueDate":
      return (
        <span className="relative min-w-0 pr-3">
          <button
            type="button"
            className={`${buttonClass} ${task.dueDate ? "text-red-500" : "text-zinc-400 opacity-0 group-hover:opacity-100"}`}
            onClick={() => setOpenMenu(openMenu === "date" ? null : "date")}
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{task.dueDate || "Set date"}</span>
          </button>
          {openMenu === "date" ? (
            <DateMenu
              onSelect={(dueDate, dueDateISO) => {
                void onTaskChange(task.id, { dueDate, dueDateISO });
                setOpenMenu(null);
              }}
              onClose={() => setOpenMenu(null)}
            />
          ) : null}
        </span>
      );
    case "priority":
      return (
        <span className="relative min-w-0 pr-3">
          <button
            type="button"
            className={`${buttonClass} ${task.priority ? "" : "text-zinc-400 opacity-0 group-hover:opacity-100"}`}
            onClick={() => setOpenMenu(openMenu === "priority" ? null : "priority")}
          >
            {task.priority ? (
              <PriorityBadge priority={task.priority} />
            ) : (
              <>
                <Flag className="h-3.5 w-3.5 shrink-0" />
                <span>Priority</span>
              </>
            )}
          </button>
          {openMenu === "priority" ? (
            <PriorityMenu
              onSelect={(priority) => {
                void onTaskChange(task.id, { priority });
                setOpenMenu(null);
              }}
              onClose={() => setOpenMenu(null)}
            />
          ) : null}
        </span>
      );
    case "tags":
      return (
        <span className="relative min-w-0 pr-3">
          <button
            type="button"
            className={`${buttonClass} ${task.tags.length ? "" : "text-zinc-400 opacity-0 group-hover:opacity-100"}`}
            onClick={() => setOpenMenu(openMenu === "tags" ? null : "tags")}
          >
            <Tag className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{task.tags.length ? task.tags.join(", ") : "Tags"}</span>
          </button>
          {openMenu === "tags" ? (
            <TagEditorPopover
              tags={task.tags}
              query={tagQuery}
              onQueryChange={setTagQuery}
              onCreate={addTag}
              onRemove={(tag) => void onTaskChange(task.id, { tags: task.tags.filter((item) => item !== tag) })}
              onClose={() => setOpenMenu(null)}
            />
          ) : null}
        </span>
      );
    case "taskType":
      return (
        <span className="relative min-w-0 pr-3">
          <button
            type="button"
            className={buttonClass}
            onClick={() => setOpenMenu(openMenu === "type" ? null : "type")}
          >
            <Box className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{task.taskType || "Task"}</span>
          </button>
          {openMenu === "type" ? (
            <TaskTypeMenu
              value={task.taskType || "Task"}
              onSelect={(taskType) => {
                void onTaskChange(task.id, { taskType });
                setOpenMenu(null);
              }}
              onClose={() => setOpenMenu(null)}
            />
          ) : null}
        </span>
      );
    default:
      return (
        <span className="truncate pr-3 text-[12px] text-zinc-600">
          {renderTaskValue(task, column)}
        </span>
      );
  }
}

function AddTaskRow({ tableTemplate, onClick }: { tableTemplate: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="grid min-h-7 w-full items-center border-b border-zinc-50 text-left text-[12px] text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
      style={{ gridTemplateColumns: tableTemplate }}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-2 pl-7">
        <Plus className="h-3.5 w-3.5" />
        Add Task
      </span>
      <span />
    </button>
  );
}

function ComposerButton({
  Icon,
  label,
  text,
  active,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  text?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex h-[22px] items-center justify-center gap-1 rounded-md border border-zinc-200 !px-1.5 text-[11px] shadow-sm ${
        active ? "bg-zinc-100 text-zinc-900" : "bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
      }`}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
      {text ? <span className="max-w-[70px] truncate">{text}</span> : null}
    </button>
  );
}

function RowHoverButton({
  Icon,
  label,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:bg-zinc-100 hover:text-zinc-900"
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function StatusMenu({ onSelect, onClose }: { onSelect: (value: TaskItem["status"]) => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[84]" onClick={onClose} aria-hidden />
      <DropdownPanel className="left-0 top-7 w-[170px] overflow-hidden !p-1.5">
        <PanelLabel>Status</PanelLabel>
        {STATUS_COLUMNS.map((status) => (
          <button
            key={status.key}
            type="button"
            className="flex h-7 w-full items-center gap-2 rounded-md !px-2 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
            onClick={() => onSelect(status.key)}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: status.color }} />
            {status.label}
          </button>
        ))}
      </DropdownPanel>
    </>
  );
}

function TaskTypeMenu({
  value,
  onSelect,
  onClose,
}: {
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const options = [
    { label: "Task", Icon: Circle },
    { label: "Milestone", Icon: Box },
    { label: "Form Response", Icon: ClipboardList },
    { label: "Meeting Note", Icon: MessageSquare },
  ];

  return (
    <>
      <div className="fixed inset-0 z-[84]" onClick={onClose} aria-hidden />
      <DropdownPanel className="left-0 top-7 w-[230px] !p-1.5">
        <PanelLabel>Create</PanelLabel>
        <div className="space-y-1">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              className={`flex h-7 w-full items-center gap-2 rounded-md !px-2 text-left text-[12px] ${
                value === option.label ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
              }`}
              onClick={() => onSelect(option.label)}
            >
              <option.Icon className="h-3.5 w-3.5 text-zinc-500" />
              <span className="flex-1">{option.label}</span>
              {value === option.label ? <Check className="h-4 w-4 text-[var(--os-brand-rail)]" /> : null}
            </button>
          ))}
        </div>
      </DropdownPanel>
    </>
  );
}

function AssigneeMenu({
  options,
  onSelect,
  onClose,
}: {
  options: AssigneeOption[];
  onSelect: (value: AssigneeOption) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = options.filter((option) => (
    !normalizedQuery
    || option.name.toLowerCase().includes(normalizedQuery)
    || option.email?.toLowerCase().includes(normalizedQuery)
  ));

  return (
    <>
      <div className="fixed inset-0 z-[84]" onClick={onClose} aria-hidden />
      <DropdownPanel className="left-0 top-7 w-[320px] overflow-hidden">
        <div className="flex h-9 items-center gap-2 border-b border-zinc-100 !px-2.5">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search or enter email..."
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-zinc-500"
            autoFocus
          />
        </div>
        <div className="!p-2.5">
          <PanelLabel>People</PanelLabel>
          <div className="max-h-44 overflow-y-auto">
            {filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className="mb-1 flex h-8 w-full items-center gap-2 rounded-md !px-2 text-left text-[12px] text-zinc-800 hover:bg-zinc-100"
                onClick={() => onSelect(option)}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--os-brand-rail)] text-[10px] font-semibold text-white">
                  {option.initials}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{option.name}</span>
                  {option.email ? <span className="block truncate text-[10px] text-zinc-400">{option.email}</span> : null}
                </span>
              </button>
            ))}
            {filteredOptions.length === 0 ? (
              <div className="rounded-md bg-zinc-50 !px-2 py-2 text-[12px] text-zinc-500">
                No workspace people found.
              </div>
            ) : null}
          </div>
          <PanelLabel>Agents</PanelLabel>
          <button
            type="button"
            className="flex h-8 w-full cursor-not-allowed items-center gap-2 rounded-md !px-2 text-left text-[12px] text-zinc-400"
            disabled
          >
            <span className="h-6 w-6 rounded-full bg-gradient-to-br from-orange-200 to-pink-300" />
            Project Kickoff Scope Manager
          </button>
          <button
            type="button"
            className="flex h-7 w-full cursor-not-allowed items-center gap-2 rounded-md !px-2 text-left text-[12px] font-medium text-zinc-400"
            disabled
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--os-brand-rail)_12%,white)] text-[var(--os-brand-rail)]">
              <Plus className="h-3.5 w-3.5" />
            </span>
            Create Agent
          </button>
        </div>
      </DropdownPanel>
    </>
  );
}

function DateMenu({ onSelect, onClose }: { onSelect: (label: string, isoDate: string) => void; onClose: () => void }) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const calendarStart = addDays(monthStart, -monthStart.getDay());
  const calendarDays = Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index));
  const monthLabel = today.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const nextWeekend = getNextSaturday(today);
  const quick = [
    { label: "Today", hint: formatWeekday(today), date: today },
    { label: "Later", hint: formatTime(today), date: today },
    { label: "Tomorrow", hint: formatWeekday(addDays(today, 1)), date: addDays(today, 1) },
    { label: "Next week", hint: formatWeekday(addDays(today, 7)), date: addDays(today, 7) },
    { label: "Next weekend", hint: formatWeekday(nextWeekend), date: nextWeekend },
    { label: "2 weeks", hint: formatShortDate(addDays(today, 14)), date: addDays(today, 14) },
    { label: "4 weeks", hint: formatShortDate(addDays(today, 28)), date: addDays(today, 28) },
    { label: "8 weeks", hint: formatShortDate(addDays(today, 56)), date: addDays(today, 56) },
  ];

  return (
    <>
      <div className="fixed inset-0 z-[84]" onClick={onClose} aria-hidden />
      <DropdownPanel className="right-0 top-7 w-[500px] max-w-[calc(100vw-420px)] overflow-hidden">
        <div className="grid grid-cols-2 border-b border-zinc-100 !p-1.5">
          <button type="button" className="flex h-7 items-center gap-2 rounded-md bg-zinc-100 !px-2.5 text-[12px] text-zinc-500">
            <CalendarDays className="h-3.5 w-3.5" />
            Start date
          </button>
          <button type="button" className="ml-1.5 flex h-7 items-center gap-2 rounded-md border border-[var(--os-brand-rail)] bg-white !px-2.5 text-[12px] text-zinc-700">
            <CalendarDays className="h-3.5 w-3.5 text-[var(--os-brand-rail)]" />
            Due date
          </button>
        </div>
        <div className="grid grid-cols-[1fr_1.1fr]">
          <div className="border-r border-zinc-100 py-1.5">
            {quick.map((option) => (
              <button
                key={option.label}
                type="button"
                className="flex h-7 w-full items-center justify-between !px-3 text-left text-[12px] text-zinc-800 hover:bg-zinc-50"
                onClick={() => onSelect(option.label, formatDateInput(option.date))}
              >
                <span>{option.label}</span>
                <span className="text-zinc-400">{option.hint}</span>
              </button>
            ))}
            <button type="button" className="mt-1.5 flex h-8 w-full items-center justify-between border-t border-zinc-100 !px-3 text-[12px] text-zinc-800">
              Set Recurring
              <ChevronRight className="h-4 w-4 text-zinc-500" />
            </button>
          </div>
          <div className="!p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-medium text-zinc-900">{monthLabel}</span>
              <span className="inline-flex items-center gap-3 text-[12px] text-zinc-600">
                Today
                <ChevronDown className="h-4 w-4 rotate-180" />
                <ChevronDown className="h-4 w-4" />
              </span>
            </div>
            <div className="grid grid-cols-7 gap-y-1.5 text-center text-[12px]">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                <span key={day} className="text-zinc-400">{day}</span>
              ))}
              {calendarDays.map((calendarDate) => {
                const isToday = formatDateInput(calendarDate) === formatDateInput(today);
                const isOutsideMonth = calendarDate.getMonth() !== today.getMonth();
                return (
                  <button
                    key={formatDateInput(calendarDate)}
                    type="button"
                    className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full ${
                      isToday ? "bg-red-500 text-white" : isOutsideMonth ? "text-zinc-300" : "text-zinc-900 hover:bg-zinc-100"
                    }`}
                    onClick={() => onSelect(formatCalendarLabel(calendarDate), formatDateInput(calendarDate))}
                  >
                    {calendarDate.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 border-t border-zinc-100 bg-zinc-50 !px-3 py-2">
          <span className="text-xl">🏖️</span>
          <div>
            <p className="text-[12px] font-semibold text-zinc-900">Set up your work schedule</p>
            <p className="text-[11px] text-zinc-500">Set working days/hours and holidays for your workspace.</p>
          </div>
          <X className="ml-auto h-5 w-5 text-zinc-400" />
        </div>
      </DropdownPanel>
    </>
  );
}

function PriorityMenu({ onSelect, onClose }: { onSelect: (value: TaskPriority) => void; onClose: () => void }) {
  const options: { label: TaskPriority; color: string }[] = [
    { label: "Urgent", color: "#DC2626" },
    { label: "High", color: "#F59E0B" },
    { label: "Normal", color: "#4F46E5" },
    { label: "Low", color: "#A1A1AA" },
  ];
  return (
    <>
      <div className="fixed inset-0 z-[84]" onClick={onClose} aria-hidden />
      <DropdownPanel className="right-0 top-7 w-[200px] overflow-hidden">
        <div className="!p-2">
          <PanelLabel>Priority</PanelLabel>
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              className="flex h-7 w-full items-center gap-2.5 rounded-md !px-2 text-left text-[12px] text-zinc-800 hover:bg-zinc-50"
              onClick={() => onSelect(option.label)}
            >
              <Flag className="h-4 w-4 fill-current" style={{ color: option.color }} />
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2.5 border-t border-zinc-100 !px-4 text-left text-[12px] text-zinc-800 hover:bg-zinc-50"
          onClick={() => onSelect("")}
        >
          <CircleDashed className="h-4 w-4 text-zinc-500" />
          Clear
        </button>
      </DropdownPanel>
    </>
  );
}

function TagsMenu({
  query,
  onQueryChange,
  onCreate,
  onClose,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[84]" onClick={onClose} aria-hidden />
      <DropdownPanel className="right-0 top-7 w-[300px] overflow-hidden">
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCreate();
        }}
        className="h-9 w-full border-b border-zinc-100 !px-2.5 text-[12px] outline-none"
        placeholder="Search or create tag..."
        autoFocus
      />
      <div className="!p-2.5">
        <PanelLabel>Select an option</PanelLabel>
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 rounded-md bg-zinc-100 !px-2 text-left text-[12px] text-zinc-600"
          onClick={onCreate}
        >
          Create
          {query.trim() ? (
            <span className="rounded-full bg-violet-100 !px-2 py-0.5 text-[12px] font-medium text-violet-700">{query.trim()}</span>
          ) : null}
          <span className="ml-auto text-zinc-400">↵</span>
        </button>
      </div>
    </DropdownPanel>
    </>
  );
}

function DropdownPanel({ children, className }: { children: ReactNode; className: string }) {
  return (
    <div className={`absolute z-[85] rounded-lg border border-zinc-200 bg-white shadow-lg ${className}`}>
      {children}
    </div>
  );
}

function BoardMode({
  tasks,
  draftTask,
  saving,
  onAddTask,
  onDraftChange,
  onSaveDraft,
  onCancelDraft,
  onTaskChange,
  onOpenTask,
  onCustomize,
}: {
  tasks: TaskItem[];
  draftTask: DraftTask | null;
  saving: boolean;
  onAddTask: (status?: TaskItem["status"]) => void;
  onDraftChange: (patch: Partial<DraftTask>) => void;
  onSaveDraft: () => void | Promise<void>;
  onCancelDraft: () => void;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
  onOpenTask: (task: TaskItem) => void;
  onCustomize: () => void;
}) {
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  const moveDraggedTask = (event: DragEvent<HTMLElement>, status: TaskItem["status"]) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggingTaskId;
    if (!taskId) return;
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status === status) return;
    void onTaskChange(taskId, { status });
    setDraggingTaskId(null);
  };

  return (
    <div className="min-w-[860px] !px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--os-brand-rail)_18%,transparent)] bg-[color-mix(in_srgb,var(--os-brand-rail)_9%,white)] !px-2 text-[11px] font-medium text-[var(--os-brand-rail)]"
        >
          <Columns3 className="h-3.5 w-3.5" />
          Status
        </button>
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1.5 rounded-md border border-zinc-200 !px-2 text-[11px] text-zinc-600 hover:bg-zinc-50"
          onClick={onCustomize}
        >
          <Settings className="h-3.5 w-3.5" />
          Customize view
        </button>
      </div>
      <div className="flex gap-1.5">
        {STATUS_COLUMNS.map((status) => {
          const items = tasks.filter((task) => task.status === status.key);
          const showDraft = draftTask?.status === status.key;
          return (
            <section
              key={status.key}
              className={`min-h-[82px] w-[220px] shrink-0 rounded-lg border !p-2 transition ${
                draggingTaskId ? "border-dashed border-[var(--os-brand-rail)] ring-1 ring-[color-mix(in_srgb,var(--os-brand-rail)_18%,transparent)]" : "border-zinc-100"
              }`}
              style={{ backgroundColor: status.bg }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.stopPropagation();
                moveDraggedTask(event, status.key);
              }}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-md !px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: status.color }}>
                  <Circle className="h-3 w-3 fill-current" />
                  {status.label}
                </span>
                <span className="text-[11px] font-medium text-zinc-500">{items.length}</span>
              </div>
              <div className="space-y-1.5">
                {items.map((task) => (
                  <BoardTaskCard
                    key={task.id}
                    task={task}
                    onOpen={() => onOpenTask(task)}
                    onTaskChange={(patch) => void onTaskChange(task.id, patch)}
                    onMove={(nextStatus) => void onTaskChange(task.id, { status: nextStatus })}
                    onComplete={() => void onTaskChange(task.id, { status: task.status === "complete" ? "to_do" : "complete" })}
                    onDragStart={(event) => {
                      setDraggingTaskId(task.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", task.id);
                    }}
                    onDragEnd={() => setDraggingTaskId(null)}
                  />
                ))}
                {showDraft ? (
                  <BoardDraftCard
                    draftTask={draftTask}
                    saving={saving}
                    onDraftChange={onDraftChange}
                    onSave={onSaveDraft}
                    onCancel={onCancelDraft}
                  />
                ) : null}
                <button
                  type="button"
                  className="flex h-7 w-full items-center gap-2 rounded-md !px-2 text-left text-[12px] text-zinc-600 hover:bg-white/70"
                  onClick={() => onAddTask(status.key)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Task
                </button>
              </div>
            </section>
          );
        })}
        <button
          type="button"
          className="flex h-7 shrink-0 items-center gap-2 rounded-md !px-2.5 text-[12px] text-zinc-500 hover:bg-zinc-100"
          onClick={onCustomize}
        >
          <Plus className="h-3.5 w-3.5" />
          Add group
        </button>
      </div>
    </div>
  );
}

function BoardTaskCard({
  task,
  onOpen,
  onTaskChange,
  onMove,
  onComplete,
  onDragStart,
  onDragEnd,
}: {
  task: TaskItem;
  onOpen: () => void;
  onTaskChange: (patch: Partial<TaskItem>) => void | Promise<void>;
  onMove: (status: TaskItem["status"]) => void;
  onComplete: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const [quickMenu, setQuickMenu] = useState<"status" | "date" | "priority" | null>(null);
  const dragStartedRef = useRef(false);
  const currentIndex = STATUS_COLUMNS.findIndex((status) => status.key === task.status);
  const previousStatus = STATUS_COLUMNS[Math.max(0, currentIndex - 1)]?.key;
  const nextStatus = STATUS_COLUMNS[Math.min(STATUS_COLUMNS.length - 1, currentIndex + 1)]?.key;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      className="group/card w-full cursor-grab rounded-md border border-zinc-200 bg-white !p-2 text-left text-[12px] shadow-sm transition hover:-translate-y-px hover:border-zinc-300 hover:shadow-md active:cursor-grabbing"
      onClick={(event) => {
        if (dragStartedRef.current) {
          event.preventDefault();
          return;
        }
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      onDragStart={(event) => {
        dragStartedRef.current = true;
        onDragStart(event);
      }}
      onDragEnd={() => {
        onDragEnd();
        window.setTimeout(() => {
          dragStartedRef.current = false;
        }, 0);
      }}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full ${
          task.status === "complete"
            ? "bg-emerald-500"
            : "border-2 border-dashed border-zinc-400"
        }`} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-zinc-900">{task.name}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
            {task.assignee ? <span className="truncate">{task.assignee}</span> : null}
            {task.dueDate ? <span>{task.dueDate}</span> : null}
            {task.priority ? <span>{task.priority}</span> : null}
          </div>
        </div>
        <span className="opacity-0 transition group-hover/card:opacity-100">
          <MoreHorizontal className="h-3.5 w-3.5 text-zinc-400" />
        </span>
      </div>
      <div className="mt-2 hidden items-center gap-1 group-hover/card:flex">
        <CardActionButton
          Icon={Check}
          label={task.status === "complete" ? "Reopen" : "Complete"}
          onClick={onComplete}
        />
        <span className="relative" onClick={(event) => event.stopPropagation()}>
          <CardActionButton
            Icon={Circle}
            label="Change status"
            onClick={() => setQuickMenu((menu) => (menu === "status" ? null : "status"))}
          />
          {quickMenu === "status" ? (
            <StatusMenu
              onSelect={(status) => {
                onMove(status);
                setQuickMenu(null);
              }}
              onClose={() => setQuickMenu(null)}
            />
          ) : null}
        </span>
        <span className="relative" onClick={(event) => event.stopPropagation()}>
          <CardActionButton
            Icon={CalendarDays}
            label="Set due date"
            onClick={() => setQuickMenu((menu) => (menu === "date" ? null : "date"))}
          />
          {quickMenu === "date" ? (
            <DateMenu
              onSelect={(dueDate, dueDateISO) => {
                void onTaskChange({ dueDate, dueDateISO });
                setQuickMenu(null);
              }}
              onClose={() => setQuickMenu(null)}
            />
          ) : null}
        </span>
        <span className="relative" onClick={(event) => event.stopPropagation()}>
          <CardActionButton
            Icon={Flag}
            label="Set priority"
            onClick={() => setQuickMenu((menu) => (menu === "priority" ? null : "priority"))}
          />
          {quickMenu === "priority" ? (
            <PriorityMenu
              onSelect={(priority) => {
                void onTaskChange({ priority });
                setQuickMenu(null);
              }}
              onClose={() => setQuickMenu(null)}
            />
          ) : null}
        </span>
        <CardActionButton
          Icon={ChevronRight}
          label="Move left"
          disabled={!previousStatus || previousStatus === task.status}
          rotate
          onClick={() => previousStatus && onMove(previousStatus)}
        />
        <CardActionButton
          Icon={ChevronRight}
          label="Move right"
          disabled={!nextStatus || nextStatus === task.status}
          onClick={() => nextStatus && onMove(nextStatus)}
        />
        <CardActionButton Icon={Pencil} label="Open task" onClick={onOpen} />
      </div>
    </div>
  );
}

function CardActionButton({
  Icon,
  label,
  disabled,
  rotate,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  disabled?: boolean;
  rotate?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 shadow-sm ${
        disabled ? "cursor-not-allowed opacity-40" : "hover:bg-zinc-100 hover:text-zinc-900"
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <Icon className={`h-3.5 w-3.5 ${rotate ? "rotate-180" : ""}`} />
    </button>
  );
}

function BoardDraftCard({
  draftTask,
  saving,
  onDraftChange,
  onSave,
  onCancel,
}: {
  draftTask: DraftTask;
  saving: boolean;
  onDraftChange: (patch: Partial<DraftTask>) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-[color-mix(in_srgb,var(--os-brand-rail)_28%,#e4e4e7)] bg-white !p-2 text-[12px] shadow-sm">
      <input
        value={draftTask.name}
        onChange={(event) => onDraftChange({ name: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") void onSave();
          if (event.key === "Escape") onCancel();
        }}
        placeholder="Task name"
        className="h-6 w-full bg-transparent text-[12px] text-zinc-900 outline-none placeholder:text-zinc-400"
        autoFocus
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1 text-zinc-400">
          <CircleDashed className="h-3.5 w-3.5" />
          <span>{draftTask.taskType}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="h-6 rounded-md !px-2 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="h-6 rounded-md bg-[var(--os-brand-rail)] !px-2 text-[11px] font-medium text-white disabled:opacity-60"
            disabled={saving}
            onClick={() => {
              void onSave();
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CalendarMode({
  tasks,
  activeView,
  onOpenTask,
}: {
  tasks: TaskItem[];
  activeView: ViewDef;
  onOpenTask: (task: TaskItem) => void;
}) {
  const groups = ["No date", "Today", "Tomorrow", "This week", "Later"].map((label) => ({
    label,
    items: tasks.filter((task) => getCalendarBucket(task.dueDate) === label),
  }));

  return (
    <div className="min-w-[860px] !p-4">
      <div className="mb-3 inline-flex h-6 items-center gap-1.5 rounded-full border border-orange-100 bg-orange-50 !px-2 text-[11px] font-medium text-orange-700">
        <activeView.Icon className="h-3.5 w-3.5" />
        {activeView.label}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {groups.map((group) => (
          <section key={group.label} className="min-h-[260px] rounded-lg border border-zinc-100 bg-zinc-50/60 !p-2">
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-zinc-600">
              <span>{group.label}</span>
              <span>{group.items.length}</span>
            </div>
            <div className="space-y-1.5">
              {group.items.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="w-full rounded-md border border-zinc-200 bg-white !p-2 text-left text-[12px] shadow-sm hover:border-zinc-300 hover:shadow-md"
                  onClick={() => onOpenTask(task)}
                >
                  <p className="truncate font-medium text-zinc-900">{task.name}</p>
                  <p className="mt-1 truncate text-[11px] text-zinc-500">{task.assignee || "Unassigned"}</p>
                </button>
              ))}
              {group.items.length === 0 ? <p className="py-2 text-[11px] text-zinc-400">No tasks</p> : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function GanttMode({
  tasks,
  activeView,
  onOpenTask,
}: {
  tasks: TaskItem[];
  activeView: ViewDef;
  onOpenTask: (task: TaskItem) => void;
}) {
  const lanes = tasks.length > 0 ? tasks : [];

  return (
    <div className="min-w-[920px] !p-4">
      <div className="mb-3 inline-flex h-6 items-center gap-1.5 rounded-full border border-red-100 bg-red-50 !px-2 text-[11px] font-medium text-red-700">
        <activeView.Icon className="h-3.5 w-3.5" />
        {activeView.label}
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="grid grid-cols-[260px_repeat(6,minmax(100px,1fr))] border-b border-zinc-100 bg-zinc-50 text-[11px] font-medium text-zinc-500">
          <span className="!px-3 py-2">Task</span>
          {["Start", "Week 1", "Week 2", "Week 3", "Week 4", "Due"].map((label) => (
            <span key={label} className="border-l border-zinc-100 !px-3 py-2">{label}</span>
          ))}
        </div>
        {lanes.map((task, index) => {
          const barStart = (index % 3) + 1;
          const barSpan = task.status === "complete" ? 4 : task.status === "in_progress" ? 3 : 2;
          const statusMeta = getStatusMeta(task.status);
          return (
            <button
              key={task.id}
              type="button"
              className="grid min-h-9 w-full grid-cols-[260px_repeat(6,minmax(100px,1fr))] items-center border-b border-zinc-100 text-left text-[12px] hover:bg-zinc-50"
              onClick={() => onOpenTask(task)}
            >
              <span className="flex min-w-0 items-center gap-2 !px-3">
                <CircleDashed className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <span className="truncate font-medium text-zinc-900">{task.name}</span>
              </span>
              <span
                className="h-5 rounded-full !px-2 text-[11px] font-medium leading-5 text-white"
                style={{
                  gridColumn: `${barStart + 1} / span ${barSpan}`,
                  backgroundColor: statusMeta.color,
                }}
              >
                {task.dueDate || statusMeta.label}
              </span>
            </button>
          );
        })}
        {lanes.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center text-[12px] text-zinc-400">
            Add a task to populate the timeline.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DocMode({ tasks, activeView }: { tasks: TaskItem[]; activeView: ViewDef }) {
  const [note, setNote] = useState("");

  return (
    <div className="min-w-[860px] !p-4">
      <div className="mb-3 inline-flex h-6 items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 !px-2 text-[11px] font-medium text-blue-700">
        <activeView.Icon className="h-3.5 w-3.5" />
        {activeView.label}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3">
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add notes, decisions, or context for this list..."
          className="min-h-[360px] resize-none rounded-xl border border-zinc-200 bg-white !p-4 text-[13px] leading-6 text-zinc-800 outline-none focus:border-[var(--os-brand-rail)]"
        />
        <aside className="rounded-xl border border-zinc-200 bg-white !p-3">
          <p className="mb-2 text-[12px] font-semibold text-zinc-900">Linked tasks</p>
          <div className="space-y-1">
            {tasks.slice(0, 8).map((task) => (
              <div key={task.id} className="flex items-center gap-2 rounded-md !px-2 py-1.5 text-[12px] text-zinc-700">
                <CircleDashed className="h-3.5 w-3.5 text-zinc-400" />
                <span className="truncate">{task.name}</span>
              </div>
            ))}
            {tasks.length === 0 ? <p className="text-[12px] text-zinc-400">No linked tasks yet.</p> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function FormMode({
  activeView,
  saving,
  assigneeOptions,
  onCreateTask,
}: {
  activeView: ViewDef;
  saving: boolean;
  assigneeOptions: AssigneeOption[];
  onCreateTask: (draft: DraftTask) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | undefined>();
  const [dueDate, setDueDate] = useState("");
  const [dueDateISO, setDueDateISO] = useState<string | undefined>();
  const [priority, setPriority] = useState<TaskPriority>("");
  const [taskType, setTaskType] = useState("Task");
  const [tagDraft, setTagDraft] = useState("");
  const [openMenu, setOpenMenu] = useState<TaskOptionMenu>(null);

  const submitForm = async () => {
    const name = title.trim();
    if (!name || saving) return;
    const tags = tagDraft.split(",").map((tag) => tag.trim()).filter(Boolean);
    await onCreateTask({
      name,
      status: "to_do",
      assignee,
      assigneeId,
      dueDate,
      dueDateISO,
      priority,
      taskType,
      tags,
    });
    setTitle("");
    setAssignee("");
    setAssigneeId(undefined);
    setDueDate("");
    setDueDateISO(undefined);
    setPriority("");
    setTaskType("Task");
    setTagDraft("");
    setOpenMenu(null);
  };

  return (
    <div className="min-w-[860px] !p-4">
      <div className="mb-3 inline-flex h-6 items-center gap-1.5 rounded-full border border-violet-100 bg-violet-50 !px-2 text-[11px] font-medium text-violet-700">
        <activeView.Icon className="h-3.5 w-3.5" />
        {activeView.label}
      </div>
      <form
        className="max-w-[720px] rounded-xl border border-zinc-200 bg-white shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void submitForm();
        }}
      >
        <div className="border-b border-zinc-100 !px-4 py-3">
          <h2 className="text-[14px] font-semibold text-zinc-900">Task intake form</h2>
          <p className="mt-1 text-[12px] text-zinc-500">Create list tasks without leaving the current view.</p>
        </div>
        <div className="grid gap-3 !p-4 text-[12px]">
          <label className="grid gap-1.5">
            <span className="font-medium text-zinc-700">Task name</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Enter task name"
              className="h-9 rounded-lg border border-zinc-200 !px-3 text-[13px] outline-none focus:border-[var(--os-brand-rail)]"
              autoFocus
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-lg border border-zinc-200 !px-3 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
                onClick={() => setOpenMenu(openMenu === "assignee" ? null : "assignee")}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="truncate">{assignee || "Assign person"}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              </button>
              {openMenu === "assignee" ? (
                <AssigneeMenu
                  options={assigneeOptions}
                  onSelect={(value) => {
                    setAssignee(value.name);
                    setAssigneeId(value.id);
                    setOpenMenu(null);
                  }}
                  onClose={() => setOpenMenu(null)}
                />
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-lg border border-zinc-200 !px-3 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
                onClick={() => setOpenMenu(openMenu === "date" ? null : "date")}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <CalendarDays className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="truncate">{dueDate || "Due date"}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              </button>
              {openMenu === "date" ? (
                <DateMenu
                  onSelect={(label, isoDate) => {
                    setDueDate(label);
                    setDueDateISO(isoDate);
                    setOpenMenu(null);
                  }}
                  onClose={() => setOpenMenu(null)}
                />
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-lg border border-zinc-200 !px-3 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
                onClick={() => setOpenMenu(openMenu === "priority" ? null : "priority")}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Flag className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="truncate">{priority || "Priority"}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              </button>
              {openMenu === "priority" ? (
                <PriorityMenu
                  onSelect={(value) => {
                    setPriority(value);
                    setOpenMenu(null);
                  }}
                  onClose={() => setOpenMenu(null)}
                />
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-lg border border-zinc-200 !px-3 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
                onClick={() => setOpenMenu(openMenu === "type" ? null : "type")}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Box className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="truncate">{taskType}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              </button>
              {openMenu === "type" ? (
                <TaskTypeMenu
                  value={taskType}
                  onSelect={(value) => {
                    setTaskType(value);
                    setOpenMenu(null);
                  }}
                  onClose={() => setOpenMenu(null)}
                />
              ) : null}
            </div>
          </div>
          <label className="grid gap-1.5">
            <span className="font-medium text-zinc-700">Tags</span>
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder="Comma separated tags"
              className="h-9 rounded-lg border border-zinc-200 !px-3 text-[13px] outline-none focus:border-[var(--os-brand-rail)]"
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 !px-4 py-3">
          <button
            type="button"
            className="h-8 rounded-md !px-3 text-[12px] text-zinc-500 hover:bg-zinc-100"
            onClick={() => {
              setTitle("");
              setAssignee("");
              setDueDate("");
              setDueDateISO(undefined);
              setPriority("");
              setTaskType("Task");
              setTagDraft("");
            }}
          >
            Reset
          </button>
          <button
            type="submit"
            disabled={!title.trim() || saving}
            className="h-8 rounded-md bg-[var(--os-brand-rail)] !px-3 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create task"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PlaceholderMode({
  activeView,
  tasks,
  onOpenTask,
}: {
  activeView: ViewDef;
  tasks: TaskItem[];
  onOpenTask: (task: TaskItem) => void;
}) {
  return (
    <div className="min-w-[860px] !p-4">
      <div className="mb-3 inline-flex h-6 items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 !px-2 text-[11px] font-medium text-zinc-700">
        <activeView.Icon className="h-3.5 w-3.5" style={{ color: activeView.swatch }} />
        {activeView.label}
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white !p-4">
        <h2 className="mb-1.5 text-[14px] font-semibold text-zinc-900">{activeView.label} view</h2>
        <p className="mb-4 max-w-[440px] text-[12px] leading-5 text-zinc-500">
          This view is active and keeps the same task data. Open a task from the preview while this renderer is expanded.
        </p>
        <div className="grid max-w-[640px] grid-cols-2 gap-2">
          {tasks.slice(0, 6).map((task) => (
            <button
              key={task.id}
              type="button"
              className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white !px-2 text-left text-[12px] hover:bg-zinc-50"
              onClick={() => onOpenTask(task)}
            >
              <CircleDashed className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <span className="truncate">{task.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskDetailModal({
  task,
  assigneeOptions,
  onClose,
  onTaskChange,
  onAddSubtask,
}: {
  task: TaskItem;
  assigneeOptions: AssigneeOption[];
  onClose: () => void;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
  onAddSubtask: (parentId: string) => void;
}) {
  const statusMeta = getStatusMeta(task.status);
  const [statusOpen, setStatusOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? "");
  const [sidePanel, setSidePanel] = useState<TaskSidePanel>("activity");

  const addTag = () => {
    const nextTag = tagQuery.trim();
    if (!nextTag) return;
    const existing = new Set(task.tags.map((t) => t.toLowerCase()));
    if (!existing.has(nextTag.toLowerCase())) {
      void onTaskChange(task.id, { tags: [...task.tags, nextTag] });
    }
    setTagQuery("");
    setTagsOpen(false);
  };

  const commitDescription = () => {
    const nextDescription = descriptionDraft.trim();
    if (nextDescription !== (task.description ?? "")) {
      void onTaskChange(task.id, { description: nextDescription });
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 !p-8" onClick={onClose}>
      <section
        className="flex h-[min(720px,calc(100vh-80px))] w-[min(1180px,calc(100vw-96px))] overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-200 !px-3 text-[12px] text-zinc-500">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">My Wrk</span>
              <span>/</span>
              <span className="truncate font-medium text-zinc-900">{task.name}</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="h-7 rounded-md !px-2 hover:bg-zinc-100">Ask</button>
              <button type="button" className="h-7 rounded-md !px-2 hover:bg-zinc-100">Share</button>
              <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-100" onClick={onClose} aria-label="Close task">
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-auto !px-10 py-7">
            <div className="mb-4 inline-flex h-6 items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 !px-2 text-[11px] text-zinc-700">
              <CircleDashed className="h-3.5 w-3.5" />
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-zinc-950"
                onClick={() => setTypeOpen((open) => !open)}
              >
                {task.taskType || "Task"}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <span className="relative">
                {typeOpen ? (
                  <TaskTypeMenu
                    value={task.taskType || "Task"}
                    onSelect={(taskType) => {
                      setTypeOpen(false);
                      void onTaskChange(task.id, { taskType });
                    }}
                    onClose={() => setTypeOpen(false)}
                  />
                ) : null}
              </span>
            </div>
            <h2 className="mb-4 text-[24px] font-semibold leading-tight text-zinc-950">{task.name}</h2>
            <div className="mb-5 rounded-lg bg-zinc-50 !px-3 py-2 text-[12px] text-zinc-600">
              <Bot className="mr-1.5 inline h-3.5 w-3.5 text-fuchsia-500" />
              Ask Brain to write a description, generate subtasks, or find similar tasks
            </div>

            <div className="grid max-w-[760px] grid-cols-2 gap-x-12 gap-y-3 text-[12px]">
              <TaskDetailField Icon={CheckCircle2} label="Status">
                <div className="relative flex items-center gap-1.5">
                  <button
                    type="button"
                    className="inline-flex h-6 items-center gap-1 rounded-md !px-2 text-[11px] font-semibold text-white"
                    style={{ backgroundColor: statusMeta.color }}
                    onClick={() => setStatusOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={statusOpen}
                  >
                    {statusMeta.label}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 hover:text-zinc-900"
                    onClick={() => void onTaskChange(task.id, { status: "complete" })}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  {statusOpen ? (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(false)} aria-hidden />
                      <div className="absolute left-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                        {STATUS_COLUMNS.map((status) => (
                          <button
                            key={status.key}
                            type="button"
                            className="flex h-8 w-full items-center gap-2 !px-2 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
                            onClick={() => {
                              setStatusOpen(false);
                              void onTaskChange(task.id, { status: status.key });
                            }}
                          >
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: status.color }} />
                            {status.label}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </TaskDetailField>
              <TaskDetailField Icon={Users} label="Assignees">
                <div className="relative">
                  <button
                    type="button"
                    className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md !px-1.5 hover:bg-zinc-100 hover:text-zinc-900"
                    onClick={() => setAssigneeOpen((open) => !open)}
                  >
                    <UserRound className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="truncate">{task.assignee || "Empty"}</span>
                    <ChevronDown className="h-3 w-3 text-zinc-400" />
                  </button>
                  {assigneeOpen ? (
                    <AssigneeMenu
                      options={assigneeOptions}
                      onSelect={(assignee) => {
                        setAssigneeOpen(false);
                        void onTaskChange(task.id, { assignee: assignee.name, assigneeId: assignee.id });
                      }}
                      onClose={() => setAssigneeOpen(false)}
                    />
                  ) : null}
                </div>
              </TaskDetailField>
              <TaskDetailField Icon={CalendarDays} label="Dates">
                <div className="relative">
                  <button
                    type="button"
                    className="inline-flex h-6 items-center gap-1.5 rounded-md !px-1.5 hover:bg-zinc-100 hover:text-zinc-900"
                    onClick={() => setDateOpen((open) => !open)}
                  >
                    <CalendarDays className="h-3.5 w-3.5 text-zinc-500" />
                    <span>{task.dueDate || "Start → Due"}</span>
                    <ChevronDown className="h-3 w-3 text-zinc-400" />
                  </button>
                  {dateOpen ? (
                    <DateMenu
                      onSelect={(dueDate, dueDateISO) => {
                        setDateOpen(false);
                        void onTaskChange(task.id, { dueDate, dueDateISO });
                      }}
                      onClose={() => setDateOpen(false)}
                    />
                  ) : null}
                </div>
              </TaskDetailField>
              <TaskDetailField Icon={Flag} label="Priority">
                <div className="relative">
                  <button
                    type="button"
                    className="inline-flex h-6 items-center gap-1.5 rounded-md !px-1.5 text-left hover:bg-zinc-100 hover:text-zinc-900"
                    onClick={() => setPriorityOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={priorityOpen}
                  >
                    {task.priority ? <PriorityBadge priority={task.priority} /> : "Empty"}
                    <ChevronDown className="h-3 w-3 text-zinc-400" />
                  </button>
                  {priorityOpen ? (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setPriorityOpen(false)} aria-hidden />
                      <div className="absolute left-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                        {(["Urgent", "High", "Normal", "Low", ""] as TaskPriority[]).map((priority) => (
                          <button
                            key={priority || "clear"}
                            type="button"
                            className="flex h-8 w-full items-center gap-2 !px-2 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
                            onClick={() => {
                              setPriorityOpen(false);
                              void onTaskChange(task.id, { priority });
                            }}
                          >
                            {priority ? <Flag className={`h-3.5 w-3.5 ${priorityColorClass(priority)}`} /> : <CircleDashed className="h-3.5 w-3.5 text-zinc-400" />}
                            {priority || "Clear"}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </TaskDetailField>
              <TaskDetailField Icon={Tag} label="Tags">
                <div className="relative">
                  <button
                    type="button"
                    className="inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-md !px-1.5 hover:bg-zinc-100 hover:text-zinc-900"
                    onClick={() => setTagsOpen((open) => !open)}
                  >
                    {task.tags.length > 0 ? (
                      <span className="flex min-w-0 flex-wrap gap-1">
                        {task.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded-full bg-violet-50 !px-1.5 py-0.5 text-[11px] text-violet-700">
                            {tag}
                          </span>
                        ))}
                        {task.tags.length > 3 ? <span className="text-zinc-400">+{task.tags.length - 3}</span> : null}
                      </span>
                    ) : (
                      "Empty"
                    )}
                    <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
                  </button>
                  {tagsOpen ? (
                    <TagEditorPopover
                      tags={task.tags}
                      query={tagQuery}
                      onQueryChange={setTagQuery}
                      onCreate={addTag}
                      onRemove={(tag) => void onTaskChange(task.id, { tags: task.tags.filter((item) => item !== tag) })}
                      onClose={() => setTagsOpen(false)}
                    />
                  ) : null}
                </div>
              </TaskDetailField>
              <TaskDetailField Icon={Activity} label="Track time">
                Start
              </TaskDetailField>
            </div>

            <div className="my-6 h-px max-w-[760px] bg-zinc-100" />
            <textarea
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              onBlur={commitDescription}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              placeholder="Add description, or write with AI"
              className="mb-12 min-h-[72px] w-full max-w-[760px] resize-y rounded-lg border border-transparent bg-white !p-2 text-[13px] leading-5 text-zinc-700 outline-none placeholder:text-zinc-400 hover:border-zinc-100 focus:border-[var(--os-brand-rail)]"
            />

            <div className="grid max-w-[360px] gap-3 text-[12px] text-zinc-700">
              {[
                { label: "Add fields", Icon: Pencil, panel: "fields" as const },
                { label: "Add subtask", Icon: GitBranch },
                { label: "Relate items or add dependencies", Icon: Link2, panel: "related" as const },
                { label: "Create checklist", Icon: ClipboardList, panel: "checklist" as const },
                { label: "Attach file", Icon: Paperclip, panel: "links" as const },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="flex h-7 items-center gap-2 rounded-md text-left hover:bg-zinc-50"
                  onClick={() => {
                    if (item.label === "Add subtask") onAddSubtask(task.id);
                    if (item.panel) setSidePanel(item.panel);
                  }}
                >
                  <item.Icon className="h-3.5 w-3.5 text-zinc-500" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <TaskModalRail activePanel={sidePanel} onChange={setSidePanel} />
        {sidePanel ? <TaskSidePanelView panel={sidePanel} task={task} onTaskChange={onTaskChange} /> : null}
      </section>
    </div>
  );
}

function TaskModalRail({
  activePanel,
  onChange,
}: {
  activePanel: TaskSidePanel;
  onChange: (panel: TaskSidePanel) => void;
}) {
  const railItems: { key: Exclude<TaskSidePanel, null>; label: string; Icon: LucideIcon }[] = [
    { key: "activity", label: "Activity", Icon: MessageSquare },
    { key: "related", label: "Related items", Icon: GitBranch },
    { key: "links", label: "Add links", Icon: LayoutGrid },
  ];

  return (
    <div className="flex w-8 shrink-0 flex-col items-center border-l border-zinc-200 bg-white py-12 text-zinc-500">
      <button
        type="button"
        className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-100 hover:text-zinc-900"
        title={activePanel ? "Collapse" : "Activity"}
        aria-label={activePanel ? "Collapse side panel" : "Open activity panel"}
        onClick={() => onChange(activePanel ? null : "activity")}
      >
        <ChevronRight className={`h-4 w-4 transition-transform ${activePanel ? "" : "rotate-180"}`} />
      </button>
      {railItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`mb-1 inline-flex h-7 w-7 items-center justify-center rounded-md ${
            activePanel === item.key ? "bg-zinc-100 text-zinc-900" : "hover:bg-zinc-100 hover:text-zinc-900"
          }`}
          title={item.label}
          aria-label={item.label}
          onClick={() => onChange(item.key)}
        >
          <item.Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

function TaskSidePanelView({
  panel,
  task,
  onTaskChange,
}: {
  panel: Exclude<TaskSidePanel, null>;
  task: TaskItem;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
}) {
  if (panel === "related") return <RelatedItemsPanel task={task} onTaskChange={onTaskChange} />;
  if (panel === "links") return <AddLinksPanel task={task} onTaskChange={onTaskChange} />;
  if (panel === "fields") return <TaskFieldsPanel task={task} onTaskChange={onTaskChange} />;
  if (panel === "checklist") return <ChecklistPanel task={task} onTaskChange={onTaskChange} />;
  return <ActivityPanel task={task} />;
}

function ActivityPanel({ task }: { task: TaskItem }) {
  const [commentDraft, setCommentDraft] = useState("");
  const [comments, setComments] = useState<ApiTaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadComments() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/tasks/${task.id}/comments`, { cache: "no-store" });
        if (!response.ok) throw new Error(await readApiError(response, "Failed to load comments"));
        const data = (await response.json()) as ApiTaskComment[];
        if (!cancelled) setComments(Array.isArray(data) ? data : []);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load comments");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadComments();

    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const addComment = async () => {
    const text = commentDraft.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to add comment"));
      const created = (await response.json()) as ApiTaskComment;
      setComments((current) => [...current, created]);
      setCommentDraft("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to add comment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/40">
      <div className="flex h-10 items-center justify-between border-b border-zinc-200 !px-3">
        <h3 className="text-[13px] font-semibold text-zinc-900">Activity</h3>
        <div className="flex items-center gap-2 text-zinc-500">
          <Search className="h-3.5 w-3.5" />
          <MessageSquare className="h-3.5 w-3.5" />
          <ListFilter className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto !p-3 text-[11px] text-zinc-500">
        <div className="mb-3 flex">
          <span>You created this task</span>
          <span className="ml-auto">{task.dateCreated}</span>
        </div>
        {loading ? <div className="text-[11px] text-zinc-400">Loading activity…</div> : null}
        {error ? <div className="mb-2 rounded-md bg-red-50 !px-2 py-1 text-[11px] text-red-600">{error}</div> : null}
        <div className="space-y-2">
          {comments.map((comment) => (
            <div key={comment.id} className="rounded-lg border border-zinc-200 bg-white !p-2 text-[12px] text-zinc-700 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-[10px] font-medium text-zinc-400">
                <UserRound className="h-3 w-3" />
                <span>{commentAuthorName(comment)}</span>
                {comment.createdAt ? <span className="ml-auto">{formatActivityTime(comment.createdAt)}</span> : null}
              </div>
              <p className="whitespace-pre-wrap text-zinc-700">{comment.body}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-zinc-200 !p-3">
        <div className="rounded-lg border border-zinc-200 bg-white !p-2 shadow-sm">
          <input
            type="text"
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addComment();
            }}
            placeholder="Write a comment..."
            className="mb-2 h-8 w-full bg-transparent text-[12px] outline-none placeholder:text-zinc-400"
          />
          <div className="flex items-center gap-1 text-zinc-400">
            <Plus className="h-4 w-4" />
            <span className="rounded-md bg-zinc-100 !px-2 py-1 text-[11px] text-zinc-600">Comment</span>
            <Bot className="h-4 w-4 text-fuchsia-500" />
            <Paperclip className="h-4 w-4" />
            <button
              type="button"
              className="ml-auto rounded-md bg-zinc-100 !px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-200 disabled:opacity-50"
              disabled={!commentDraft.trim() || saving}
              onClick={() => void addComment()}
            >
              {saving ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function RelatedItemsPanel({
  task,
  onTaskChange,
}: {
  task: TaskItem;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<string[]>(() => parseListField(task.customFields?.relatedItems));

  useEffect(() => {
    setItems(parseListField(task.customFields?.relatedItems));
  }, [task.customFields?.relatedItems]);

  const addItem = () => {
    const nextItem = draft.trim();
    if (!nextItem) return;
    const nextItems = [...items, nextItem];
    setItems(nextItems);
    void onTaskChange(task.id, { customFields: { relatedItems: JSON.stringify(nextItems) } });
    setDraft("");
    setAdding(false);
  };

  const removeItem = (item: string) => {
    const nextItems = items.filter((entry) => entry !== item);
    setItems(nextItems);
    void onTaskChange(task.id, { customFields: { relatedItems: JSON.stringify(nextItems) } });
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/40">
      <div className="flex h-10 items-center justify-between border-b border-zinc-200 !px-3">
        <h3 className="text-[13px] font-semibold text-zinc-900">Related items</h3>
        <div className="flex items-center gap-2 text-zinc-500">
          <Search className="h-3.5 w-3.5" />
          <Plus className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="border-b border-zinc-100 !p-2">
        <div className="grid grid-cols-2 rounded-md bg-zinc-100 !p-0.5 text-[11px] text-zinc-500">
          <button type="button" className="h-6 rounded bg-white font-medium text-zinc-700 shadow-sm">Relationships</button>
          <button type="button" className="h-6 rounded">References</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto !p-3">
        {items.length === 0 && !adding ? (
          <div className="flex min-h-[280px] items-center justify-center text-center">
            <div className="max-w-[220px]">
              <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-400">
                <GitBranch className="h-4 w-4" />
              </span>
              <p className="text-[12px] font-semibold text-zinc-700">No related items</p>
              <p className="mt-1 text-[11px] leading-4 text-zinc-400">Link related Tasks or Docs to organize and quickly access them here.</p>
              <button
                type="button"
                className="mt-3 h-7 rounded-md border border-zinc-200 bg-white !px-2.5 text-[11px] text-zinc-600 shadow-sm hover:bg-zinc-50"
                onClick={() => setAdding(true)}
              >
                + Relate a Task or Doc
              </button>
            </div>
          </div>
        ) : null}
        {items.length > 0 ? (
          <div className="space-y-1.5">
            {items.map((item) => (
              <div key={item} className="flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white !px-2 text-[12px] text-zinc-700">
                <GitBranch className="h-3.5 w-3.5 text-zinc-500" />
                <span className="min-w-0 flex-1 truncate">{item}</span>
                <button type="button" className="text-zinc-400 hover:text-zinc-700" onClick={() => removeItem(item)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {adding ? (
          <div className="rounded-lg border border-zinc-200 bg-white !p-2 shadow-sm">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addItem();
                if (event.key === "Escape") setAdding(false);
              }}
              placeholder="Search or enter task/doc name"
              className="h-8 w-full bg-transparent text-[12px] outline-none placeholder:text-zinc-400"
              autoFocus
            />
            <div className="mt-1 flex justify-end gap-1">
              <button type="button" className="h-7 rounded-md !px-2 text-[11px] text-zinc-500 hover:bg-zinc-100" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="button" className="h-7 rounded-md bg-[var(--os-brand-rail)] !px-2 text-[11px] font-medium text-white disabled:opacity-50" disabled={!draft.trim()} onClick={addItem}>
                Relate
              </button>
            </div>
          </div>
        ) : null}
        {items.length > 0 && !adding ? (
          <button
            type="button"
            className="mt-3 h-7 rounded-md border border-zinc-200 bg-white !px-2.5 text-[11px] text-zinc-600 shadow-sm hover:bg-zinc-50"
            onClick={() => setAdding(true)}
          >
            + Relate a Task or Doc
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function TaskFieldsPanel({
  task,
  onTaskChange,
}: {
  task: TaskItem;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
}) {
  const [notesDraft, setNotesDraft] = useState(task.customFields?.notes ?? "");
  const customEntries = Object.entries(task.customFields ?? {}).filter(
    ([key]) => !["notes", "relatedItems", "taskLinks", "checklist"].includes(key),
  );

  useEffect(() => {
    setNotesDraft(task.customFields?.notes ?? "");
  }, [task.customFields?.notes]);

  const saveNotes = () => {
    const nextNotes = notesDraft.trim();
    if (nextNotes !== (task.customFields?.notes ?? "")) {
      void onTaskChange(task.id, { customFields: { notes: nextNotes } });
    }
  };

  const updateField = (key: string, value: string) => {
    void onTaskChange(task.id, { customFields: { [key]: value } });
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/40">
      <div className="flex h-10 items-center justify-between border-b border-zinc-200 !px-3">
        <h3 className="text-[13px] font-semibold text-zinc-900">Fields</h3>
        <Settings className="h-3.5 w-3.5 text-zinc-500" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto !p-3 text-[12px]">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium text-zinc-500">Notes</span>
          <textarea
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            onBlur={saveNotes}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder="Attach notes to this task"
            className="min-h-[104px] w-full resize-y rounded-lg border border-zinc-200 bg-white !p-2 text-[12px] leading-5 outline-none placeholder:text-zinc-400 focus:border-[var(--os-brand-rail)]"
          />
        </label>
        <div className="mt-4 border-t border-zinc-100 pt-3">
          <p className="mb-2 text-[11px] font-medium text-zinc-500">Custom fields</p>
          {customEntries.length > 0 ? (
            <div className="space-y-2">
              {customEntries.map(([key, value]) => (
                <label key={key} className="block">
                  <span className="mb-1 block truncate text-[11px] font-medium text-zinc-500">{key}</span>
                  <input
                    defaultValue={value}
                    onBlur={(event) => updateField(key, event.currentTarget.value.trim())}
                    className="h-8 w-full rounded-md border border-zinc-200 bg-white !px-2 text-[12px] outline-none focus:border-[var(--os-brand-rail)]"
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-zinc-200 bg-white !p-3 text-[11px] leading-4 text-zinc-500">
              No custom fields are attached yet. Use the table column panel to add workspace fields, or save notes here.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

function ChecklistPanel({
  task,
  onTaskChange,
}: {
  task: TaskItem;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<ChecklistItem[]>(() => parseChecklistField(task.customFields?.checklist));

  useEffect(() => {
    setItems(parseChecklistField(task.customFields?.checklist));
  }, [task.customFields?.checklist]);

  const persist = (nextItems: ChecklistItem[]) => {
    setItems(nextItems);
    void onTaskChange(task.id, { customFields: { checklist: JSON.stringify(nextItems) } });
  };

  const addItem = () => {
    const label = draft.trim();
    if (!label) return;
    persist([...items, { id: createClientId(), label, done: false }]);
    setDraft("");
  };

  const completed = items.filter((item) => item.done).length;

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/40">
      <div className="flex h-10 items-center justify-between border-b border-zinc-200 !px-3">
        <h3 className="text-[13px] font-semibold text-zinc-900">Checklist</h3>
        <span className="text-[11px] text-zinc-500">{completed}/{items.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto !p-3 text-[12px]">
        <div className="flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white !px-2">
          <ClipboardList className="h-3.5 w-3.5 text-zinc-400" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addItem();
            }}
            placeholder="Add checklist item"
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-zinc-400"
          />
          <button
            type="button"
            className="rounded bg-zinc-100 !px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-200 disabled:opacity-40"
            disabled={!draft.trim()}
            onClick={addItem}
          >
            Add
          </button>
        </div>
        <div className="mt-3 space-y-1.5">
          {items.map((item) => (
            <div key={item.id} className="flex min-h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white !px-2 py-1.5">
              <button
                type="button"
                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  item.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 text-transparent"
                }`}
                onClick={() => persist(items.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry)))}
              >
                <Check className="h-3 w-3" />
              </button>
              <span className={`min-w-0 flex-1 truncate ${item.done ? "text-zinc-400 line-through" : "text-zinc-700"}`}>{item.label}</span>
              <button
                type="button"
                className="text-zinc-400 hover:text-zinc-700"
                onClick={() => persist(items.filter((entry) => entry.id !== item.id))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 bg-white !p-3 text-[11px] leading-4 text-zinc-500">
              Add checklist items to track smaller steps inside this task.
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function AddLinksPanel({
  task,
  onTaskChange,
}: {
  task: TaskItem;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [links, setLinks] = useState<string[]>(() => parseListField(task.customFields?.taskLinks));

  useEffect(() => {
    setLinks(parseListField(task.customFields?.taskLinks));
  }, [task.customFields?.taskLinks]);

  const addLink = () => {
    const nextUrl = url.trim();
    if (!nextUrl) return;
    const nextLinks = [...links, nextUrl];
    setLinks(nextLinks);
    void onTaskChange(task.id, { customFields: { taskLinks: JSON.stringify(nextLinks) } });
    setUrl("");
  };

  const removeLink = (link: string) => {
    const nextLinks = links.filter((item) => item !== link);
    setLinks(nextLinks);
    void onTaskChange(task.id, { customFields: { taskLinks: JSON.stringify(nextLinks) } });
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/40">
      <div className="flex h-10 items-center border-b border-zinc-200 !px-3">
        <h3 className="text-[13px] font-semibold text-zinc-900">Add a link to this task</h3>
      </div>
      <div className="!p-3 text-[12px]">
        <p className="mb-1.5 text-[11px] font-medium text-zinc-500">Add a link</p>
        <div className="flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white !px-2">
          <Link2 className="h-3.5 w-3.5 text-zinc-400" />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addLink();
            }}
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-zinc-400"
            placeholder="Paste URL"
          />
          <button
            type="button"
            className="rounded bg-zinc-100 !px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-200 disabled:opacity-40"
            disabled={!url.trim()}
            onClick={addLink}
          >
            Add
          </button>
        </div>
        {links.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {links.map((link) => (
              <div key={link} className="flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white !px-2 text-[12px] text-zinc-700">
                <Link2 className="h-3.5 w-3.5 text-zinc-500" />
                <span className="min-w-0 flex-1 truncate">{link}</span>
                <button type="button" className="text-zinc-400 hover:text-zinc-700" onClick={() => removeLink(link)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
          {["#7C3AED", "#F43F5E", "#0EA5E9", "#18181B", "#22C55E", "#2563EB"].map((color) => (
            <span key={color} className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
          ))}
          <span>and more</span>
          <ChevronRight className="h-3 w-3" />
        </div>
        <p className="mb-2 mt-5 text-[11px] font-medium text-zinc-500">Or relate items</p>
        <div className="space-y-1">
          <LinkPanelItem Icon={GitBranch} label="Task or Doc" />
          <LinkPanelItem Icon={Workflow} label="Dependencies" />
          <LinkPanelItem Icon={Plus} label="Custom" />
        </div>
      </div>
    </aside>
  );
}

function LinkPanelItem({ Icon, label }: { Icon: LucideIcon; label: string }) {
  return (
    <button type="button" className="flex h-7 w-full items-center gap-2 rounded-md !px-1 text-left text-[12px] text-zinc-700 hover:bg-zinc-100">
      <Icon className="h-3.5 w-3.5 text-zinc-500" />
      {label}
    </button>
  );
}

function TaskDetailField({
  Icon,
  label,
  children,
}: {
  Icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-4">
      <span className="flex items-center gap-2 text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="min-w-0 text-zinc-600">{children}</span>
    </div>
  );
}

function FieldsPanel({
  columns,
  fieldMode,
  onFieldModeChange,
  onToggleColumn,
  onHideColumns,
  onCreateColumn,
  onClose,
}: {
  columns: ColumnDef[];
  fieldMode: FieldMode;
  onFieldModeChange: (mode: FieldMode) => void;
  onToggleColumn: (key: string) => void;
  onHideColumns: () => void;
  onCreateColumn: (label: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (label: string) => !normalizedQuery || label.toLowerCase().includes(normalizedQuery);
  const shown = columns.filter((column) => column.visible && matchesQuery(column.label));
  const hidden = columns.filter((column) => !column.visible && matchesQuery(column.label));
  const fieldTypes = CREATE_FIELD_TYPES.filter((field) => matchesQuery(field.label));

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-zinc-200 bg-white">
      <PanelHeader title="Fields" onClose={onClose} />
      <div className="border-b border-zinc-100 !p-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for new or existing fields"
          className="h-8 w-full rounded-md border border-[color-mix(in_srgb,var(--os-brand-rail)_35%,#e4e4e7)] bg-white !px-2 text-[12px] outline-none focus:border-[var(--os-brand-rail)]"
        />
        <div className="mt-1.5 flex gap-4 text-[12px]">
          <button
            type="button"
            className={`border-b-2 pb-1 ${fieldMode === "create" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500"}`}
            onClick={() => onFieldModeChange("create")}
          >
            Create new
          </button>
          <button
            type="button"
            className={`border-b-2 pb-1 ${fieldMode === "existing" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500"}`}
            onClick={() => onFieldModeChange("existing")}
          >
            Add existing
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {fieldMode === "existing" ? (
          <>
            <FieldSection title="Shown" trailing="Hide all" onTrailingClick={onHideColumns}>
              {shown.map((column) => (
                <FieldToggle key={column.key} column={column} checked onToggle={() => onToggleColumn(column.key)} />
              ))}
            </FieldSection>
            <FieldSection title="Hidden">
              {hidden.map((column) => (
                <FieldToggle key={column.key} column={column} checked={false} onToggle={() => onToggleColumn(column.key)} />
              ))}
            </FieldSection>
          </>
        ) : (
          <>
            <FieldSection title="Create new">
              {fieldTypes.slice(0, 3).map((field) => (
                <CreateFieldRow key={field.label} field={field} onCreate={() => onCreateColumn(field.label)} />
              ))}
            </FieldSection>
            <FieldSection title="AI fields">
              {fieldTypes.slice(3, 6).map((field) => (
                <CreateFieldRow key={field.label} field={field} onCreate={() => onCreateColumn(field.label)} />
              ))}
            </FieldSection>
            <FieldSection title="All">
              {fieldTypes.slice(6).map((field) => (
                <CreateFieldRow key={field.label} field={field} onCreate={() => onCreateColumn(field.label)} />
              ))}
            </FieldSection>
          </>
        )}
      </div>
    </aside>
  );
}

function ColumnMenuPopover({
  columns,
  fieldMode,
  onFieldModeChange,
  onToggleColumn,
  onHideColumns,
  onCreateColumn,
  onClose,
}: {
  columns: ColumnDef[];
  fieldMode: FieldMode;
  onFieldModeChange: (mode: FieldMode) => void;
  onToggleColumn: (key: string) => void;
  onHideColumns: () => void;
  onCreateColumn: (label: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (label: string) => !normalizedQuery || label.toLowerCase().includes(normalizedQuery);
  const shown = columns.filter((column) => column.visible && matchesQuery(column.label));
  const hidden = columns.filter((column) => !column.visible && matchesQuery(column.label));
  const fieldTypes = CREATE_FIELD_TYPES.filter((field) => matchesQuery(field.label));

  return (
    <>
      <div className="fixed inset-0 z-[75]" onClick={onClose} aria-hidden />
      <div className="absolute right-0 top-7 z-[80] flex w-[300px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl">
        <div className="border-b border-zinc-100 !p-2">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for new or existing fields"
            className="h-8 w-full rounded-md border border-[color-mix(in_srgb,var(--os-brand-rail)_35%,#e4e4e7)] bg-white !px-2 text-[12px] outline-none focus:border-[var(--os-brand-rail)]"
            autoFocus
          />
          <div className="mt-1.5 flex gap-4 text-[12px]">
            <button
              type="button"
              className={`border-b-2 pb-1 ${fieldMode === "create" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500"}`}
              onClick={() => onFieldModeChange("create")}
            >
              Create new
            </button>
            <button
              type="button"
              className={`border-b-2 pb-1 ${fieldMode === "existing" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500"}`}
              onClick={() => onFieldModeChange("existing")}
            >
              Add existing
            </button>
          </div>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {fieldMode === "existing" ? (
            <>
              <FieldSection title="Shown" trailing="Hide all" onTrailingClick={onHideColumns}>
                {shown.map((column) => (
                  <FieldToggle key={column.key} column={column} checked onToggle={() => onToggleColumn(column.key)} />
                ))}
              </FieldSection>
              <FieldSection title="Hidden">
                {hidden.map((column) => (
                  <FieldToggle key={column.key} column={column} checked={false} onToggle={() => onToggleColumn(column.key)} />
                ))}
              </FieldSection>
            </>
          ) : (
            <>
              <FieldSection title="Create new">
                {fieldTypes.slice(0, 3).map((field) => (
                  <CreateFieldRow key={field.label} field={field} onCreate={() => onCreateColumn(field.label)} />
                ))}
              </FieldSection>
              <FieldSection title="AI fields">
                {fieldTypes.slice(3, 6).map((field) => (
                  <CreateFieldRow key={field.label} field={field} onCreate={() => onCreateColumn(field.label)} />
                ))}
              </FieldSection>
              <FieldSection title="All">
                {fieldTypes.slice(6).map((field) => (
                  <CreateFieldRow key={field.label} field={field} onCreate={() => onCreateColumn(field.label)} />
                ))}
              </FieldSection>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function CustomizePanel({
  activeView,
  groupBy,
  subtasksCollapsed,
  shownCount,
  options,
  onToggleOption,
  onTogglePin,
  onOpenFilter,
  onOpenFields,
  onOpenGroup,
  onToggleSubtasks,
  showClosed,
  onToggleClosed,
  onExport,
  onClose,
}: {
  activeView: ViewDef;
  groupBy: GroupKey;
  subtasksCollapsed: boolean;
  shownCount: number;
  options: ViewOptions;
  onToggleOption: (key: keyof ViewOptions) => void;
  onTogglePin: () => void;
  onOpenFilter: () => void;
  onOpenFields: () => void;
  onOpenGroup: () => void;
  onToggleSubtasks: () => void;
  showClosed: boolean;
  onToggleClosed: () => void;
  onExport: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-zinc-200 bg-white">
      <PanelHeader title="Customize view" onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-1 border-b border-zinc-100 !p-2">
          <SettingToggle label="Show empty statuses" checked={options.showEmptyStatuses} onToggle={() => onToggleOption("showEmptyStatuses")} />
          <SettingToggle label="Wrap text" checked={options.wrapText} onToggle={() => onToggleOption("wrapText")} />
          <SettingToggle label="Show task locations" checked={options.showTaskLocations} onToggle={() => onToggleOption("showTaskLocations")} />
          <SettingToggle label="Show subtask parent names" checked={options.showSubtaskParentNames} onToggle={() => onToggleOption("showSubtaskParentNames")} />
          <SettingToggle label="Show closed tasks" checked={showClosed} onToggle={onToggleClosed} />
          <SettingRow label="More options" />
        </div>
        <div className="border-b border-zinc-100 !p-2">
          <PanelAction Icon={Columns3} label="Fields" value={`${shownCount} shown`} onClick={onOpenFields} />
          <PanelAction Icon={ListFilter} label="Filter" value="None" onClick={onOpenFilter} />
          <PanelAction Icon={Layers} label="Group" value={getGroupName(groupBy)} onClick={onOpenGroup} />
          <PanelAction Icon={GitBranch} label="Subtasks" value={subtasksCollapsed ? "Collapsed" : "Expanded"} onClick={onToggleSubtasks} />
        </div>
        <div className="!p-2">
          <PanelAction Icon={Star} label="Favorite" value={activeView.pinned ? "On" : undefined} onClick={onTogglePin} />
          <PanelAction Icon={Download} label="Export view" onClick={onExport} />
        </div>
      </div>
    </aside>
  );
}

function GroupMenu({
  value,
  direction,
  alsoGroupByList,
  onChange,
  onDirectionChange,
  onAlsoGroupByListChange,
  onClear,
  onClose,
}: {
  value: GroupKey;
  direction: GroupDir;
  alsoGroupByList: boolean;
  onChange: (value: GroupKey) => void;
  onDirectionChange: (value: GroupDir) => void;
  onAlsoGroupByListChange: (value: boolean) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [fieldOpen, setFieldOpen] = useState(false);
  const [dirOpen, setDirOpen] = useState(false);
  const fieldLabel = GROUP_OPTIONS.find((o) => o.key === value)?.label ?? "None";

  return (
    <>
      <div className="fixed inset-0 z-[65]" onClick={onClose} aria-hidden />
      <div className="absolute left-0 top-7 z-[70] w-[300px] rounded-xl border border-zinc-200 bg-white !p-3 shadow-2xl">
        <PanelLabel>Group by</PanelLabel>
        <div className="mt-1 flex items-center gap-2">
          {/* Field dropdown */}
          <div className="relative flex-1">
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md border border-zinc-200 !px-2 text-left text-[13px] text-zinc-800 hover:bg-zinc-50"
              onClick={() => { setFieldOpen((o) => !o); setDirOpen(false); }}
            >
              <CalendarDays className="h-3.5 w-3.5 text-zinc-500" />
              <span className="flex-1 truncate">{fieldLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            {fieldOpen ? (
              <div className="absolute left-0 top-9 z-[72] w-full overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-xl">
                {GROUP_OPTIONS.filter((o) => o.key !== "none").map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`flex h-8 w-full items-center gap-2 !px-2 text-left text-[13px] ${
                      value === option.key ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                    }`}
                    onClick={() => { onChange(option.key); setFieldOpen(false); }}
                  >
                    <option.Icon className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="flex-1">{option.label}</span>
                    {value === option.key ? <Check className="h-4 w-4 text-zinc-600" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Direction dropdown */}
          <div className="relative w-[120px]">
            <button
              type="button"
              className="flex h-8 w-full items-center gap-1 rounded-md border border-zinc-200 !px-2 text-left text-[13px] text-zinc-800 hover:bg-zinc-50"
              onClick={() => { setDirOpen((o) => !o); setFieldOpen(false); }}
            >
              <span className="flex-1 truncate">{direction === "asc" ? "Ascending" : "Descending"}</span>
              <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            {dirOpen ? (
              <div className="absolute right-0 top-9 z-[72] w-full overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-xl">
                {(["asc", "desc"] as GroupDir[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`flex h-8 w-full items-center gap-2 !px-2 text-left text-[13px] ${
                      direction === d ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                    }`}
                    onClick={() => { onDirectionChange(d); setDirOpen(false); }}
                  >
                    <span className="flex-1">{d === "asc" ? "Ascending" : "Descending"}</span>
                    {direction === d ? <Check className="h-4 w-4 text-zinc-600" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-red-500"
            aria-label="Remove grouping"
            onClick={onClear}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2">
          <span className="text-[13px] text-zinc-700">Also group by List</span>
          <button
            type="button"
            role="switch"
            aria-checked={alsoGroupByList}
            onClick={() => onAlsoGroupByListChange(!alsoGroupByList)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${alsoGroupByList ? "bg-[var(--os-brand)] border-[var(--os-brand)]" : "bg-zinc-200 border-zinc-300"}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${alsoGroupByList ? "translate-x-[18px]" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>
    </>
  );
}

function GroupOptionsMenu({
  groupLabel,
  groupName,
  onSelectAll,
  onCollapseGroup,
  onCollapseAll,
  onClose,
}: {
  groupLabel: string;
  groupName: string;
  onSelectAll: () => void;
  onCollapseGroup: () => void;
  onCollapseAll: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[75]" onClick={onClose} aria-hidden />
      <div className="absolute left-0 top-7 z-[80] w-[260px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl">
        <div className="!px-4 py-3 text-[12px] font-medium text-zinc-500">Group options</div>
        <div className="!px-2 pb-2">
          <GroupOptionsItem Icon={CheckCircle2} label="Select all" onClick={onSelectAll} />
          <GroupOptionsItem Icon={ChevronRight} label="Collapse group" onClick={onCollapseGroup} rotate />
          <GroupOptionsItem Icon={Columns3} label="Collapse all groups" onClick={onCollapseAll} />
        </div>
        <div className="border-t border-zinc-100 !px-2 py-2">
          <GroupOptionsItem Icon={Zap} label={`Automate ${groupName || groupLabel.toLowerCase()}`} onClick={onClose} />
        </div>
      </div>
    </>
  );
}

function GroupOptionsItem({
  Icon,
  label,
  rotate,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  rotate?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-8 w-full items-center gap-2 rounded-md !px-2 text-left text-[13px] text-zinc-800 hover:bg-zinc-50"
      onClick={onClick}
    >
      <Icon className={`h-3.5 w-3.5 text-zinc-500 ${rotate ? "-rotate-90" : ""}`} />
      {label}
    </button>
  );
}

interface SavedFilter {
  name: string;
  filters: FilterRule[];
  connector: FilterConnector;
}
const SAVED_FILTERS_KEY = "workwrk:task-saved-filters";
function loadSavedFilters(): SavedFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_FILTERS_KEY);
    return raw ? (JSON.parse(raw) as SavedFilter[]) : [];
  } catch { return []; }
}
function writeSavedFilters(list: SavedFilter[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function FilterMenu({
  filters,
  connector,
  sortKey,
  onFiltersChange,
  onConnectorChange,
  onSortChange,
  onClose,
}: {
  filters: FilterRule[];
  connector: FilterConnector;
  sortKey: TaskSortKey;
  onFiltersChange: (next: FilterRule[]) => void;
  onConnectorChange: (next: FilterConnector) => void;
  onSortChange: (value: TaskSortKey) => void;
  onClose: () => void;
}) {
  const [savedOpen, setSavedOpen] = useState(false);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [saveName, setSaveName] = useState("");
  useEffect(() => { setSaved(loadSavedFilters()); }, []);

  const addFilter = () => {
    const field: FilterField = "status";
    const meta = filterFieldMeta(field);
    onFiltersChange([...filters, { id: createClientId(), field, operator: meta.operators[0], value: "" }]);
  };
  const updateFilter = (id: string, patch: Partial<FilterRule>) =>
    onFiltersChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeFilter = (id: string) => onFiltersChange(filters.filter((f) => f.id !== id));

  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name || filters.length === 0) return;
    const next = [...saved.filter((s) => s.name !== name), { name, filters, connector }];
    setSaved(next);
    writeSavedFilters(next);
    setSaveName("");
  };
  const applySaved = (s: SavedFilter) => {
    onFiltersChange(s.filters.map((f) => ({ ...f, id: createClientId() })));
    onConnectorChange(s.connector);
    setSavedOpen(false);
  };
  const deleteSaved = (name: string) => {
    const next = saved.filter((s) => s.name !== name);
    setSaved(next);
    writeSavedFilters(next);
  };

  return (
    <>
      <div className="fixed inset-0 z-[75]" onClick={onClose} aria-hidden />
      <div className="absolute right-0 top-7 z-[80] w-[480px] rounded-xl border border-zinc-200 bg-white !p-3 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-zinc-800">
            Filters <Info className="h-3.5 w-3.5 text-zinc-400" />
          </span>
          <div className="relative">
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 !px-2 text-[12px] text-zinc-600 hover:bg-zinc-50"
              onClick={() => setSavedOpen((o) => !o)}
            >
              Saved filters <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {savedOpen ? (
              <div className="absolute right-0 top-9 z-[82] w-[260px] rounded-lg border border-zinc-200 bg-white !p-2 shadow-xl">
                {saved.length === 0 ? (
                  <p className="!px-1 py-1 text-[12px] text-zinc-400">No saved filters yet.</p>
                ) : (
                  <ul className="mb-2 space-y-0.5">
                    {saved.map((s) => (
                      <li key={s.name} className="group flex items-center gap-2 rounded-md !px-2 py-1 hover:bg-zinc-50">
                        <button type="button" className="flex-1 truncate text-left text-[12.5px] text-zinc-700" onClick={() => applySaved(s)}>
                          {s.name}
                        </button>
                        <button type="button" className="text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-500" aria-label="Delete saved filter" onClick={() => deleteSaved(s.name)}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-1.5 border-t border-zinc-100 pt-2">
                  <input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveCurrent(); }}
                    placeholder="Save current as…"
                    className="h-7 flex-1 rounded-md border border-zinc-200 !px-2 text-[12px] outline-none"
                  />
                  <button
                    type="button"
                    onClick={saveCurrent}
                    disabled={!saveName.trim() || filters.length === 0}
                    className="h-7 rounded-md bg-zinc-900 !px-2 text-[12px] font-medium text-white disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {filters.length === 0 ? (
          <p className="!px-1 py-2 text-[12px] text-zinc-400">No filters yet. Add one to narrow this view.</p>
        ) : (
          <div className="space-y-2">
            {filters.map((rule, idx) => (
              <FilterRuleRow
                key={rule.id}
                rule={rule}
                index={idx}
                connector={connector}
                onConnectorChange={onConnectorChange}
                onChange={(patch) => updateFilter(rule.id, patch)}
                onRemove={() => removeFilter(rule.id)}
              />
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between">
          <button type="button" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--os-brand-rail)] hover:opacity-80" onClick={addFilter}>
            <Plus className="h-3.5 w-3.5" /> Add filter
          </button>
          {filters.length > 0 ? (
            <button type="button" className="text-[12px] font-medium text-red-500 hover:text-red-600" onClick={() => onFiltersChange([])}>
              Clear all
            </button>
          ) : null}
        </div>

        {/* Sort — kept so ordering stays reachable (not part of the rule list). */}
        <div className="mt-3 border-t border-zinc-100 pt-2">
          <PanelLabel>Sort by</PanelLabel>
          <div className="flex flex-wrap gap-1">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`inline-flex h-7 items-center gap-1 rounded-md !px-2 text-[12px] ${
                  sortKey === option.key ? "bg-zinc-900 text-white" : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                }`}
                onClick={() => onSortChange(option.key)}
              >
                <option.Icon className="h-3 w-3" />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function FilterRuleRow({
  rule,
  index,
  connector,
  onConnectorChange,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  index: number;
  connector: FilterConnector;
  onConnectorChange: (next: FilterConnector) => void;
  onChange: (patch: Partial<FilterRule>) => void;
  onRemove: () => void;
}) {
  const meta = filterFieldMeta(rule.field);
  const needsValue = !VALUELESS_OPERATORS.includes(rule.operator);
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 shrink-0 text-[12px] text-zinc-500">
        {index === 0 ? (
          <span className="!pl-1">Where</span>
        ) : (
          <select
            value={connector}
            onChange={(e) => onConnectorChange(e.target.value as FilterConnector)}
            className="h-7 w-full rounded-md border border-zinc-200 bg-white text-[12px] text-zinc-700"
          >
            <option value="AND">AND</option>
            <option value="OR">OR</option>
          </select>
        )}
      </div>
      <select
        value={rule.field}
        onChange={(e) => {
          const field = e.target.value as FilterField;
          const m = filterFieldMeta(field);
          onChange({ field, operator: m.operators[0], value: "" });
        }}
        className="h-7 flex-1 rounded-md border border-zinc-200 bg-white !px-1.5 text-[12px] text-zinc-800"
      >
        {FILTER_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      <select
        value={rule.operator}
        onChange={(e) => onChange({ operator: e.target.value as FilterOperator })}
        className="h-7 w-24 shrink-0 rounded-md border border-zinc-200 bg-white !px-1.5 text-[12px] text-zinc-800"
      >
        {meta.operators.map((op) => <option key={op} value={op}>{FILTER_OPERATOR_LABELS[op]}</option>)}
      </select>
      {needsValue ? (
        meta.valueKind === "status" ? (
          <select value={rule.value} onChange={(e) => onChange({ value: e.target.value })} className="h-7 flex-1 rounded-md border border-zinc-200 bg-white !px-1.5 text-[12px]">
            <option value="">Select…</option>
            {STATUS_COLUMNS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        ) : meta.valueKind === "priority" ? (
          <select value={rule.value} onChange={(e) => onChange({ value: e.target.value })} className="h-7 flex-1 rounded-md border border-zinc-200 bg-white !px-1.5 text-[12px]">
            <option value="">Select…</option>
            {["Urgent", "High", "Normal", "Low"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : (
          <input value={rule.value} onChange={(e) => onChange({ value: e.target.value })} placeholder="Value" className="h-7 flex-1 rounded-md border border-zinc-200 bg-white !px-2 text-[12px] outline-none" />
        )
      ) : (
        <span className="flex-1" />
      )}
      <button type="button" onClick={onRemove} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-red-500" aria-label="Remove filter">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ToolbarIconButton({
  Icon,
  label,
  onClick,
  active,
  framed,
}: {
  Icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  framed?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
      } ${framed ? "border border-zinc-200" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function TagEditorPopover({
  tags,
  query,
  onQueryChange,
  onCreate,
  onRemove,
  onClose,
}: {
  tags: string[];
  query: string;
  onQueryChange: (value: string) => void;
  onCreate: () => void;
  onRemove: (tag: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[84]" onClick={onClose} aria-hidden />
      <div
        className="absolute left-0 top-7 z-[90] w-[220px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCreate();
        }}
        className="h-8 w-full border-b border-zinc-100 !px-2 text-[12px] outline-none"
        placeholder="Search or create tag"
        autoFocus
      />
      <div className="!p-1.5">
        {tags.length > 0 ? (
          <div className="mb-1 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="inline-flex h-6 items-center gap-1 rounded-full bg-violet-50 !px-2 text-[11px] text-violet-700 hover:bg-violet-100"
                onClick={() => onRemove(tag)}
              >
                {tag}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 rounded-md !px-2 text-left text-[12px] text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-400"
          disabled={!query.trim()}
          onClick={onCreate}
        >
          <Tag className="h-3.5 w-3.5 text-zinc-500" />
          Create {query.trim() ? <span className="rounded-full bg-violet-100 !px-1.5 text-violet-700">{query.trim()}</span> : "tag"}
        </button>
      </div>
    </div>
    </>
  );
}

function CustomFieldPopover({
  label,
  value,
  onChange,
  onSave,
  onClear,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <form
      className="absolute left-0 top-7 z-[90] w-[240px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="border-b border-zinc-100 !px-2.5 py-2 text-[11px] font-medium text-zinc-500">
        {label}
      </div>
      <div className="!p-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClear();
          }}
          placeholder={`Add ${label.toLowerCase()}`}
          className="h-8 w-full rounded-md border border-zinc-200 !px-2 text-[12px] outline-none focus:border-[var(--os-brand-rail)]"
          autoFocus
        />
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <button
            type="button"
            className="h-7 rounded-md !px-2 text-[11px] text-zinc-500 hover:bg-zinc-100"
            onClick={onClear}
          >
            Clear
          </button>
          <button
            type="submit"
            className="h-7 rounded-md bg-[var(--os-brand-rail)] !px-2.5 text-[11px] font-medium text-white"
          >
            Save
          </button>
        </div>
      </div>
    </form>
  );
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-100 !px-3">
      <h2 className="text-[13px] font-semibold text-zinc-900">{title}</h2>
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 hover:text-zinc-900"
        aria-label={`Close ${title}`}
        onClick={onClose}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FieldSection({
  title,
  trailing,
  onTrailingClick,
  children,
}: {
  title: string;
  trailing?: string;
  onTrailingClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-zinc-100 !px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between text-[10px] font-medium text-zinc-500">
        <span>{title}</span>
        {trailing ? (
          <button
            type="button"
            className="rounded px-1 hover:bg-zinc-100 hover:text-zinc-800"
            onClick={onTrailingClick}
          >
            {trailing}
          </button>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

function FieldToggle({ column, checked, onToggle }: { column: ColumnDef; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-2 rounded-md !px-1.5 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
      onClick={onToggle}
      disabled={column.key === "name"}
    >
      <column.Icon className="h-3 w-3 text-zinc-500" />
      <span className="min-w-0 flex-1 truncate">{column.label}</span>
      {column.key === "taskType" ? <span className="rounded bg-fuchsia-100 !px-1 text-[10px] font-medium text-fuchsia-700">New</span> : null}
      <Switch checked={checked} disabled={column.key === "name"} />
    </button>
  );
}

function CreateFieldRow({
  field,
  onCreate,
}: {
  field: { label: string; Icon: LucideIcon; color: string };
  onCreate: () => void;
}) {
  return (
    <button
      type="button"
      className="group flex h-7 w-full items-center gap-2 rounded-md !px-1.5 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
      onClick={onCreate}
    >
      <field.Icon className="h-3 w-3" style={{ color: field.color }} />
      <span className="min-w-0 flex-1 truncate">{field.label}</span>
      <span className="hidden text-[11px] text-zinc-500 group-hover:inline">Create</span>
    </button>
  );
}

function PanelAction({
  Icon,
  label,
  value,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  value?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-2 rounded-md !px-1.5 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
      onClick={onClick}
    >
      <Icon className="h-3 w-3 text-zinc-500" />
      <span className="flex-1">{label}</span>
      {value ? <span className="text-zinc-400">{value}</span> : null}
      <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
    </button>
  );
}

function SettingRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex h-6 items-center justify-between text-[12px] text-zinc-700">
      <span>{label}</span>
      {value ? <span className="text-zinc-400">{value}</span> : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
    </div>
  );
}

function SettingToggle({ label, checked, onToggle }: { label: string; checked: boolean; onToggle?: () => void }) {
  return (
    <button
      type="button"
      className="flex h-6 w-full items-center justify-between rounded-md text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
      onClick={onToggle}
    >
      <span>{label}</span>
      <Switch checked={checked} />
    </button>
  );
}

function Switch({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      className={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
        checked ? "bg-[var(--os-brand)] border-[var(--os-brand)]" : "bg-zinc-200 border-zinc-300"
      } ${disabled ? "opacity-50" : ""}`}
      aria-hidden
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </span>
  );
}

function Checkbox({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--os-brand-rail)]"
      />
      {label}
    </label>
  );
}

function PanelLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-[11px] font-medium text-zinc-500">{children}</div>;
}

// Date-bucket group headers render as colored text (ClickUp style),
// e.g. "Overdue" in red. Status groups keep the solid colored pill.
const DATE_GROUP_COLORS: Record<string, string> = {
  Overdue: "#EF4444",
  Today: "#16A34A",
  Tomorrow: "#2563EB",
  Upcoming: "#71717A",
  "No due date": "#A1A1AA",
};

function GroupBadge({ label }: { label: string }) {
  const status = STATUS_COLUMNS.find((item) => item.label === label);
  if (status) {
    return (
      <span
        className="inline-flex h-6 items-center rounded-md !px-2 text-[12px] font-semibold text-white"
        style={{ backgroundColor: status.color }}
      >
        {label}
      </span>
    );
  }
  const color = DATE_GROUP_COLORS[label];
  if (color) {
    return <span className="text-[13px] font-semibold" style={{ color }}>{label}</span>;
  }
  return <span className="text-[13px] font-semibold text-zinc-700">{label}</span>;
}

function renderTaskValue(task: TaskItem, column: ColumnDef) {
  switch (column.key) {
    case "assignee":
      return task.assignee ? (
        <span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{task.assignee}</span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-zinc-400 opacity-0 group-hover:opacity-100">
          <UserRound className="h-4 w-4" />
          <Plus className="-ml-1 h-3 w-3" />
        </span>
      );
    case "dueDate":
      return task.dueDate ? (
        <span className="text-red-500">{task.dueDate}</span>
      ) : (
        <CalendarDays className="h-4 w-4 text-zinc-400 opacity-0 group-hover:opacity-100" />
      );
    case "priority":
      return task.priority ? <PriorityBadge priority={task.priority} /> : <Flag className="h-4 w-4 text-zinc-400 opacity-0 group-hover:opacity-100" />;
    case "dateCreated":
      return task.dateCreated;
    case "status":
      return statusLabel(task.status);
    case "name":
      return task.name || "Untitled";
    case "tags":
      return task.tags.length ? task.tags.join(", ") : "—";
    case "taskType":
      return task.taskType;
    case "comments":
    case "assignedComments":
      return task.comments;
    case "latestComment":
      return task.comments ? "Latest reply" : "—";
    case "linkedDocs":
    case "notes":
      return (
        <button type="button" className="text-zinc-400 hover:text-[var(--os-brand-rail)]">
          Add note
        </button>
      );
    default:
      return "—";
  }
}

function PriorityBadge({ priority }: { priority: TaskItem["priority"] }) {
  return <span className={priorityColorClass(priority)}>{priority}</span>;
}

function priorityColorClass(priority: TaskPriority) {
  if (priority === "Urgent") return "text-red-600";
  if (priority === "High") return "text-orange-600";
  if (priority === "Low") return "text-zinc-500";
  return "text-zinc-600";
}

function getGroupLabel(task: TaskItem, key: GroupKey) {
  switch (key) {
    case "name":
      return task.name || "Untitled";
    case "status":
      return statusLabel(task.status);
    case "assignee":
      return task.assignee || "Unassigned";
    case "priority":
      return task.priority || "No priority";
    case "tags":
      return task.tags[0] ?? "No tag";
    case "dueDate":
      return dueDateGroupLabel(task.dueDate);
    case "taskType":
      return task.taskType || "Task";
    case "none":
      return "None";
  }
}

function shouldShowDraftInGroup(draftTask: DraftTask, key: GroupKey, label: string) {
  switch (key) {
    case "status":
      return statusLabel(draftTask.status) === label;
    case "name":
      return (draftTask.name || "Untitled") === label;
    case "assignee":
      return (draftTask.assignee || "Unassigned") === label;
    case "priority":
      return (draftTask.priority || "No priority") === label;
    case "tags":
      return (draftTask.tags[0] ?? "No tag") === label;
    case "dueDate":
      return dueDateGroupLabel(draftTask.dueDate) === label;
    case "taskType":
      return (draftTask.taskType || "Task") === label;
    case "none":
      return true;
  }
}

function getGroupName(key: GroupKey) {
  return GROUP_OPTIONS.find((option) => option.key === key)?.label ?? "None";
}

function sortTasks(tasks: TaskItem[], sortKey: TaskSortKey) {
  if (sortKey === "none") return tasks;

  return [...tasks].sort((first, second) => {
    if (sortKey === "priority") return priorityRank(second.priority) - priorityRank(first.priority);
    if (sortKey === "dueDate") return dueDateSortValue(first.dueDate) - dueDateSortValue(second.dueDate);
    const firstValue = sortableValue(first, sortKey);
    const secondValue = sortableValue(second, sortKey);
    return firstValue.localeCompare(secondValue, undefined, { numeric: true, sensitivity: "base" });
  });
}

function sortableValue(task: TaskItem, sortKey: Exclude<TaskSortKey, "none" | "priority">) {
  if (sortKey === "name") return task.name;
  if (sortKey === "dueDate") return task.dueDate;
  return task.dateCreated;
}

function priorityRank(priority: TaskPriority) {
  if (priority === "Urgent") return 4;
  if (priority === "High") return 3;
  if (priority === "Normal") return 2;
  if (priority === "Low") return 1;
  return 0;
}

function statusLabel(status: TaskItem["status"]) {
  if (status === "to_do") return "TO DO";
  if (status === "in_progress") return "IN PROGRESS";
  return "COMPLETE";
}

function getStatusMeta(status: TaskItem["status"]) {
  return STATUS_COLUMNS.find((item) => item.key === status) ?? STATUS_COLUMNS[0];
}

function statusFromGroup(label: string): TaskItem["status"] {
  if (label === "IN PROGRESS") return "in_progress";
  if (label === "COMPLETE") return "complete";
  return "to_do";
}

function dueDateGroupLabel(dueDate: string) {
  if (!dueDate) return "No due date";
  if (dueDate === "Today") return "Today";
  if (dueDate === "Tomorrow") return "Tomorrow";
  const parsedDate = parseTaskDisplayDate(dueDate);
  if (!parsedDate) return dueDate === "Yesterday" ? "Overdue" : "Upcoming";
  return parsedDate.getTime() < startOfDay(new Date()).getTime() ? "Overdue" : "Upcoming";
}

function dueDateSortValue(dueDate: string) {
  if (!dueDate) return Number.MAX_SAFE_INTEGER;
  const parsedDate = parseTaskDisplayDate(dueDate);
  return parsedDate?.getTime() ?? Number.MAX_SAFE_INTEGER - 1;
}

function parseTaskDisplayDate(value: string) {
  if (!value) return null;
  const today = startOfDay(new Date());
  if (value === "Today") return today;
  if (value === "Tomorrow") return addDays(today, 1);
  if (value === "Yesterday") return addDays(today, -1);

  const directDate = new Date(value);
  if (!Number.isNaN(directDate.getTime())) return startOfDay(directDate);

  const shortDate = value.match(/^([A-Z][a-z]{2}) (\d{1,2})$/);
  if (!shortDate) return null;
  const parsedDate = new Date(`${shortDate[1]} ${shortDate[2]}, ${today.getFullYear()}`);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return startOfDay(parsedDate);
}

function getCalendarBucket(dueDate: string) {
  if (!dueDate) return "No date";
  if (dueDate === "Today") return "Today";
  if (dueDate === "Tomorrow") return "Tomorrow";
  if (dueDate === "Yesterday") return "Later";
  if (/^[A-Z][a-z]{2} \d{1,2}$/.test(dueDate)) return "This week";
  return "Later";
}

function filterViews(views: ViewDef[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return views;
  return views.filter((view) => `${view.label} ${view.tag ?? ""}`.toLowerCase().includes(normalized));
}

function dedupeViews(views: ViewDef[]) {
  const seen = new Set<string>();
  return views.filter((view) => {
    const signature = viewSignature(view);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function viewSignature(view: Pick<ViewDef, "kind" | "label">) {
  return `${view.kind}:${view.label.trim().toLowerCase()}`;
}

async function readApiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: unknown };
    return typeof data.error === "string" ? data.error : fallback;
  } catch {
    return fallback;
  }
}

function mergeCustomFields(
  current: TaskItem["customFields"] = {},
  patch: Record<string, string | number | boolean | null>,
) {
  const next = { ...current };
  for (const [key, rawValue] of Object.entries(patch)) {
    const value = rawValue == null ? "" : String(rawValue).trim();
    if (value) next[key] = value;
    else delete next[key];
  }
  return next;
}

function makeCustomFieldKey(label: string) {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeBase = base || "custom_field";
  return /^[a-z]/.test(safeBase) ? safeBase : `field_${safeBase}`;
}

function customFieldTypeForLabel(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("date")) return "DATE";
  if (normalized.includes("number") || normalized.includes("money") || normalized.includes("rating") || normalized.includes("progress")) return "NUMBER";
  if (normalized.includes("checkbox")) return "CHECKBOX";
  if (normalized.includes("dropdown") || normalized.includes("label") || normalized.includes("people")) return "SELECT";
  if (normalized.includes("email")) return "EMAIL";
  if (normalized.includes("website")) return "URL";
  if (normalized.includes("notes") || normalized.includes("summary") || normalized.includes("text area")) return "TEXTAREA";
  return "TEXT";
}

function customFieldIcon(fieldType: string): LucideIcon {
  if (fieldType === "DATE") return CalendarDays;
  if (fieldType === "NUMBER") return Hash;
  if (fieldType === "CHECKBOX") return CheckCircle2;
  if (fieldType === "SELECT" || fieldType === "MULTI_SELECT") return Columns3;
  if (fieldType === "EMAIL") return Mail;
  if (fieldType === "URL") return Globe;
  if (fieldType === "TEXTAREA") return AlignLeft;
  return FileText;
}

function normalizeCustomFields(customFields: ApiTask["customFields"]) {
  if (!customFields) return undefined;
  const normalized: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(customFields)) {
    if (rawValue == null) continue;
    const value = String(rawValue).trim();
    if (value) normalized[key] = value;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function parseListField(value?: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split("\n").map((item) => item.trim()).filter(Boolean);
  }
}

function parseChecklistField(value?: string): ChecklistItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Partial<ChecklistItem>;
      const label = String(record.label ?? "").trim();
      if (!label) return [];
      return [{
        id: String(record.id ?? createClientId()),
        label,
        done: Boolean(record.done),
      }];
    });
  } catch {
    return value
      .split("\n")
      .map((label) => label.trim())
      .filter(Boolean)
      .map((label) => ({ id: createClientId(), label, done: false }));
  }
}

function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "U";
}

function mapApiPersonToAssigneeOption(person: ApiPerson): AssigneeOption {
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  const name = fullName || person.email || "Unnamed person";
  return {
    id: person.id,
    name,
    email: person.email ?? undefined,
    avatar: person.avatar ?? undefined,
    initials: initialsFromName(name),
  };
}

function commentAuthorName(comment: ApiTaskComment) {
  const name = [comment.author?.firstName, comment.author?.lastName].filter(Boolean).join(" ").trim();
  return name || "You";
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function mapApiTaskToTaskItem(task: ApiTask): TaskItem {
  const taskDate = new Date(task.date);
  return {
    id: task.id,
    name: task.title || "Untitled",
    description: task.description ?? undefined,
    status: apiStatusToUiStatus(task.status),
    assignee: formatAssigneeName(task.assignee),
    assigneeId: task.assignee?.id ?? undefined,
    dueDate: formatRelativeTaskDate(task.date),
    dueDateISO: Number.isNaN(taskDate.getTime()) ? undefined : formatDateInput(taskDate),
    priority: apiPriorityToUiPriority(task.priority),
    dateCreated: task.createdAt ? formatRelativeTaskDate(task.createdAt) : "Today",
    taskType: task.category || (task.parentTaskId ? "Subtask" : "Task"),
    tags: task.labels?.map((item) => item.label?.name).filter((name): name is string => Boolean(name)) ?? [],
    subtaskCount: task._count?.subTasks ?? 0,
    comments: task._count?.comments ?? 0,
    attachments: 0,
    parentId: task.parentTaskId ?? undefined,
    customFields: normalizeCustomFields(task.customFields),
  };
}

function apiStatusToUiStatus(status: ApiTask["status"]): TaskItem["status"] {
  if (status === "IN_PROGRESS") return "in_progress";
  if (status === "COMPLETED") return "complete";
  return "to_do";
}

function uiStatusToApiStatus(status: TaskItem["status"]) {
  if (status === "in_progress") return "IN_PROGRESS";
  if (status === "complete") return "COMPLETED";
  return "PLANNED";
}

function apiPriorityToUiPriority(priority: ApiTask["priority"]): TaskPriority {
  if (priority === "URGENT") return "Urgent";
  if (priority === "HIGH") return "High";
  if (priority === "NORMAL") return "Normal";
  if (priority === "LOW") return "Low";
  return "";
}

function uiPriorityToApiPriority(priority: TaskPriority) {
  if (priority === "Urgent") return "URGENT";
  if (priority === "High") return "HIGH";
  if (priority === "Normal") return "NORMAL";
  if (priority === "Low") return "LOW";
  return undefined;
}

function formatAssigneeName(assignee: ApiTask["assignee"]) {
  if (!assignee) return "";
  const fullName = [assignee.firstName, assignee.lastName].filter(Boolean).join(" ").trim();
  return fullName || assignee.email || "";
}

function formatRelativeTaskDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function displayDateToInputDate(value: string) {
  if (!value) return undefined;
  if (value === "Later") return formatDateInput(new Date());
  const parsedDate = parseTaskDisplayDate(value);
  return parsedDate ? formatDateInput(parsedDate) : undefined;
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCalendarLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatWeekday(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getNextSaturday(date: Date) {
  const daysUntilSaturday = (6 - date.getDay() + 7) % 7 || 7;
  return addDays(date, daysUntilSaturday);
}

function MultiSelectActionBar({
  count,
  onClear,
}: {
  count: number;
  onClear: () => void;
}) {
  return (
    <div className="fixed bottom-8 left-1/2 z-[100] flex h-12 -translate-x-1/2 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 !px-2.5 text-white shadow-2xl">
      <div className="flex h-8 items-center rounded-md bg-zinc-800 !px-3 text-[13px] font-medium text-white shadow-inner">
        {count} Task{count === 1 ? "" : "s"} selected
        <button type="button" onClick={onClear} className="ml-2 text-zinc-400 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mx-1.5 h-6 w-px bg-zinc-700" />
      <ActionPill Icon={CircleDashed} label="Status" />
      <ActionPill Icon={UserRound} label="Assignees" />
      <ActionPill Icon={CalendarIcon} label="Dates" />
      <ActionPill Icon={Columns3} label="Custom Fields" />
      <ActionPill Icon={Tag} label="Tags" />
      <ActionPill Icon={ArrowRightLeft} label="Move/Add" />
      <ActionPill Icon={GitBranch} label="Convert to Subtasks" />
      <ActionPill Icon={Copy} label="Copy" />
      <ActionPill Icon={MoreHorizontal} label="More" />
    </div>
  );
}

function ActionPill({ Icon, label, onClick }: { Icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      className="flex h-8 items-center gap-1.5 rounded-md !px-2 text-[12px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white"
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
