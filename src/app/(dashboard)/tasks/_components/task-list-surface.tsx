"use client";

import { Fragment, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import {
  Activity,
  AlignLeft,
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
  ClipboardList,
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
  SlidersHorizontal,
  Star,
  Table2,
  Tag,
  UserRound,
  Users,
  Workflow,
  X,
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
type TaskSortKey = "none" | "name" | "dueDate" | "dateCreated" | "priority";

interface ViewOptions {
  stackFields: boolean;
  showEmptyFields: boolean;
  collapseEmptyColumns: boolean;
  autosave: boolean;
  privateView: boolean;
  protectView: boolean;
  defaultView: boolean;
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
  status: "to_do" | "in_progress" | "complete";
  assignee: string;
  dueDate: string;
  priority: TaskPriority;
  dateCreated: string;
  taskType: string;
  tags: string[];
  subtaskCount: number;
  comments: number;
  attachments: number;
  parentId?: string;
}

interface DraftTask {
  name: string;
  status: TaskItem["status"];
  assignee: string;
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
  date: string;
  createdAt?: string;
  status?: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  category?: string | null;
  parentTaskId?: string | null;
  assignee?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null;
  labels?: { label?: { name?: string | null } | null }[];
  _count?: { subTasks?: number; comments?: number };
}

interface ApiLabel {
  id: string;
  name: string;
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

const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  stackFields: false,
  showEmptyFields: true,
  collapseEmptyColumns: false,
  autosave: false,
  privateView: false,
  protectView: false,
  defaultView: false,
};

const STATUS_COLUMNS = [
  { key: "to_do" as const, label: "TO DO", color: "#71717A", bg: "#F4F4F5" },
  { key: "in_progress" as const, label: "IN PROGRESS", color: "#6D4AFF", bg: "#F5F2FF" },
  { key: "complete" as const, label: "COMPLETE", color: "#16A34A", bg: "#F0FDF4" },
];

export function TaskListSurface() {
  const [views, setViews] = useState<ViewDef[]>(INITIAL_VIEWS);
  const [activeViewId, setActiveViewId] = useState("list");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [panel, setPanel] = useState<PanelKey>(null);
  const [fieldMode, setFieldMode] = useState<FieldMode>("existing");
  const [groupBy, setGroupBy] = useState<GroupKey>("none");
  const [subtasksCollapsed, setSubtasksCollapsed] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [columns, setColumns] = useState<ColumnDef[]>([...DEFAULT_COLUMNS, ...OPTIONAL_FIELDS]);
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
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<TaskSortKey>("none");
  const [viewOptions, setViewOptions] = useState<ViewOptions>(DEFAULT_VIEW_OPTIONS);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const visibleViews = useMemo(() => dedupeViews(views), [views]);
  const activeView = visibleViews.find((view) => view.id === activeViewId) ?? visibleViews[0];
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) ?? null : null;
  const visibleColumns = columns.filter((column) => column.visible);
  const tableColumns = visibleColumns.filter((column) => column.key !== "name");
  const tableTemplate = useMemo(() => {
    const trailing = tableColumns.map((column) => `minmax(${column.width}px, ${column.width}px)`).join(" ");
    return `minmax(300px,1fr) ${trailing} 36px`;
  }, [tableColumns]);

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

  const filteredTasks = useMemo(() => {
    const query = taskQuery.trim().toLowerCase();
    const next = tasks.filter((task) => {
      if (!showClosed && task.status === "complete") return false;
      if (assignedOnly && !task.assignee) return false;
      if (!query) return true;
      return [
        task.name,
        task.assignee,
        task.dueDate,
        task.priority,
        task.taskType,
        task.tags.join(" "),
      ].some((value) => value.toLowerCase().includes(query));
    });

    return sortTasks(next, sortKey);
  }, [assignedOnly, showClosed, sortKey, taskQuery, tasks]);

  const displayTasks = useMemo(
    () => filteredTasks.filter((task) => !subtasksCollapsed || !task.parentId),
    [filteredTasks, subtasksCollapsed],
  );

  const groupedTasks = useMemo(() => {
    if (groupBy === "none") return [];
    const groups = new Map<string, TaskItem[]>();
    const labels = groupBy === "status" ? STATUS_COLUMNS.map((status) => status.label) : [];
    labels.forEach((label) => groups.set(label, []));
    displayTasks.forEach((task) => {
      const label = getGroupLabel(task, groupBy);
      groups.set(label, [...(groups.get(label) ?? []), task]);
    });
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }, [displayTasks, groupBy]);

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
        date: taskDraft.dueDateISO ?? formatDateInput(new Date()),
        status: uiStatusToApiStatus(taskDraft.status),
        priority: uiPriorityToApiPriority(taskDraft.priority),
        category: taskDraft.taskType || (taskDraft.parentId ? "Subtask" : "Task"),
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

  const createColumn = (label: string) => {
    const key = `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    setColumns((current) => [
      ...current,
      { key, label, Icon: FileText, width: 170, visible: true, custom: true },
    ]);
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

  const renameView = (viewId: string, label: string) => {
    const nextLabel = label.slice(0, 48) || "Untitled";
    setViews((current) => current.map((view) => (view.id === viewId ? { ...view, label: nextLabel } : view)));
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
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));

    const body: Record<string, unknown> = { id: taskId };
    if (patch.name !== undefined) body.title = patch.name;
    if (patch.status !== undefined) body.status = uiStatusToApiStatus(patch.status);
    if (patch.priority !== undefined) body.priority = uiPriorityToApiPriority(patch.priority);
    if (patch.tags !== undefined) body.labelIds = await ensureLabelIds(patch.tags) ?? [];

    try {
      if (Object.keys(body).length <= 1) return;
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update task"));
      const savedTask = mapApiTaskToTaskItem((await response.json()) as ApiTask);
      setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, ...savedTask } : task)));
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
              />
            ) : null}
          </div>
        </div>

        <div className="flex h-8 shrink-0 items-center justify-between border-b border-zinc-100 !px-4">
          <div className="flex items-center gap-1.5 text-zinc-500">
            <div className="relative">
              <ToolbarIconButton
                Icon={Columns3}
                label={groupBy === "none" ? "Group: None" : `Group: ${getGroupName(groupBy)}`}
                active={groupMenuOpen || groupBy !== "none"}
                onClick={() => setGroupMenuOpen((open) => !open)}
              />
              {groupMenuOpen ? (
                <GroupMenu
                  value={groupBy}
                  onChange={(nextGroup) => {
                    setGroupBy(nextGroup);
                    setCollapsedGroups(new Set());
                    setGroupMenuOpen(false);
                  }}
                />
              ) : null}
            </div>
            <ToolbarIconButton
              Icon={GitBranch}
              label={subtasksCollapsed ? "Subtasks: Collapsed" : "Subtasks: Expanded"}
              active={!subtasksCollapsed}
              onClick={() => setSubtasksCollapsed((collapsed) => !collapsed)}
            />
            <ToolbarIconButton
              Icon={Columns3}
              label="Fields"
              active={panel === "fields"}
              onClick={() => {
                setPanel(panel === "fields" ? null : "fields");
                setFieldMode("existing");
              }}
            />
            {groupBy !== "none" ? (
              <button
                type="button"
                className="ml-1 inline-flex h-6 items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--os-brand-rail)_18%,transparent)] bg-[color-mix(in_srgb,var(--os-brand-rail)_9%,white)] !px-2 text-[11px] font-medium text-[var(--os-brand-rail)]"
                onClick={() => setGroupMenuOpen(true)}
              >
                <Columns3 className="h-3 w-3" />
                {getGroupName(groupBy)}
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 text-zinc-500">
            <div className="relative">
              <ToolbarIconButton
                Icon={ListFilter}
                label="Filter and sort"
                active={filterMenuOpen || taskQuery !== "" || assignedOnly || !showClosed || sortKey !== "none"}
                onClick={() => setFilterMenuOpen((open) => !open)}
              />
              {filterMenuOpen ? (
                <FilterMenu
                  query={taskQuery}
                  showClosed={showClosed}
                  assignedOnly={assignedOnly}
                  sortKey={sortKey}
                  onQueryChange={setTaskQuery}
                  onShowClosedChange={setShowClosed}
                  onAssignedOnlyChange={setAssignedOnly}
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
            <ToolbarIconButton
              Icon={Users}
              label={assignedOnly ? "Show all tasks" : "Assigned tasks only"}
              active={assignedOnly}
              onClick={() => setAssignedOnly((onlyAssigned) => !onlyAssigned)}
            />
            <span className="flex -space-x-2">
              <span className="h-6 w-6 rounded-full border-2 border-white bg-[var(--os-brand-rail)] text-[10px] font-semibold text-white inline-flex items-center justify-center">
                I
              </span>
            </span>
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
            <span className="h-4 w-px bg-zinc-200" aria-hidden />
            <ToolbarIconButton
              Icon={Settings}
              label="Customize view"
              framed
              active={panel === "customize"}
              onClick={() => setPanel(panel === "customize" ? null : "customize")}
            />
            <button
              type="button"
              className="inline-flex h-[26px] items-center gap-1 rounded-md bg-[var(--os-brand-rail)] !px-2.5 text-[12px] font-medium text-white hover:opacity-95"
              onClick={() => startDraftTask()}
            >
              <Plus className="h-3.5 w-3.5" />
              Task
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {activeView.kind === "list" || activeView.kind === "table" ? (
            <ListMode
              tasks={displayTasks}
              groupedTasks={groupedTasks}
              groupBy={groupBy}
              tableColumns={tableColumns}
              tableTemplate={tableTemplate}
              loading={tasksLoading}
              error={taskError}
              saving={savingTask}
              draftTask={draftTask}
              openDraftMenu={openDraftMenu}
              collapsedGroups={collapsedGroups}
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
              onOpenFields={() => {
                setPanel("fields");
                setFieldMode("existing");
              }}
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
          sortName={getSortName(sortKey)}
          options={viewOptions}
          onRenameView={(label) => renameView(activeView.id, label)}
          onToggleOption={(key) => setViewOptions((current) => ({ ...current, [key]: !current[key] }))}
          onTogglePin={() => toggleViewPin(activeView.id)}
          onOpenFilter={() => setFilterMenuOpen(true)}
          onOpenFields={() => {
            setPanel("fields");
            setFieldMode("existing");
          }}
          onOpenGroup={() => setGroupMenuOpen(true)}
          onToggleSubtasks={() => setSubtasksCollapsed((collapsed) => !collapsed)}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {selectedTask ? (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTaskId(null)}
          onTaskChange={updateTask}
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
}: {
  onCreate: (view: ViewDef) => void;
  privateView: boolean;
  pinView: boolean;
  onPrivateChange: (value: boolean) => void;
  onPinChange: (value: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredViews = filterViews(VIEW_CATALOG, query);
  const filteredEmbeds = filterViews(EMBED_VIEWS, query);

  return (
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
  groupedTasks,
  groupBy,
  tableColumns,
  tableTemplate,
  loading,
  error,
  saving,
  draftTask,
  openDraftMenu,
  collapsedGroups,
  onToggleGroup,
  onStartTask,
  onDraftChange,
  onOpenDraftMenuChange,
  onSaveDraft,
  onCancelDraft,
  onTaskChange,
  onOpenTask,
  onOpenFields,
}: {
  tasks: TaskItem[];
  groupedTasks: { label: string; items: TaskItem[] }[];
  groupBy: GroupKey;
  tableColumns: ColumnDef[];
  tableTemplate: string;
  loading: boolean;
  error: string | null;
  saving: boolean;
  draftTask: DraftTask | null;
  openDraftMenu: TaskOptionMenu;
  collapsedGroups: Set<string>;
  onToggleGroup: (label: string) => void;
  onStartTask: (status?: TaskItem["status"], parentId?: string) => void;
  onDraftChange: (patch: Partial<DraftTask>) => void;
  onOpenDraftMenuChange: (menu: TaskOptionMenu) => void;
  onSaveDraft: () => void | Promise<void>;
  onCancelDraft: () => void;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
  onOpenTask: (task: TaskItem) => void;
  onOpenFields: () => void;
}) {
  const rootTasks = tasks.filter((task) => !task.parentId);
  const parentIds = new Set(rootTasks.map((task) => task.id));
  const orphanSubtasks = tasks.filter((task) => task.parentId && !parentIds.has(task.parentId));
  const draftRendersUnderParent = Boolean(draftTask?.parentId && parentIds.has(draftTask.parentId));

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
    />
  );

  return (
    <div className="min-w-[860px] !px-5 py-4">
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
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center justify-self-end rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          title="Add a Column"
          aria-label="Add a Column"
          onClick={onOpenFields}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {groupBy === "none" ? (
        <>
          {[...rootTasks, ...orphanSubtasks].map((task) => {
            const childTasks = tasks.filter((candidate) => candidate.parentId === task.id);
            return (
              <Fragment key={task.id}>
                <TaskRow
                  task={task}
                  tableColumns={tableColumns}
                  tableTemplate={tableTemplate}
                  onAddSubtask={() => onStartTask(task.status, task.id)}
                  onTaskChange={onTaskChange}
                  onOpenTask={() => onOpenTask(task)}
                />
                {childTasks.map((childTask) => (
                  <TaskRow
                    key={childTask.id}
                    task={childTask}
                    tableColumns={tableColumns}
                    tableTemplate={tableTemplate}
                    onAddSubtask={() => onStartTask(childTask.status, childTask.id)}
                    onTaskChange={onTaskChange}
                    onOpenTask={() => onOpenTask(childTask)}
                  />
                ))}
                {draftTask?.parentId === task.id ? renderCreateRow(draftTask) : null}
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
              <section key={group.label}>
                <button
                  type="button"
                  className="mb-2 inline-flex items-center gap-2 text-left text-[13px] font-medium text-zinc-700"
                  onClick={() => onToggleGroup(group.label)}
                >
                  <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
                  <GroupBadge label={group.label} />
                  <span className="text-zinc-500">{group.items.length}</span>
                </button>
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
                    {group.items.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        tableColumns={tableColumns}
                        tableTemplate={tableTemplate}
                        onAddSubtask={() => onStartTask(task.status, task.id)}
                        onTaskChange={onTaskChange}
                        onOpenTask={() => onOpenTask(task)}
                      />
                    ))}
                    {draftTask && shouldShowDraftInGroup(draftTask, groupBy, group.label) ? (
                      <CreateTaskRow
                        draftTask={draftTask}
                        openMenu={openDraftMenu}
                        onDraftChange={onDraftChange}
                        onOpenMenuChange={onOpenDraftMenuChange}
                        onSave={onSaveDraft}
                        onCancel={onCancelDraft}
                        saving={saving}
                        tableTemplate={tableTemplate}
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
                />
              ) : null}
              <AddTaskRow tableTemplate={tableTemplate} onClick={() => onStartTask()} />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CreateTaskRow({
  draftTask,
  openMenu,
  onDraftChange,
  onOpenMenuChange,
  onSave,
  onCancel,
  saving,
  tableTemplate,
}: {
  draftTask: DraftTask;
  openMenu: TaskOptionMenu;
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
            />
          ) : null}
          {openMenu === "assignee" ? (
            <AssigneeMenu
              onSelect={(assignee) => {
                onDraftChange({ assignee });
                onOpenMenuChange(null);
              }}
            />
          ) : null}
          {openMenu === "date" ? (
            <DateMenu
              onSelect={(dueDate, dueDateISO) => {
                onDraftChange({ dueDate, dueDateISO });
                onOpenMenuChange(null);
              }}
            />
          ) : null}
          {openMenu === "priority" ? (
            <PriorityMenu
              onSelect={(priority) => {
                onDraftChange({ priority });
                onOpenMenuChange(null);
              }}
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
  onAddSubtask,
  onTaskChange,
  onOpenTask,
}: {
  task: TaskItem;
  tableColumns: ColumnDef[];
  tableTemplate: string;
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
        <span className="h-3.5 w-3.5 shrink-0 rounded border border-zinc-300 bg-white opacity-0 group-hover:opacity-100" />
        {!task.parentId && task.subtaskCount > 0 ? <ChevronRight className="h-3.5 w-3.5 text-zinc-400" /> : null}
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
          <button
            type="button"
            className="truncate text-left font-medium text-zinc-900"
            onClick={onOpenTask}
          >
            {task.name}
          </button>
        )}
        {task.subtaskCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <GitBranch className="h-3.5 w-3.5" />
            {task.subtaskCount}
          </span>
        ) : null}
        {task.attachments > 0 ? (
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <Paperclip className="h-3.5 w-3.5" />
            {task.attachments}
          </span>
        ) : null}
        {!task.parentId ? (
          <span className="ml-2 hidden items-center gap-1 group-hover:inline-flex">
            <RowHoverButton Icon={Plus} label="Add subtask" onClick={onAddSubtask} />
            <span className="relative">
              <RowHoverButton Icon={Tag} label="Edit tags" onClick={() => setTagMenuOpen((open) => !open)} />
              {tagMenuOpen ? (
                <TagEditorPopover
                  tags={task.tags}
                  query={tagQuery}
                  onQueryChange={setTagQuery}
                  onCreate={addTag}
                  onRemove={(tag) => void onTaskChange(task.id, { tags: task.tags.filter((item) => item !== tag) })}
                />
              ) : null}
            </span>
            <RowHoverButton
              Icon={Pencil}
              label="Rename"
              onClick={() => {
                setDraftName(task.name);
                setEditing(true);
              }}
            />
          </span>
        ) : null}
      </span>
      {tableColumns.map((column) => (
        <span key={column.key} className="truncate pr-3 text-zinc-600">
          {renderTaskValue(task, column)}
        </span>
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

function TaskTypeMenu({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (value: string) => void;
}) {
  const options = [
    { label: "Task", Icon: Circle },
    { label: "Milestone", Icon: Box },
    { label: "Form Response", Icon: ClipboardList },
    { label: "Meeting Note", Icon: MessageSquare },
  ];

  return (
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
  );
}

function AssigneeMenu({ onSelect }: { onSelect: (value: string) => void }) {
  return (
    <DropdownPanel className="left-0 top-7 w-[320px] overflow-hidden">
      <div className="flex h-9 items-center gap-2 border-b border-zinc-100 !px-2.5">
        <Search className="h-4 w-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Search or enter email..."
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-zinc-500"
          autoFocus
        />
      </div>
      <div className="!p-2.5">
        <PanelLabel>People</PanelLabel>
        <button
          type="button"
          className="mb-1 flex h-8 w-full items-center gap-2 rounded-md bg-zinc-100 !px-2 text-left text-[12px] text-zinc-900"
          onClick={() => onSelect("Me")}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--os-brand-rail)] text-[10px] font-semibold text-white">ME</span>
          Me
        </button>
        <PanelLabel>Agents</PanelLabel>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md !px-2 text-left text-[12px] text-zinc-800 hover:bg-zinc-50"
          onClick={() => onSelect("Project Kickoff Scope Manager")}
        >
          <span className="h-6 w-6 rounded-full bg-gradient-to-br from-orange-200 to-pink-300" />
          Project Kickoff Scope Manager
        </button>
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 rounded-md !px-2 text-left text-[12px] font-medium text-zinc-800 hover:bg-zinc-50"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--os-brand-rail)_12%,white)] text-[var(--os-brand-rail)]">
            <Plus className="h-3.5 w-3.5" />
          </span>
          Create Agent
        </button>
      </div>
    </DropdownPanel>
  );
}

function DateMenu({ onSelect }: { onSelect: (label: string, isoDate: string) => void }) {
  const days = ["31", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];
  const today = new Date();
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
            <span className="text-[13px] font-medium text-zinc-900">June 2026</span>
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
            {days.map((day, index) => {
              const calendarDate = addDays(new Date(2026, 4, 31), index);
              const isToday = formatDateInput(calendarDate) === formatDateInput(today);
              return (
                <button
                  key={`${day}-${index}`}
                  type="button"
                  className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full ${
                    isToday ? "bg-red-500 text-white" : index < 7 ? "text-zinc-300" : "text-zinc-900 hover:bg-zinc-100"
                  }`}
                  onClick={() => onSelect(formatCalendarLabel(calendarDate), formatDateInput(calendarDate))}
                >
                  {day}
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
  );
}

function PriorityMenu({ onSelect }: { onSelect: (value: TaskPriority) => void }) {
  const options: { label: TaskPriority; color: string }[] = [
    { label: "Urgent", color: "#DC2626" },
    { label: "High", color: "#F59E0B" },
    { label: "Normal", color: "#4F46E5" },
    { label: "Low", color: "#A1A1AA" },
  ];
  return (
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
  );
}

function TagsMenu({
  query,
  onQueryChange,
  onCreate,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onCreate: () => void;
}) {
  return (
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
                draggingTaskId ? "border-dashed border-zinc-300" : "border-zinc-100"
              }`}
              style={{ backgroundColor: status.bg }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => moveDraggedTask(event, status.key)}
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
  onMove,
  onComplete,
  onDragStart,
  onDragEnd,
}: {
  task: TaskItem;
  onOpen: () => void;
  onMove: (status: TaskItem["status"]) => void;
  onComplete: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const currentIndex = STATUS_COLUMNS.findIndex((status) => status.key === task.status);
  const previousStatus = STATUS_COLUMNS[Math.max(0, currentIndex - 1)]?.key;
  const nextStatus = STATUS_COLUMNS[Math.min(STATUS_COLUMNS.length - 1, currentIndex + 1)]?.key;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      className="group/card w-full cursor-grab rounded-md border border-zinc-200 bg-white !p-2 text-left text-[12px] shadow-sm transition hover:-translate-y-px hover:border-zinc-300 hover:shadow-md active:cursor-grabbing"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
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
        onClick();
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
  onClose,
  onTaskChange,
}: {
  task: TaskItem;
  onClose: () => void;
  onTaskChange: (taskId: string, patch: Partial<TaskItem>) => void | Promise<void>;
}) {
  const statusMeta = getStatusMeta(task.status);
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 !p-8" onClick={onClose}>
      <section
        className="flex h-[min(720px,calc(100vh-80px))] w-[min(1180px,calc(100vw-96px))] overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-200 !px-3 text-[12px] text-zinc-500">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">My Tasks</span>
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
              {task.taskType || "Task"}
              <ChevronDown className="h-3.5 w-3.5" />
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
                  ) : null}
                </div>
              </TaskDetailField>
              <TaskDetailField Icon={Users} label="Assignees">
                {task.assignee || "Empty"}
              </TaskDetailField>
              <TaskDetailField Icon={CalendarDays} label="Dates">
                {task.dueDate || "Start → Due"}
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
                  ) : null}
                </div>
              </TaskDetailField>
              <TaskDetailField Icon={Tag} label="Tags">
                {task.tags.length > 0 ? task.tags.join(", ") : "Empty"}
              </TaskDetailField>
              <TaskDetailField Icon={Activity} label="Track time">
                Start
              </TaskDetailField>
            </div>

            <div className="my-6 h-px max-w-[760px] bg-zinc-100" />
            <button type="button" className="mb-16 text-left text-[13px] text-zinc-400 hover:text-zinc-700">
              Add description, or write with AI
            </button>

            <div className="grid max-w-[360px] gap-3 text-[12px] text-zinc-700">
              {[
                { label: "Add fields", Icon: Pencil },
                { label: "Add subtask", Icon: GitBranch },
                { label: "Relate items or add dependencies", Icon: Link2 },
                { label: "Create checklist", Icon: ClipboardList },
                { label: "Attach file", Icon: Paperclip },
              ].map((item) => (
                <button key={item.label} type="button" className="flex h-7 items-center gap-2 rounded-md text-left hover:bg-zinc-50">
                  <item.Icon className="h-3.5 w-3.5 text-zinc-500" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="flex w-[360px] shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/40">
          <div className="flex h-10 items-center justify-between border-b border-zinc-200 !px-3">
            <h3 className="text-[13px] font-semibold text-zinc-900">Activity</h3>
            <div className="flex items-center gap-2 text-zinc-500">
              <Search className="h-3.5 w-3.5" />
              <MessageSquare className="h-3.5 w-3.5" />
              <ListFilter className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex flex-1 items-end !p-3 text-[11px] text-zinc-400">
            <span>You created this task</span>
            <span className="ml-auto">{task.dateCreated}</span>
          </div>
          <div className="border-t border-zinc-200 !p-3">
            <div className="rounded-lg border border-zinc-200 bg-white !p-2 shadow-sm">
              <input
                type="text"
                placeholder="Write a comment..."
                className="mb-2 h-8 w-full bg-transparent text-[12px] outline-none placeholder:text-zinc-400"
              />
              <div className="flex items-center gap-1 text-zinc-400">
                <Plus className="h-4 w-4" />
                <span className="rounded-md bg-zinc-100 !px-2 py-1 text-[11px] text-zinc-600">Comment</span>
                <Bot className="h-4 w-4 text-fuchsia-500" />
                <Paperclip className="h-4 w-4" />
                <button type="button" className="ml-auto rounded-md bg-zinc-100 !px-2 py-1 text-[11px] text-zinc-500">Send</button>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
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

function CustomizePanel({
  activeView,
  groupBy,
  subtasksCollapsed,
  shownCount,
  sortName,
  options,
  onRenameView,
  onToggleOption,
  onTogglePin,
  onOpenFilter,
  onOpenFields,
  onOpenGroup,
  onToggleSubtasks,
  onClose,
}: {
  activeView: ViewDef;
  groupBy: GroupKey;
  subtasksCollapsed: boolean;
  shownCount: number;
  sortName: string;
  options: ViewOptions;
  onRenameView: (label: string) => void;
  onToggleOption: (key: keyof ViewOptions) => void;
  onTogglePin: () => void;
  onOpenFilter: () => void;
  onOpenFields: () => void;
  onOpenGroup: () => void;
  onToggleSubtasks: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-zinc-200 bg-white">
      <PanelHeader title="Customize view" onClose={onClose} />
      <div className="border-b border-zinc-100 !p-2">
        <div className="flex h-8 items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--os-brand-rail)_35%,#e4e4e7)] !px-2">
          <activeView.Icon className="h-3.5 w-3.5" style={{ color: activeView.swatch }} />
          <input
            type="text"
            value={activeView.label}
            onChange={(event) => onRenameView(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-zinc-900 outline-none"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-2 border-b border-zinc-100 !p-2">
          <SettingRow label="Card size" value="Medium" />
          <SettingRow label="Card cover" value="Image" />
          <SettingToggle label="Stack fields" checked={options.stackFields} onToggle={() => onToggleOption("stackFields")} />
          <SettingToggle label="Show empty fields" checked={options.showEmptyFields} onToggle={() => onToggleOption("showEmptyFields")} />
          <SettingToggle label="Collapse empty columns" checked={options.collapseEmptyColumns} onToggle={() => onToggleOption("collapseEmptyColumns")} />
          <SettingRow label="More options" />
        </div>
        <div className="border-b border-zinc-100 !p-2">
          <PanelAction Icon={Columns3} label="Fields" value={`${shownCount} shown`} onClick={onOpenFields} />
          <PanelAction Icon={ListFilter} label="Filter" value="Edit" onClick={onOpenFilter} />
          <PanelAction Icon={Columns3} label="Group" value={getGroupName(groupBy)} onClick={onOpenGroup} />
          <PanelAction Icon={AlignLeft} label="Sort" value={sortName} onClick={onOpenFilter} />
          <PanelAction Icon={GitBranch} label="Subtasks" value={subtasksCollapsed ? "Collapsed" : "Expanded"} onClick={onToggleSubtasks} />
          <PanelAction Icon={SlidersHorizontal} label="Templates" />
        </div>
        <div className="space-y-1 border-b border-zinc-100 !p-2">
          <SettingToggle label="Autosave for me" checked={options.autosave} onToggle={() => onToggleOption("autosave")} />
          <SettingToggle label="Pin view" checked={Boolean(activeView.pinned)} onToggle={onTogglePin} />
          <SettingToggle label="Private view" checked={options.privateView} onToggle={() => onToggleOption("privateView")} />
          <SettingToggle label="Protect view" checked={options.protectView} onToggle={() => onToggleOption("protectView")} />
          <SettingToggle label="Set as default view" checked={options.defaultView} onToggle={() => onToggleOption("defaultView")} />
        </div>
        <div className="!p-2">
          <PanelAction Icon={Link2} label="Copy link to view" />
          <PanelAction Icon={Star} label="Favorite" />
        </div>
      </div>
    </aside>
  );
}

function GroupMenu({ value, onChange }: { value: GroupKey; onChange: (value: GroupKey) => void }) {
  return (
    <div className="absolute left-0 top-7 z-[70] w-[240px] rounded-xl border border-zinc-200 bg-white !p-2 shadow-2xl">
      <PanelLabel>Group by</PanelLabel>
      <div className="space-y-1">
        {GROUP_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`flex h-8 w-full items-center gap-2 rounded-md !px-2 text-left text-[13px] ${
              value === option.key ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
            }`}
            onClick={() => onChange(option.key)}
          >
            <option.Icon className="h-3.5 w-3.5 text-zinc-500" />
            {option.label}
            {value === option.key ? <Check className="ml-auto h-4 w-4 text-zinc-600" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterMenu({
  query,
  showClosed,
  assignedOnly,
  sortKey,
  onQueryChange,
  onShowClosedChange,
  onAssignedOnlyChange,
  onSortChange,
  onClose,
}: {
  query: string;
  showClosed: boolean;
  assignedOnly: boolean;
  sortKey: TaskSortKey;
  onQueryChange: (value: string) => void;
  onShowClosedChange: (value: boolean) => void;
  onAssignedOnlyChange: (value: boolean) => void;
  onSortChange: (value: TaskSortKey) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-7 z-[80] w-[260px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl">
      <div className="flex h-9 items-center gap-2 border-b border-zinc-100 !px-2.5">
        <Search className="h-3.5 w-3.5 text-zinc-400" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter tasks"
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-zinc-400"
          autoFocus
        />
        <button type="button" className="text-zinc-400 hover:text-zinc-700" aria-label="Close filters" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="border-b border-zinc-100 !p-2">
        <PanelLabel>Display</PanelLabel>
        <FilterToggle label="Show closed tasks" checked={showClosed} onChange={onShowClosedChange} />
        <FilterToggle label="Assigned tasks only" checked={assignedOnly} onChange={onAssignedOnlyChange} />
      </div>
      <div className="!p-2">
        <PanelLabel>Sort by</PanelLabel>
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`flex h-7 w-full items-center gap-2 rounded-md !px-2 text-left text-[12px] ${
              sortKey === option.key ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
            }`}
            onClick={() => onSortChange(option.key)}
          >
            <option.Icon className="h-3.5 w-3.5 text-zinc-500" />
            <span className="flex-1">{option.label}</span>
            {sortKey === option.key ? <Check className="h-3.5 w-3.5 text-zinc-600" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="flex h-7 w-full items-center justify-between rounded-md !px-2 text-left text-[12px] text-zinc-700 hover:bg-zinc-50"
      onClick={() => onChange(!checked)}
    >
      {label}
      <Switch checked={checked} />
    </button>
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
}: {
  tags: string[];
  query: string;
  onQueryChange: (value: string) => void;
  onCreate: () => void;
  onRemove: (tag: string) => void;
}) {
  return (
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
      className={`relative inline-flex h-4 w-7 rounded-full transition-colors ${
        checked ? "bg-[var(--os-brand-rail)]" : "bg-zinc-300"
      } ${disabled ? "opacity-50" : ""}`}
      aria-hidden
    >
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-3.5" : "translate-x-0.5"}`} />
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

function GroupBadge({ label }: { label: string }) {
  const status = STATUS_COLUMNS.find((item) => item.label === label);
  return (
    <span
      className="inline-flex h-6 items-center rounded-md !px-2 text-[12px] font-semibold text-white"
      style={{ backgroundColor: status?.color ?? "#A855F7" }}
    >
      {label}
    </span>
  );
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
      return task.dueDate || "No due date";
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
      return (draftTask.dueDate || "No due date") === label;
    case "taskType":
      return (draftTask.taskType || "Task") === label;
    case "none":
      return true;
  }
}

function getGroupName(key: GroupKey) {
  return GROUP_OPTIONS.find((option) => option.key === key)?.label ?? "None";
}

function getSortName(key: TaskSortKey) {
  return SORT_OPTIONS.find((option) => option.key === key)?.label ?? "None";
}

function sortTasks(tasks: TaskItem[], sortKey: TaskSortKey) {
  if (sortKey === "none") return tasks;

  return [...tasks].sort((first, second) => {
    if (sortKey === "priority") return priorityRank(second.priority) - priorityRank(first.priority);
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

function mapApiTaskToTaskItem(task: ApiTask): TaskItem {
  return {
    id: task.id,
    name: task.title || "Untitled",
    status: apiStatusToUiStatus(task.status),
    assignee: formatAssigneeName(task.assignee),
    dueDate: formatRelativeTaskDate(task.date),
    priority: apiPriorityToUiPriority(task.priority),
    dateCreated: task.createdAt ? formatRelativeTaskDate(task.createdAt) : "Today",
    taskType: task.category || (task.parentTaskId ? "Subtask" : "Task"),
    tags: task.labels?.map((item) => item.label?.name).filter((name): name is string => Boolean(name)) ?? [],
    subtaskCount: task._count?.subTasks ?? 0,
    comments: task._count?.comments ?? 0,
    attachments: 0,
    parentId: task.parentTaskId ?? undefined,
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
