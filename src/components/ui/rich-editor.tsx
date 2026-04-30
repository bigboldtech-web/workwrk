"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import LinkExtension from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3, List, ListOrdered, ListChecks,
  Quote, Minus, Image as ImageIcon, Link2, Undo, Redo, Code,
  Table as TableIcon, Highlighter, AlignLeft, AlignCenter, AlignRight,
  Plus, Info, X,
} from "lucide-react";
import { usePrompt } from "@/components/ui/dialog-provider";

interface RichEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  minHeight?: string;
  /**
   * When true, render in a compact chrome suitable for embedding (e.g. a
   * step description). Default is a full-width panel with a fat toolbar.
   */
  compact?: boolean;
}

export function RichEditor({
  content,
  onChange,
  placeholder = "Start writing, or press / for commands…",
  editable = true,
  minHeight = "300px",
  compact = false,
}: RichEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prompt = usePrompt();
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");

  const editor = useEditor({
    // Prevent SSR hydration mismatch: TipTap's DOM differs from the empty
    // server-rendered wrapper otherwise.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-[#d4ff2e] underline cursor-pointer hover:text-[#e2ff6b]" },
      }),
      ImageExtension.configure({
        inline: false,
        HTMLAttributes: { class: "rounded-lg border border-border my-3 max-w-full h-auto" },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "Heading";
          return placeholder;
        },
        showOnlyWhenEditable: true,
      }),
      TaskList.configure({ HTMLAttributes: { class: "rich-task-list" } }),
      TaskItem.configure({ nested: true, HTMLAttributes: { class: "rich-task-item" } }),
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: "rich-table" },
      }),
      TableRow,
      TableHeader,
      TableCell,
      Highlight.configure({
        multicolor: false,
        HTMLAttributes: { class: "rich-highlight" },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: `rich-editor-body prose prose-sm dark:prose-invert max-w-none focus:outline-none`,
        style: `min-height: ${minHeight}; padding: ${compact ? "10px 12px" : "16px"};`,
      },
      handleKeyDown(_view, event) {
        // Open slash menu on a bare "/" at the start of a line. Lets users
        // insert blocks without hunting for the toolbar icon.
        if (!editable) return false;
        if (event.key === "/" && !slashOpen) {
          const sel = editor?.state.selection;
          if (sel && sel.empty) {
            const $from = sel.$from;
            const startOfBlock = $from.parentOffset === 0;
            if (startOfBlock) {
              setSlashOpen(true);
              setSlashFilter("");
            }
          }
        } else if (slashOpen) {
          if (event.key === "Escape") {
            setSlashOpen(false);
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
    },
  });

  // Keep filter string in sync with what's typed after the "/"
  useEffect(() => {
    if (!editor || !slashOpen) return;
    const onUpdate = () => {
      const { state } = editor;
      const $from = state.selection.$from;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", " ");
      const idx = textBefore.lastIndexOf("/");
      if (idx === -1) {
        setSlashOpen(false);
        return;
      }
      setSlashFilter(textBefore.slice(idx + 1).toLowerCase());
    };
    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      editor.off("selectionUpdate", onUpdate);
    };
  }, [editor, slashOpen]);

  // Sync external content changes into the editor without clobbering local
  // edits (TipTap's setContent resets the selection, so only run when the
  // incoming HTML actually differs).
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return <div className="h-32 bg-surface-2 rounded animate-pulse" />;

  async function addLink() {
    const prev = editor?.getAttributes("link").href || "";
    const url = await prompt({
      title: prev ? "Edit link" : "Add link",
      description: "Leave blank to remove the link.",
      defaultValue: prev,
      placeholder: "https://…",
      submitLabel: "Save",
      required: false,
    });
    if (url === null) return;
    if (url === "") {
      editor?.chain().focus().unsetLink().run();
      return;
    }
    editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  async function insertImageFromUrl() {
    const url = await prompt({
      title: "Paste image URL",
      placeholder: "https://…",
      submitLabel: "Insert image",
    });
    if (url) editor?.chain().focus().setImage({ src: url }).run();
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking same file
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      if (src) editor.chain().focus().setImage({ src }).run();
    };
    reader.readAsDataURL(file);
  }

  function insertTable() {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  // Slash-menu command catalog. Static so we never capture the ref during
  // render — the actual action resolves at click time via `runSlashCommand`.
  const slashCommands: Array<{ id: string; label: string; keywords: string[]; icon: React.ReactNode }> = [
    { id: "h1", label: "Heading 1", keywords: ["h1", "title"], icon: <Heading1 size={14} /> },
    { id: "h2", label: "Heading 2", keywords: ["h2"], icon: <Heading2 size={14} /> },
    { id: "h3", label: "Heading 3", keywords: ["h3"], icon: <Heading3 size={14} /> },
    { id: "ul", label: "Bullet list", keywords: ["ul", "bullet"], icon: <List size={14} /> },
    { id: "ol", label: "Numbered list", keywords: ["ol", "numbered"], icon: <ListOrdered size={14} /> },
    { id: "task", label: "Task list", keywords: ["todo", "checkbox", "check"], icon: <ListChecks size={14} /> },
    { id: "quote", label: "Quote", keywords: ["blockquote"], icon: <Quote size={14} /> },
    { id: "callout", label: "Callout", keywords: ["note", "info", "tip"], icon: <Info size={14} /> },
    { id: "code", label: "Code block", keywords: ["code", "pre"], icon: <Code size={14} /> },
    { id: "hr", label: "Divider", keywords: ["hr", "line"], icon: <Minus size={14} /> },
    { id: "table", label: "Table", keywords: ["grid"], icon: <TableIcon size={14} /> },
    { id: "img-url", label: "Image from URL", keywords: ["img", "picture"], icon: <ImageIcon size={14} /> },
    { id: "img-upload", label: "Upload image", keywords: ["file", "picture"], icon: <ImageIcon size={14} /> },
  ];
  const filtered = slashFilter
    ? slashCommands.filter((c) => c.label.toLowerCase().includes(slashFilter) || c.keywords.some((k) => k.includes(slashFilter)))
    : slashCommands;

  function runSlashCommand(id: string) {
    runThenClose(() => {
      if (!editor) return;
      const chain = editor.chain().focus();
      switch (id) {
        case "h1": chain.setNode("heading", { level: 1 }).run(); break;
        case "h2": chain.setNode("heading", { level: 2 }).run(); break;
        case "h3": chain.setNode("heading", { level: 3 }).run(); break;
        case "ul": chain.toggleBulletList().run(); break;
        case "ol": chain.toggleOrderedList().run(); break;
        case "task": chain.toggleTaskList().run(); break;
        case "quote":
        case "callout": chain.toggleBlockquote().run(); break;
        case "code": chain.toggleCodeBlock().run(); break;
        case "hr": chain.setHorizontalRule().run(); break;
        case "table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
        case "img-url": insertImageFromUrl(); break;
        case "img-upload": openFilePicker(); break;
      }
    });
  }

  // After running a slash-menu action, clean up: close menu, delete the
  // "/" + any filter text the user typed so we don't end up with stray
  // characters in the doc.
  function runThenClose(fn: () => void) {
    if (!editor) return;
    // Delete the "/<filter>" prefix
    const { state } = editor;
    const $from = state.selection.$from;
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", " ");
    const idx = textBefore.lastIndexOf("/");
    if (idx !== -1) {
      const deleteFrom = $from.pos - ($from.parentOffset - idx);
      editor.chain().focus().deleteRange({ from: deleteFrom, to: $from.pos }).run();
    }
    fn();
    setSlashOpen(false);
    setSlashFilter("");
  }

  return (
    <div className={`border border-border rounded-lg overflow-visible bg-background relative ${compact ? "text-sm" : ""}`}>
      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChange}
      />

      {/* Toolbar */}
      {editable && (
        <div className={`flex items-center gap-0.5 flex-wrap border-b border-border bg-surface ${compact ? "p-1" : "p-1.5"}`}>
          <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold (⌘B)"><Bold size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic (⌘I)"><Italic size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline (⌘U)"><UnderlineIcon size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough"><Strikethrough size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive("highlight")} title="Highlight"><Highlighter size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Inline code"><Code size={14} /></ToolBtn>

          <Divider />
          <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Heading 1"><Heading1 size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2"><Heading2 size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3"><Heading3 size={14} /></ToolBtn>

          <Divider />
          <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list"><List size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list"><ListOrdered size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")} title="Task list"><ListChecks size={14} /></ToolBtn>

          <Divider />
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} title="Align left"><AlignLeft size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title="Align center"><AlignCenter size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} title="Align right"><AlignRight size={14} /></ToolBtn>

          <Divider />
          <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote / callout"><Quote size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} title="Code block"><Code size={14} /></ToolBtn>
          <ToolBtn onClick={insertTable} title="Insert table"><TableIcon size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider"><Minus size={14} /></ToolBtn>

          <Divider />
          <ToolBtn onClick={addLink} active={editor.isActive("link")} title="Add link"><Link2 size={14} /></ToolBtn>
          <ToolBtn onClick={insertImageFromUrl} title="Image from URL"><ImageIcon size={14} /></ToolBtn>
          <ToolBtn onClick={openFilePicker} title="Upload image">
            <span className="flex items-center"><ImageIcon size={14} /><Plus size={10} className="-ml-0.5" /></span>
          </ToolBtn>

          <Divider />
          <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo size={14} /></ToolBtn>
        </div>
      )}

      {/* Bubble menu on non-empty selection — fast inline formatting */}
      {editable && editor && (
        <BubbleMenu editor={editor} options={{ placement: "top" }} shouldShow={({ editor: ed, from, to }: { editor: Editor; from: number; to: number }) => {
          if (!ed.isEditable) return false;
          return from !== to;
        }}>
          <div className="flex items-center gap-0.5 p-1 rounded-md border border-border bg-surface shadow-lg">
            <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold"><Bold size={12} /></ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><Italic size={12} /></ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline"><UnderlineIcon size={12} /></ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive("highlight")} title="Highlight"><Highlighter size={12} /></ToolBtn>
            <ToolBtn onClick={addLink} active={editor.isActive("link")} title="Link"><Link2 size={12} /></ToolBtn>
          </div>
        </BubbleMenu>
      )}

      {/* Editor Content */}
      <div className="relative">
        <EditorContent editor={editor} />

        {/* Slash command menu */}
        {slashOpen && editable && (
          <div className="absolute left-4 top-8 z-30 w-64 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted">Insert</span>
              <button onClick={() => setSlashOpen(false)} className="text-muted hover:text-foreground">
                <X size={12} />
              </button>
            </div>
            {filtered.length === 0 ? (
              <div className="p-3 text-xs text-muted text-center">No matches</div>
            ) : (
              <ul className="py-1">
                {filtered.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => runSlashCommand(c.id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[rgba(212,255,46,0.08)] hover:text-[#d4ff2e] text-left"
                    >
                      <span className="text-muted">{c.icon}</span>
                      <span>{c.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Inline styles for custom rendering — keeping these scoped via the
          rich-editor-body class avoids leaking into generic prose content */}
      <style jsx global>{`
        .rich-editor-body ul[data-type="taskList"] {
          list-style: none;
          padding-left: 0;
        }
        .rich-editor-body ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          margin: 0.25rem 0;
        }
        .rich-editor-body ul[data-type="taskList"] li > label {
          margin-top: 0.15rem;
        }
        .rich-editor-body ul[data-type="taskList"] li > label > input[type="checkbox"] {
          accent-color: #d4ff2e;
          width: 14px;
          height: 14px;
        }
        .rich-editor-body ul[data-type="taskList"] li > div {
          flex: 1;
        }
        .rich-editor-body ul[data-type="taskList"] li[data-checked="true"] > div {
          opacity: 0.55;
          text-decoration: line-through;
        }
        .rich-editor-body table.rich-table {
          border-collapse: collapse;
          width: 100%;
          margin: 0.75rem 0;
          table-layout: fixed;
          overflow: hidden;
        }
        .rich-editor-body table.rich-table td,
        .rich-editor-body table.rich-table th {
          border: 1px solid var(--border, #2a2a2a);
          padding: 6px 10px;
          vertical-align: top;
          position: relative;
          min-width: 80px;
        }
        .rich-editor-body table.rich-table th {
          background: rgba(212,255,46,0.05);
          font-weight: 600;
          text-align: left;
        }
        .rich-editor-body mark.rich-highlight {
          background: rgba(212,255,46,0.25);
          color: inherit;
          padding: 0 2px;
          border-radius: 2px;
        }
        .rich-editor-body blockquote {
          border-left: 3px solid #d4ff2e;
          background: rgba(212,255,46,0.04);
          padding: 0.5rem 0.75rem;
          border-radius: 0 6px 6px 0;
          margin: 0.5rem 0;
          font-style: normal;
          color: inherit;
        }
        .rich-editor-body pre {
          background: rgba(0,0,0,0.35);
          border: 1px solid var(--border, #2a2a2a);
          border-radius: 6px;
          padding: 0.75rem 1rem;
          font-size: 12.5px;
          overflow-x: auto;
        }
        .rich-editor-body hr {
          border: none;
          border-top: 1px solid var(--border, #2a2a2a);
          margin: 1rem 0;
        }
        .rich-editor-body .ProseMirror p.is-editor-empty:first-child::before,
        .rich-editor-body .ProseMirror h1.is-empty::before,
        .rich-editor-body .ProseMirror h2.is-empty::before,
        .rich-editor-body .ProseMirror h3.is-empty::before {
          color: #6b7280;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-border mx-1" />;
}

function ToolBtn({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-[rgba(212,255,46,0.12)] text-[#d4ff2e] border border-[rgba(212,255,46,0.3)]"
          : "text-muted hover:text-foreground hover:bg-surface-2 border border-transparent"
      }`}
    >
      {children}
    </button>
  );
}
