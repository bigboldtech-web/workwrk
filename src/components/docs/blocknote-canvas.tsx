"use client";

/*
 * BlockNoteCanvas — Notion-style block editor for /docs/[id].
 *
 * Replaces the old custom block-editor.tsx engine. Why BlockNote:
 *   - Slash menu, drag handle, side menu, formatting toolbar all built-in
 *   - Heading / list / toggle / quote / callout-style / code / image / video
 *     / audio / file / table / divider / page-break ship in the default schema
 *   - Built on TipTap 3 (matches our installed version)
 *
 * Persistence shape (Doc.content):
 *   {
 *     bnDoc: OurPartialBlock[],      // BlockNote's native JSON (preferred)
 *     blocks?: LegacyBlock[],     // old shape, kept for transition / OutlineRail-readable mirror
 *     meta?: { icon?, coverGradient?, coverUrl? },
 *     comments?: CommentsByBlock,
 *     version: 2,                 // disambiguates from v1 (custom editor)
 *   }
 *
 * Migration: if doc.content has no bnDoc but has blocks[], we convert on
 * the fly via `legacyBlocksToBN`. The next save persists in v2 shape.
 */

import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  SideMenuController,
  SideMenu,
  DragHandleButton,
  AddBlockButton,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, filterSuggestionItems } from "@blocknote/core";
import type { PartialBlock } from "@blocknote/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Lightbulb, ListTree, Sigma, Bookmark, Columns2, AtSign, Link as LinkIcon, Film } from "lucide-react";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import type { Block as LegacyBlock } from "./block-editor";
import { subpageBlockSpec } from "./blocknote-blocks/subpage-block";
import { calloutBlockSpec } from "./blocknote-blocks/callout-block";
import { tocBlockSpec } from "./blocknote-blocks/toc-block";
import { equationBlockSpec } from "./blocknote-blocks/equation-block";
import { bookmarkBlockSpec } from "./blocknote-blocks/bookmark-block";
import { videoEmbedBlockSpec, isPlayableVideoUrl, extractIframeSrc } from "./blocknote-blocks/video-embed-block";
import { columnsBlockSpec } from "./blocknote-blocks/columns-block";
import { mentionInlineSpec } from "./blocknote-blocks/mention-inline";
import { BlockDragMenu, BlockDragMenuProvider } from "./blocknote-blocks/block-drag-menu";

// Schema = BlockNote defaults + our workspace-specific custom blocks +
// custom inline content (mentions). Adding a new custom block is a two-line
// change here (spec import + blockSpecs entry) plus a slash-menu item below.
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    subpage: subpageBlockSpec(),
    callout: calloutBlockSpec(),
    toc: tocBlockSpec(),
    equation: equationBlockSpec(),
    bookmark: bookmarkBlockSpec(),
    videoEmbed: videoEmbedBlockSpec(),
    columns: columnsBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: mentionInlineSpec,
  },
});

// Schema-aware aliases. The default `PartialBlock` from @blocknote/core
// only knows the default block types; our subpage type isn't in that
// union. Using the schema's own helpers keeps TypeScript happy.
type OurPartialBlock = typeof schema.PartialBlock;
type EditorType = typeof schema.BlockNoteEditor;

// Extra slash-menu entries — appended after the default Notion-shaped
// items so the writer can insert a workspace-specific block with `/`.
// Grouped under "Workspace" so they read as a coherent cluster in the menu.
function workspaceSlashItems(
  editor: EditorType,
  docId?: string,
  onPageCreated?: (childId: string) => void,
): DefaultReactSuggestionItem[] {
  // Replace the current (usually empty) block with a custom one when the
  // writer triggers from a blank line — matches Notion's "type / on an
  // empty line" feel. Otherwise insert after the cursor block.
  const insert = (block: OurPartialBlock) => {
    const cur = editor.getTextCursorPosition().block;
    const isEmpty =
      cur.type === "paragraph" &&
      (!cur.content || (Array.isArray(cur.content) && cur.content.length === 0));
    if (isEmpty) {
      editor.replaceBlocks([cur], [block]);
    } else {
      editor.insertBlocks([block], cur, "after");
    }
  };

  // "Page" — Notion-style: create a brand-new note nested inside THIS note
  // (Doc.parentId = docId) and drop an inline sub-page link to it. The child
  // shows up in the sidebar tree under this note. Falls back to the picker if
  // we don't know the parent doc id or creation fails.
  const createPage = async () => {
    const ref = editor.getTextCursorPosition().block;
    const isEmpty =
      ref.type === "paragraph" &&
      (!ref.content || (Array.isArray(ref.content) && ref.content.length === 0));
    let childId = "";
    if (docId) {
      try {
        const res = await fetch("/api/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New page", content: {}, parentId: docId }),
        });
        if (res.ok) {
          const d = await res.json();
          childId = d.doc?.id ?? d.data?.id ?? d.id ?? "";
          window.dispatchEvent(new CustomEvent("workwrk:docs-changed"));
        }
      } catch { /* fall back to picker */ }
    }
    const block = { type: "subpage", props: { childDocId: childId, title: childId ? "New page" : "", emoji: "" } } as OurPartialBlock;
    if (isEmpty) editor.replaceBlocks([ref], [block]);
    else editor.insertBlocks([block], ref, "after");
    // Jump into the freshly-created page (Notion behavior). The canvas saves
    // the inline link first so it isn't lost on navigation.
    if (childId) onPageCreated?.(childId);
  };

  return [
    {
      title: "Callout",
      subtext: "Highlight a note with an emoji + colored box",
      aliases: ["callout", "info", "note", "highlight", "tip", "warning"],
      group: "Workspace",
      icon: <Lightbulb size={18} />,
      onItemClick: () =>
        insert({ type: "callout", props: { emoji: "💡", color: "blue" }, content: "" } as OurPartialBlock),
    },
    {
      title: "Table of contents",
      subtext: "Auto-generated outline from your headings",
      aliases: ["toc", "table of contents", "outline", "index", "contents"],
      group: "Workspace",
      icon: <ListTree size={18} />,
      onItemClick: () => insert({ type: "toc" } as OurPartialBlock),
    },
    {
      title: "Equation",
      subtext: "Render a LaTeX math block with KaTeX",
      aliases: ["equation", "math", "latex", "katex", "formula", "tex"],
      group: "Workspace",
      icon: <Sigma size={18} />,
      onItemClick: () => insert({ type: "equation", props: { latex: "" } } as OurPartialBlock),
    },
    {
      title: "Web bookmark",
      subtext: "Paste a link to embed a rich preview card",
      aliases: ["bookmark", "link", "url", "embed", "preview", "unfurl"],
      group: "Workspace",
      icon: <Bookmark size={18} />,
      onItemClick: () =>
        insert({ type: "bookmark", props: { url: "", title: "", description: "", image: "", favicon: "", siteName: "" } } as OurPartialBlock),
    },
    {
      title: "Video",
      subtext: "Embed a YouTube / Vimeo / Loom link or video file",
      aliases: ["video", "youtube", "vimeo", "loom", "embed", "mp4", "player", "movie"],
      group: "Workspace",
      icon: <Film size={18} />,
      onItemClick: () => insert({ type: "videoEmbed", props: { url: "" } } as OurPartialBlock),
    },
    {
      title: "Columns",
      subtext: "Flow text across multiple columns",
      aliases: ["columns", "column", "multi-column", "newspaper"],
      group: "Workspace",
      icon: <Columns2 size={18} />,
      onItemClick: () => insert({ type: "columns", props: { count: "2" }, content: "" } as OurPartialBlock),
    },
    {
      title: "Page",
      subtext: "Create a new page nested inside this one",
      aliases: ["page", "subpage", "sub-page", "child", "new page", "doc", "note"],
      group: "Workspace",
      icon: <FileText size={18} />,
      onItemClick: () => { void createPage(); },
    },
    {
      title: "Link to page",
      subtext: "Insert a link to an existing note",
      aliases: ["link", "link to page", "existing", "reference", "mention page"],
      group: "Workspace",
      icon: <LinkIcon size={18} />,
      onItemClick: () =>
        insert({ type: "subpage", props: { childDocId: "", title: "", emoji: "" } } as OurPartialBlock),
    },
  ];
}

// ───────── @-mention suggestion items ─────────
//
// Fetches people (/api/users) and pages (/api/docs) matching the query and
// returns insert handlers that drop a `mention` inline-content pill at the
// cursor. Both lists are capped so the menu stays snappy.
type MentionRow = { id: string; label: string; href: string; mkind: "user" | "doc" };

async function fetchMentionRows(query: string): Promise<MentionRow[]> {
  const q = query.trim();
  const [users, docs] = await Promise.all([
    fetch(`/api/users?scope=all&limit=8${q ? `&search=${encodeURIComponent(q)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch(`/api/docs`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const out: MentionRow[] = [];

  const userList: Array<{ id: string; firstName?: string | null; lastName?: string | null; email?: string }> =
    users?.data ?? users?.users ?? [];
  for (const u of userList.slice(0, 8)) {
    const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "Unknown";
    out.push({ id: u.id, label: name, href: `/people/${u.id}`, mkind: "user" });
  }

  const docList: Array<{ id: string; title?: string }> = docs?.docs ?? docs?.data ?? docs ?? [];
  const ql = q.toLowerCase();
  const matchedDocs = (ql ? docList.filter((d) => (d.title ?? "").toLowerCase().includes(ql)) : docList).slice(0, 6);
  for (const d of matchedDocs) {
    out.push({ id: d.id, label: d.title || "Untitled note", href: `/docs/${d.id}`, mkind: "doc" });
  }

  return out;
}

function mentionMenuItems(editor: EditorType, rows: MentionRow[]): DefaultReactSuggestionItem[] {
  return rows.map((row) => ({
    title: row.label,
    subtext: row.mkind === "user" ? "Person" : "Page",
    group: row.mkind === "user" ? "People" : "Pages",
    icon: row.mkind === "user" ? <AtSign size={16} /> : <FileText size={16} />,
    onItemClick: () => {
      // Cast the insert: our custom `mention` inline type isn't in the
      // editor's default inline-content union as TS infers it, though it is
      // registered in the runtime schema.
      const insertInline = editor.insertInlineContent as (content: unknown) => void;
      insertInline([
        { type: "mention", props: { mkind: row.mkind, refId: row.id, label: row.label, href: row.href } },
        " ", // trailing space so the caret lands after the pill
      ]);
    },
  }));
}

// Loose JSON-shaped type for the parent ↔ canvas boundary. The parent
// only stores/forwards the bnDoc as opaque JSON; teaching it our schema
// shape would force it to know about every custom block we add later.
export type BnDocJSON = PartialBlock[];

interface Props {
  /** BlockNote native JSON. If null, we fall back to converting `legacyBlocks`. */
  initialBnDoc: BnDocJSON | null;
  /** Legacy {blocks:[...]} from older docs. Used only if initialBnDoc is null. */
  legacyBlocks: LegacyBlock[] | null;
  readonly: boolean;
  /**
   * Fires on every edit (debounced internally to ~700ms idle).
   *   - bnDoc: the full BlockNote document for persistence
   *   - mirror: a LegacyBlock[] derived from the BlockNote doc, used by the
   *     surrounding chrome (OutlineRail / DocMetaStrip) without rewriting them.
   *   - plainText: concatenated text content for excerpt/search.
   */
  onChange: (bnDoc: BnDocJSON, mirror: LegacyBlock[], plainText: string) => void;
  /** Doc id — used by the block drag-menu's "Copy link to block". */
  docId?: string;
  /** Open the comments thread for a block (block drag-menu → Comment). */
  onComment?: (blockId: string) => void;
  /** Open the note's AI panel (block drag-menu → Ask AI). */
  onAskAI?: () => void;
  /**
   * What this canvas is editing. Defaults to a doc (`{type:"doc", id:docId}`)
   * so existing Notes call sites are unchanged. SOPs pass `{type:"sop", id}`,
   * which gates doc-only features (sub-page parent, copy-link base) so the
   * SAME editor works without a backing Doc.
   */
  entity?: { type: "doc" | "sop" | "policy" | "agreement"; id: string };
  /**
   * HTML-mode seeding. When set (and no bnDoc/legacyBlocks), the editor is
   * seeded by parsing this HTML into blocks on mount. Used by surfaces that
   * persist HTML strings (e.g. Policies) so they can still use this editor.
   */
  initialHtml?: string;
  /** HTML-mode change callback — receives the document serialized to HTML. */
  onHtmlChange?: (html: string) => void;
}

// Watch <html data-theme="..."> + the `.dark` class so BlockNote can
// follow the app's theme (set by ThemeApplier). Returns "dark" | "light".
function useAppTheme(): "dark" | "light" {
  const compute = (): "dark" | "light" => {
    if (typeof document === "undefined") return "light";
    const html = document.documentElement;
    // Trust the resolved app theme (data-theme, written by ThemeApplier from
    // the user's real preference incl. AUTO/night) EXCLUSIVELY when present.
    // Do NOT fall back to the `.dark` class: next-themes applies `.dark` by
    // default on first paint before ThemeApplier resolves, which would render
    // the editor dark on the white UI. Absent data-theme → light (matches the
    // default light token set).
    const dt = html.getAttribute("data-theme");
    if (dt === "dark") return "dark";
    if (dt === "light") return "light";
    return "light";
  };
  const [theme, setTheme] = useState<"dark" | "light">(compute);
  useEffect(() => {
    const html = document.documentElement;
    const obs = new MutationObserver(() => setTheme(compute()));
    obs.observe(html, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export function BlockNoteCanvas({ initialBnDoc, legacyBlocks, readonly, onChange, docId, onComment, onAskAI, entity, initialHtml, onHtmlChange }: Props) {
  const appTheme = useAppTheme();
  const router = useRouter();
  // Resolve the entity. Notes (no `entity`) behave exactly as before.
  const ent = entity ?? { type: "doc" as const, id: docId ?? "" };
  // Sub-page creation only makes sense inside a Doc tree; for SOPs pass
  // undefined so workspaceSlashItems inserts a standalone page (no parent).
  const slashDocId = ent.type === "doc" ? ent.id : undefined;
  const initialContent = useMemo<OurPartialBlock[] | undefined>(() => {
    if (initialBnDoc && initialBnDoc.length > 0) return initialBnDoc as unknown as OurPartialBlock[];
    if (legacyBlocks && legacyBlocks.length > 0) return legacyBlocksToBN(legacyBlocks);
    // BlockNote rejects an empty array — undefined means "start with one empty paragraph".
    return undefined;
  }, [initialBnDoc, legacyBlocks]);

  const editor = useCreateBlockNote({
    schema,
    initialContent,
    // Paste a video link (YouTube / Vimeo / Loom / Dadan / file) OR a full
    // <iframe …> embed snippet → drop in a playable embed. Else paste normally.
    pasteHandler: ({ event, editor: ed, defaultPasteHandler }) => {
      const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
      const html = event.clipboardData?.getData("text/html") ?? "";
      // An embed snippet (from Dadan/Loom/etc.) or a single bare video URL.
      const iframeSrc = extractIframeSrc(text) || extractIframeSrc(html);
      const url = iframeSrc || (!/\s/.test(text) && isPlayableVideoUrl(text) ? text : "");
      if (url) {
        const cur = ed.getTextCursorPosition().block;
        const isEmpty =
          cur.type === "paragraph" &&
          (!cur.content || (Array.isArray(cur.content) && cur.content.length === 0));
        const videoBlock = { type: "videoEmbed", props: { url } } as OurPartialBlock;
        if (isEmpty) ed.replaceBlocks([cur], [videoBlock]);
        else ed.insertBlocks([videoBlock], cur, "after");
        return true;
      }
      return defaultPasteHandler();
    },
  });

  // Idle-debounced save: emit onChange only after the writer pauses for
  // ~700ms. Cheaper than firing on every keystroke; the parent persists
  // straight to the API on each callback.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // BlockNote fires onChange once when it absorbs initialContent on
  // mount — that's not a user edit and persisting it would race the
  // very first real save (sending the load-time updatedAt against a
  // doc the prior emit already bumped). Skip the first fire.
  const initialEmitConsumedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onHtmlChangeRef = useRef(onHtmlChange);
  onHtmlChangeRef.current = onHtmlChange;

  // HTML-mode seed: parse the provided HTML into blocks once on mount (sync in
  // BlockNote v0.51). Only when there's no JSON/legacy source. Empty stays the
  // default empty paragraph.
  const htmlSeededRef = useRef(false);
  useEffect(() => {
    if (htmlSeededRef.current) return;
    htmlSeededRef.current = true;
    if (initialHtml && !initialBnDoc && !(legacyBlocks && legacyBlocks.length > 0)) {
      try {
        const blocks = editor.tryParseHTMLToBlocks(initialHtml);
        if (blocks.length > 0) editor.replaceBlocks(editor.document, blocks);
      } catch { /* leave the empty doc */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    if (!initialEmitConsumedRef.current) {
      initialEmitConsumedRef.current = true;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const bnDoc = editor.document as OurPartialBlock[];
      const mirror = bnToLegacyMirror(bnDoc);
      const plainText = mirror.map((b) => ("text" in b ? (b as { text: string }).text : "")).join(" ").trim();
      // Cast at the boundary — runtime data is JSON-compatible with the
      // loose PartialBlock[] used by the parent.
      onChangeRef.current(bnDoc as unknown as BnDocJSON, mirror, plainText);
      // HTML-mode surfaces (Policies) get the serialized HTML instead.
      if (onHtmlChangeRef.current) onHtmlChangeRef.current(editor.blocksToFullHTML());
    }, 700);
  }, [editor]);

  useEffect(() => {
    const unsub = editor.onChange(emit);
    return () => { unsub?.(); if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [editor, emit]);

  // Persist the current document immediately (bypassing the idle debounce).
  // Used before navigating away — e.g. after inserting a freshly-created
  // sub-page link — so the edit isn't lost when the canvas unmounts.
  const flushSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const bnDoc = editor.document as OurPartialBlock[];
    const mirror = bnToLegacyMirror(bnDoc);
    const plainText = mirror.map((b) => ("text" in b ? (b as { text: string }).text : "")).join(" ").trim();
    onChangeRef.current(bnDoc as unknown as BnDocJSON, mirror, plainText);
  }, [editor]);

  // Slash → "Page": save the inline link now, then jump into the new page.
  const onPageCreated = useCallback((childId: string) => {
    flushSave();
    // Small delay lets the save request dispatch before the route change
    // (in-flight fetches survive navigation, so the link is persisted).
    setTimeout(() => router.push(`/docs/${childId}`), 80);
  }, [flushSave, router]);

  return (
    <div className="bdoc-bn">
      <BlockNoteView
        editor={editor}
        editable={!readonly}
        theme={appTheme}
        // Disable the default slash menu + side menu — we mount our own
        // below so the workspace items (Sub-page, mentions, embeds) and the
        // Notion-style block menu live alongside BlockNote's defaults.
        slashMenu={false}
        sideMenu={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [...getDefaultReactSlashMenuItems(editor), ...workspaceSlashItems(editor, slashDocId, onPageCreated)],
              query,
            )
          }
        />
        {/* @-mentions for people + pages. Items are already query-matched
            server/client-side in fetchMentionRows, so no extra filtering. */}
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={async (query) => mentionMenuItems(editor, await fetchMentionRows(query))}
        />
        {/* Custom drag-handle: + add-block button and our Notion block menu.
            The provider feeds live docId/callbacks to the menu through
            context (survives BlockNote's portal). */}
        <BlockDragMenuProvider
          value={{
            docId: ent.id,
            linkBase: ent.type === "sop" ? "/sops/" : ent.type === "policy" ? "/policies/" : ent.type === "agreement" ? "/agreements/" : "/docs/",
            features: { comment: !!onComment, askAI: !!onAskAI },
            onComment: (id) => onComment?.(id),
            onAskAI: () => onAskAI?.(),
          }}
        >
          <SideMenuController
            sideMenu={(props) => (
              <SideMenu {...props}>
                <AddBlockButton />
                <DragHandleButton {...props} dragHandleMenu={BlockDragMenu} />
              </SideMenu>
            )}
          />
        </BlockDragMenuProvider>
      </BlockNoteView>
    </div>
  );
}

// ───────── Legacy → BlockNote conversion ─────────
//
// Maps the old custom-editor block kinds onto BlockNote's default schema.
// Unknown / custom embeds (sop_card, task_card, tasks_view, etc.) fall
// back to a paragraph containing whatever text we can pull from them, so
// no content is silently dropped during migration.

function legacyBlocksToBN(blocks: LegacyBlock[]): OurPartialBlock[] {
  const out: OurPartialBlock[] = [];
  for (const b of blocks) {
    const id = b.id;
    switch (b.kind) {
      case "paragraph":
        out.push({ id, type: "paragraph", content: b.text || "" });
        break;
      case "h1":
        out.push({ id, type: "heading", props: { level: 1 }, content: b.text || "" });
        break;
      case "h2":
        out.push({ id, type: "heading", props: { level: 2 }, content: b.text || "" });
        break;
      case "h3":
        out.push({ id, type: "heading", props: { level: 3 }, content: b.text || "" });
        break;
      case "bullet":
        out.push({ id, type: "bulletListItem", content: b.text || "" });
        break;
      case "numbered":
        out.push({ id, type: "numberedListItem", content: b.text || "" });
        break;
      case "todo":
        out.push({ id, type: "checkListItem", props: { checked: b.done }, content: b.text || "" });
        break;
      case "quote":
        out.push({ id, type: "quote", content: b.text || "" });
        break;
      case "code":
        out.push({ id, type: "codeBlock", props: { language: b.lang || "text" }, content: b.text || "" });
        break;
      case "divider":
        out.push({ id, type: "divider" });
        break;
      case "image":
        out.push({ id, type: "image", props: { url: b.url || "", caption: b.caption || "" } });
        break;
      case "file":
        out.push({ id, type: "file", props: { url: b.url || "", name: b.name || "" } });
        break;
      case "callout": {
        // Native callout block — map the legacy tri-state tone onto our
        // emoji + color props so old callouts upgrade losslessly.
        const tone = b.tone;
        const emoji = tone === "warn" ? "⚠️" : tone === "success" ? "✅" : "💡";
        const color = tone === "warn" ? "amber" : tone === "success" ? "green" : "blue";
        out.push({ id, type: "callout", props: { emoji, color }, content: b.text || "" } as OurPartialBlock);
        break;
      }
      case "toggle":
        out.push({ id, type: "toggleListItem", content: b.text || "" });
        break;
      case "embed":
        out.push({ id, type: "paragraph", content: b.url || b.title || "" });
        break;
      // Round-trips natively now that we have a BlockNote subpage block.
      case "subpage":
        out.push({
          id,
          type: "subpage",
          props: {
            childDocId: b.childDocId || "",
            title: b.title || "",
            emoji: b.emoji || "",
          },
        } as OurPartialBlock);
        break;
      // Custom workspace embeds — fall back to text so nothing is lost.
      // (Live preserved via preservedLegacyRef in BlockDocEditor so the
      // EntityLink graph still sees the originals.)
      case "sop_card":
      case "task_card":
      case "note_card":
      case "tasks_view":
      case "studio_board":
      case "sops_list":
      case "meetings_view":
      case "form":
      case "data_table":
      case "entity_link":
      case "ai_write":
      default:
        out.push({ id, type: "paragraph", content: legacyFallbackText(b) });
        break;
    }
  }
  return out;
}

function legacyFallbackText(b: LegacyBlock): string {
  if ("text" in b) return (b as { text: string }).text || "";
  if (b.kind === "subpage") return `↳ ${b.title || "Sub-page"}`;
  if (b.kind === "entity_link") return b.label || "";
  if (b.kind === "ai_write") return b.result || b.prompt || "";
  return "";
}

// ───────── BlockNote → legacy mirror ─────────
//
// Walks the BN document and produces a LegacyBlock[] for the surrounding
// chrome (OutlineRail headings, DocMetaStrip word count). Only the fields
// those consumers actually read are populated; everything else falls back
// to "paragraph" so the mirror stays a safe superset.

function bnToLegacyMirror(bnDoc: OurPartialBlock[]): LegacyBlock[] {
  const out: LegacyBlock[] = [];
  for (const b of bnDoc) {
    const id = (b.id as string | undefined) ?? Math.random().toString(36).slice(2, 10);
    const text = extractInlineText(b.content);
    switch (b.type) {
      case "heading": {
        const lvl = (b.props as { level?: number } | undefined)?.level ?? 1;
        const kind: "h1" | "h2" | "h3" = lvl === 2 ? "h2" : lvl === 3 ? "h3" : "h1";
        out.push({ id, kind, text });
        break;
      }
      case "bulletListItem": out.push({ id, kind: "bullet", text }); break;
      case "numberedListItem": out.push({ id, kind: "numbered", text }); break;
      case "checkListItem": {
        const done = !!(b.props as { checked?: boolean } | undefined)?.checked;
        out.push({ id, kind: "todo", text, done });
        break;
      }
      case "quote": out.push({ id, kind: "quote", text }); break;
      case "codeBlock": {
        const lang = (b.props as { language?: string } | undefined)?.language;
        out.push({ id, kind: "code", text, lang });
        break;
      }
      case "divider": out.push({ id, kind: "divider" }); break;
      case "image": {
        const props = (b.props as { url?: string; caption?: string } | undefined) ?? {};
        out.push({ id, kind: "image", url: props.url ?? "", caption: props.caption });
        break;
      }
      case "file": {
        const props = (b.props as { url?: string; name?: string } | undefined) ?? {};
        out.push({ id, kind: "file", name: props.name ?? "", url: props.url ?? "" });
        break;
      }
      case "toggleListItem":
        // No legacy "bullet-as-toggle" — represent as bullet for outline purposes.
        out.push({ id, kind: "bullet", text });
        break;
      case "callout": {
        const props = (b.props as { color?: string } | undefined) ?? {};
        const tone: "info" | "warn" | "success" =
          props.color === "amber" || props.color === "red" ? "warn"
          : props.color === "green" ? "success"
          : "info";
        out.push({ id, kind: "callout", text, tone });
        break;
      }
      case "toc":
        // No authored content — a paragraph proxy keeps ordering in the
        // mirror; the live block re-derives itself from the document.
        out.push({ id, kind: "paragraph", text: "" });
        break;
      case "subpage": {
        const props = (b.props as { childDocId?: string; title?: string; emoji?: string } | undefined) ?? {};
        out.push({
          id,
          kind: "subpage",
          childDocId: props.childDocId ?? "",
          title: props.title ?? "",
          emoji: props.emoji,
        });
        break;
      }
      case "paragraph":
      default:
        out.push({ id, kind: "paragraph", text });
        break;
    }
  }
  return out;
}

// BlockNote inline content can be a string, an array of inline items, or
// undefined. Flatten to plain text for the mirror. Typed loosely because
// our schema's content union (incl. custom `mention` inline content) is
// wider than the default PartialBlock content type.
function extractInlineText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && "text" in c && typeof (c as { text: unknown }).text === "string") {
          return (c as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  return "";
}
