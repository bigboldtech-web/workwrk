"use client";

/*
 * BlockDragMenu — a Notion-style block context menu for BlockNote's drag
 * handle (the ⠿ that appears to the left of each block on hover).
 *
 * BlockNote's default drag-handle menu only offers Delete + Colors. This
 * replaces it with the richer Notion set:
 *   Turn into ▸   Color ▸   ·   Copy link to block   Duplicate   Delete
 *   ·   Comment   Ask AI
 *
 * It's built with BlockNote's own menu primitives (useComponentsContext)
 * so it inherits the editor theme, keyboard nav, and submenu behavior. The
 * current block is read from the SideMenu extension state, exactly like
 * BlockNote's built-in items do.
 *
 * Config (docId / onComment / onAskAI) is closed over via makeBlockDragMenu
 * because the drag-handle menu is mounted as a bare FC with no props.
 */

import { createContext, useContext, ReactNode } from "react";
import {
  DragHandleMenu,
  BlockColorsItem,
  useComponentsContext,
  useBlockNoteEditor,
  useExtensionState,
} from "@blocknote/react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  Type, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks,
  Quote, Code, Lightbulb, Repeat2, Link2, Copy, Trash2, MessageSquare, Sparkles, Paintbrush,
} from "lucide-react";

// One consistent icon + label row for every menu item, so the icon column
// and text line up identically across custom items AND BlockNote's built-in
// items (Color) — passing icons via the Menu.Item `icon` prop left "Color"
// (which has none) misaligned.
function MIRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="bn-mi">
      <span className="bn-mi__ico">{icon}</span>
      <span className="bn-mi__lbl">{label}</span>
    </span>
  );
}

type Cfg = {
  docId: string;
  onComment: (blockId: string) => void;
  onAskAI: () => void;
};

// Config flows in via context rather than a closure factory. The side menu
// portals into the editor container, but React context follows the React
// tree (where the provider wraps the SideMenuController), so the menu reads
// live values without any ref-during-render gymnastics.
const BlockDragMenuCtx = createContext<Cfg>({
  docId: "",
  onComment: () => {},
  onAskAI: () => {},
});

export function BlockDragMenuProvider({ value, children }: { value: Cfg; children: ReactNode }) {
  return <BlockDragMenuCtx.Provider value={value}>{children}</BlockDragMenuCtx.Provider>;
}

// "Turn into" targets. Each maps onto a BlockNote block type (+ props).
const TURN_INTO: { key: string; type: string; props?: Record<string, unknown>; label: string; icon: ReactNode }[] = [
  { key: "text", type: "paragraph", label: "Text", icon: <Type size={16} /> },
  { key: "h1", type: "heading", props: { level: 1 }, label: "Heading 1", icon: <Heading1 size={16} /> },
  { key: "h2", type: "heading", props: { level: 2 }, label: "Heading 2", icon: <Heading2 size={16} /> },
  { key: "h3", type: "heading", props: { level: 3 }, label: "Heading 3", icon: <Heading3 size={16} /> },
  { key: "bullet", type: "bulletListItem", label: "Bulleted list", icon: <List size={16} /> },
  { key: "numbered", type: "numberedListItem", label: "Numbered list", icon: <ListOrdered size={16} /> },
  { key: "todo", type: "checkListItem", label: "To-do list", icon: <ListChecks size={16} /> },
  { key: "quote", type: "quote", label: "Quote", icon: <Quote size={16} /> },
  { key: "code", type: "codeBlock", label: "Code", icon: <Code size={16} /> },
  { key: "callout", type: "callout", props: { emoji: "💡", color: "blue" }, label: "Callout", icon: <Lightbulb size={16} /> },
];

export function BlockDragMenu() {
  return (
    <DragHandleMenu>
      <DragMenuBody />
    </DragHandleMenu>
  );
}

function DragMenuBody() {
  const cfg = useContext(BlockDragMenuCtx);
  const Components = useComponentsContext()!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s: any) => s?.block });

  if (!block) return null;
  const Menu = Components.Generic.Menu;
  const typeLabel = prettyType(block.type, block.props);

  const turnInto = (t: { type: string; props?: Record<string, unknown> }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.updateBlock(block, { type: t.type, ...(t.props ? { props: t.props } : {}) } as any);
  };
  const duplicate = () => {
    editor.insertBlocks(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [{ type: block.type, props: block.props, content: block.content } as any],
      block,
      "after",
    );
  };
  const copyLink = () => {
    const url = `${window.location.origin}/docs/${cfg.docId}#${block.id}`;
    navigator.clipboard?.writeText(url).catch(() => {});
  };

  return (
    <>
      <Menu.Label className="bn-menu-label bn-drag-menu-label">{typeLabel}</Menu.Label>

      {/* Turn into ▸ */}
      <Menu.Root position="right" sub>
        <Menu.Trigger sub>
          <Menu.Item className="bn-menu-item" subTrigger>
            <MIRow icon={<Repeat2 size={16} />} label="Turn into" />
          </Menu.Item>
        </Menu.Trigger>
        <Menu.Dropdown sub className="bn-menu-dropdown">
          {TURN_INTO.map((t) => (
            <Menu.Item key={t.key} className="bn-menu-item" onClick={() => turnInto(t)}>
              <MIRow icon={t.icon} label={t.label} />
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu.Root>

      {/* Color ▸ — BlockNote's built-in text/background color submenu.
          Renders null for blocks that don't carry color props. */}
      <BlockColorsItem>
        <MIRow icon={<Paintbrush size={16} />} label="Color" />
      </BlockColorsItem>

      <Menu.Divider />

      <Menu.Item className="bn-menu-item" onClick={copyLink}>
        <MIRow icon={<Link2 size={16} />} label="Copy link to block" />
      </Menu.Item>
      <Menu.Item className="bn-menu-item" onClick={duplicate}>
        <MIRow icon={<Copy size={16} />} label="Duplicate" />
      </Menu.Item>
      <Menu.Item className="bn-menu-item" onClick={() => editor.removeBlocks([block])}>
        <MIRow icon={<Trash2 size={16} />} label="Delete" />
      </Menu.Item>

      <Menu.Divider />

      <Menu.Item className="bn-menu-item" onClick={() => cfg.onComment(block.id)}>
        <MIRow icon={<MessageSquare size={16} />} label="Comment" />
      </Menu.Item>
      <Menu.Item className="bn-menu-item" onClick={() => cfg.onAskAI()}>
        <MIRow icon={<Sparkles size={16} />} label="Ask AI" />
      </Menu.Item>
    </>
  );
}

// Humanize a BlockNote block type (+ heading level) for the menu header,
// the way Notion labels the selected block ("Heading 3", "To-do list").
function prettyType(type: string, props?: unknown): string {
  const level = (props as { level?: number } | undefined)?.level;
  switch (type) {
    case "paragraph": return "Text";
    case "heading": return `Heading ${level ?? 1}`;
    case "bulletListItem": return "Bulleted list";
    case "numberedListItem": return "Numbered list";
    case "checkListItem": return "To-do list";
    case "toggleListItem": return "Toggle list";
    case "quote": return "Quote";
    case "codeBlock": return "Code";
    case "callout": return "Callout";
    case "toc": return "Table of contents";
    case "equation": return "Equation";
    case "bookmark": return "Web bookmark";
    case "columns": return "Columns";
    case "subpage": return "Sub-page";
    case "image": return "Image";
    case "video": return "Video";
    case "audio": return "Audio";
    case "file": return "File";
    case "table": return "Table";
    default: return type.charAt(0).toUpperCase() + type.slice(1);
  }
}
