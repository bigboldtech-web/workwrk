// The eight write tools' contracts (docs/plans/mcp-server.md 4.1, 4.3):
// names, input and output schemas and annotations. Their bodies are step
// 3's (the extracted write paths, dedupe, the write limits, "via" and the
// audit rows); a tool with no body is defined but never offered, so
// tools/list lists only what can run and a call to it is an unknown tool.
// update_task and move_task carry destructiveHint true (review M6): one
// changes what others see in place, the other moves a task out of a List.
//
// Pure.

import { MCP_FIELD_COPY as F } from "../mcp-copy";
import type { McpTool, ToolAnnotations } from "../tool-types";
import {
  BOOL,
  DAY,
  DAY_OR_NONE,
  EMAIL,
  ID,
  NAMED_OR_NULL,
  PERSON,
  PRIORITY,
  STR,
  STR_OR_NULL,
  TASK,
  input,
  output,
} from "./schemas";

const WRITE = (o: Partial<ToolAnnotations> = {}): ToolAnnotations => ({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...o });

const TASK_REF = () => output({ id: STR(), title: STR(), url: STR() });

const createTask: McpTool = {
  name: "create_task",
  scope: "write",
  inputSchema: input(
    {
      title: { type: "string", minLength: 1, maxLength: 280 },
      description: { type: "string", maxLength: 10000 },
      listId: ID(F.listId),
      parentTaskId: ID(F.taskId),
      status: { type: "string", maxLength: 60, description: F.status },
      priority: PRIORITY(),
      dueDate: DAY(),
      startDate: DAY(),
      assigneeEmails: { type: "array", items: EMAIL(), maxItems: 10 },
      tags: { type: "array", items: { type: "string", minLength: 1, maxLength: 40 }, maxItems: 10 },
      subtasks: {
        type: "array",
        maxItems: 25,
        items: input(
          {
            title: { type: "string", minLength: 1, maxLength: 280 },
            dueDate: DAY(),
            assigneeEmails: { type: "array", items: EMAIL(), maxItems: 5 },
          },
          ["title"],
        ),
      },
    },
    ["title"],
  ),
  outputSchema: output({
    task: TASK(),
    subtasks: { type: "array", items: TASK() },
    failedSubtasks: { type: "array", items: output({ title: STR(), reason: STR() }) },
    duplicate: BOOL(),
  }),
  annotations: WRITE(),
};

const updateTask: McpTool = {
  name: "update_task",
  scope: "write",
  inputSchema: input(
    {
      taskId: ID(F.taskId),
      title: { type: "string", minLength: 1, maxLength: 280 },
      appendToDescription: { type: "string", minLength: 1, maxLength: 4000 },
      status: { type: "string", maxLength: 60, description: F.status },
      done: BOOL(),
      priority: { type: "string", enum: ["URGENT", "HIGH", "NORMAL", "LOW", "none"] },
      dueDate: DAY_OR_NONE(),
      startDate: DAY_OR_NONE(),
      addAssigneeEmails: { type: "array", items: EMAIL(), maxItems: 10 },
      removeAssigneeEmails: { type: "array", items: EMAIL(), maxItems: 10 },
      addTags: { type: "array", items: { type: "string", minLength: 1, maxLength: 40 }, maxItems: 10 },
      removeTags: { type: "array", items: { type: "string", minLength: 1, maxLength: 40 }, maxItems: 10 },
    },
    ["taskId"],
  ),
  outputSchema: output({ task: TASK(), changed: { type: "array", items: STR() } }),
  annotations: WRITE({ destructiveHint: true }),
};

const moveTask: McpTool = {
  name: "move_task",
  scope: "write",
  inputSchema: input({ taskId: ID(F.taskId), listId: ID(F.listId), listName: { type: "string", minLength: 1, maxLength: 200 } }, ["taskId"]),
  outputSchema: output({ task: TASK_REF(), list: output({ id: STR(), name: STR() }), status: STR_OR_NULL() }),
  annotations: WRITE({ destructiveHint: true, idempotentHint: true }),
};

const addComment: McpTool = {
  name: "add_comment",
  scope: "write",
  inputSchema: input({ taskId: ID(F.taskId), text: { type: "string", minLength: 1, maxLength: 4000 } }, ["taskId", "text"]),
  outputSchema: output({ comment: output({ id: STR() }), task: TASK_REF(), duplicate: BOOL() }),
  annotations: WRITE(),
};

const createDoc: McpTool = {
  name: "create_doc",
  scope: "write",
  inputSchema: input(
    {
      title: { type: "string", minLength: 1, maxLength: 200 },
      markdown: { type: "string", maxLength: 50000 },
      place: input({ spaceId: ID(F.spaceId), folderId: ID(), listId: ID(F.listId), parentDocId: ID(F.docId) }),
    },
    ["title"],
  ),
  outputSchema: output({
    doc: output({
      id: STR(),
      title: STR(),
      place: output({ kind: STR(), name: STR_OR_NULL() }),
      private: BOOL(),
      inNotepad: BOOL(),
      url: STR(),
    }),
  }),
  annotations: WRITE(),
};

const appendToDoc: McpTool = {
  name: "append_to_doc",
  scope: "write",
  inputSchema: input({ docId: ID(F.docId), heading: { type: "string", maxLength: 120 }, text: { type: "string", minLength: 1, maxLength: 8000 } }, ["docId", "text"]),
  outputSchema: output({ doc: output({ id: STR(), title: STR(), url: STR() }), version: { type: ["integer", "null"] } }),
  annotations: WRITE(),
};

const createReminder: McpTool = {
  name: "create_reminder",
  scope: "write",
  inputSchema: input(
    {
      title: { type: "string", minLength: 1, maxLength: 200 },
      remindAt: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})?$" },
      note: { type: "string", maxLength: 2000 },
      taskId: ID(F.taskId),
      email: BOOL(),
    },
    ["title", "remindAt"],
  ),
  outputSchema: output({
    reminder: output({ id: STR(), title: STR(), remindAt: STR(), task: NAMED_OR_NULL() }),
    duplicate: BOOL(),
  }),
  annotations: WRITE(),
};

const giveKudos: McpTool = {
  name: "give_kudos",
  scope: "write",
  inputSchema: input(
    { toEmail: EMAIL(), message: { type: "string", minLength: 1, maxLength: 500 }, companyValue: { type: "string", maxLength: 80 } },
    ["toEmail", "message"],
  ),
  outputSchema: output({
    kudos: output({ id: STR(), message: STR(), companyValue: STR_OR_NULL(), to: PERSON() }),
    duplicate: BOOL(),
  }),
  annotations: WRITE(),
};

/** The eight write tools, in the order tools/list gives them. */
export const WRITE_TOOLS: readonly McpTool[] = [createTask, updateTask, moveTask, addComment, createDoc, appendToDoc, createReminder, giveKudos];
