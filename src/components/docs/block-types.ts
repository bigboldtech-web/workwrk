// Doc block shapes.
//
// A Doc's stored content is `{ blocks: Block[] }` for pre-BlockNote docs, and
// several live surfaces still READ that shape (the public share page, the
// Notepad panel, the SOP read view and the SOP editor) to render or migrate
// legacy content. The editor that wrote it is gone; only the shape remains,
// so it lives here on its own rather than behind a component import.

export type BlockKind =
  | "h1" | "h2" | "h3" | "paragraph"
  | "bullet" | "numbered" | "todo" | "quote" | "code"
  | "divider" | "embed" | "file" | "image" | "callout"
  | "toggle" | "ai_write" | "entity_link" | "subpage"
  | "sop_card" | "task_card" | "note_card"
  | "tasks_view" | "studio_board" | "sops_list" | "meetings_view" | "form" | "data_table" | "canvas_card";

export type EntityKind = "user" | "task" | "board" | "sop" | "kra" | "space";

export type Block =
  | { id: string; kind: "h1" | "h2" | "h3" | "paragraph" | "bullet" | "numbered" | "quote"; text: string }
  | { id: string; kind: "todo"; text: string; done: boolean }
  | { id: string; kind: "code"; text: string; lang?: string }
  | { id: string; kind: "divider" }
  | { id: string; kind: "embed"; url: string; title?: string }
  | { id: string; kind: "file"; name: string; url: string; size?: number; mimeType?: string; s3Key?: string | null }
  | { id: string; kind: "image"; url: string; alt?: string; caption?: string; width?: number; s3Key?: string | null }
  | { id: string; kind: "subpage"; childDocId: string; title: string; emoji?: string }
  | { id: string; kind: "sop_card"; sopId: string }
  | { id: string; kind: "task_card"; taskId: string }
  | { id: string; kind: "note_card"; noteId: string }
  | { id: string; kind: "callout"; text: string; tone: "info" | "warn" | "success" }
  | { id: string; kind: "toggle"; text: string; open: boolean; body: string }
  | { id: string; kind: "ai_write"; prompt: string; result: string; locked: boolean; tone: "expand" | "summarise" | "rewrite" | "actions" }
  | { id: string; kind: "entity_link"; entityKind: EntityKind; entityId: string; label: string; subtitle?: string; href?: string }
  | { id: string; kind: "tasks_view"; window: "today" | "week" | "overdue"; title?: string }
  | { id: string; kind: "studio_board"; boardId: string; boardName?: string }
  | { id: string; kind: "sops_list"; category?: string }
  | { id: string; kind: "meetings_view"; window: "upcoming" | "past" }
  | { id: string; kind: "form"; formId: string; formName?: string }
  | { id: string; kind: "data_table"; tableId: string; tableName?: string }
  | { id: string; kind: "canvas_card"; whiteboardId: string; whiteboardName?: string };

// Inline comments are stored on the doc itself, keyed by block id, so they
// need no separate table. Multi-author safe within the doc's autosave
// debounce; concurrent writers would still need a real model later.
export type Comment = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string | null;
  text: string;
  createdAt: string;
  resolved?: boolean;
};

export type CommentsByBlock = Record<string, Comment[]>;

