"use client";

/*
 * EquationBlock — Notion-style block equation for BlockNote (KaTeX).
 *
 *   props: { latex: string }
 *   content: "none"   — the equation is atomic; the LaTeX source is edited
 *                       in an inline textarea, the result rendered by KaTeX.
 *
 * Click the rendered equation to edit; blur / Esc / Cmd+Enter commits.
 */

import { createReactBlockSpec } from "@blocknote/react";
import { useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

export const equationBlockSpec = createReactBlockSpec(
  {
    type: "equation",
    propSchema: {
      latex: { default: "" as string },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <EquationView
        latex={(block.props as { latex: string }).latex}
        editable={editor.isEditable}
        onChange={(latex) => editor.updateBlock(block, { props: { latex } })}
      />
    ),
  },
);

function EquationView({
  latex,
  editable,
  onChange,
}: {
  latex: string;
  editable: boolean;
  onChange: (latex: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);

  // Render to HTML once per LaTeX change. throwOnError:false keeps a typo
  // from blanking the page — KaTeX renders the error inline in red instead.
  const html = useMemo(() => {
    const src = editing ? draft : latex;
    if (!src.trim()) return "";
    try {
      return katex.renderToString(src, { displayMode: true, throwOnError: false, output: "html" });
    } catch {
      return "";
    }
  }, [editing, draft, latex]);

  const commit = () => { setEditing(false); if (draft !== latex) onChange(draft); };

  if (editing) {
    return (
      <div className="bn-eq bn-eq--editing" contentEditable={false}>
        <textarea
          className="bn-eq__input"
          value={draft}
          autoFocus
          spellCheck={false}
          rows={2}
          placeholder="E.g.  \\frac{a}{b} = \\sum_{i=1}^{n} x_i"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); commit(); }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); commit(); }
          }}
        />
        <div className="bn-eq__preview">
          {html ? (
            <span dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span className="bn-eq__hint">LaTeX preview appears here</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="bn-eq"
      contentEditable={false}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={() => { if (editable) { setDraft(latex); setEditing(true); } }}
      onKeyDown={(e) => {
        if (editable && (e.key === "Enter")) { e.preventDefault(); setDraft(latex); setEditing(true); }
      }}
    >
      {html ? (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="bn-eq__empty">{editable ? "Click to add an equation (LaTeX)" : "Empty equation"}</span>
      )}
    </div>
  );
}
