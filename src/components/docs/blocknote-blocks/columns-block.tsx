"use client";

/*
 * ColumnsBlock — a "basic" multi-column text block for BlockNote.
 *
 * IMPORTANT / honest caveat: BlockNote custom blocks can't natively nest
 * other blocks, and a block has a single editable inline-content stream.
 * So this is NOT Notion's side-by-side independent columns — it is one text
 * flow laid out across N newspaper-style CSS columns (`column-count`).
 * Good for dense text (definitions, lists of short notes); not for placing
 * arbitrary blocks beside each other. (Full nested columns need the
 * GPL/commercial @blocknote/xl-multi-column package.)
 *
 *   props: { count: "2" | "3" }
 *   content: "inline"
 */

import { createReactBlockSpec } from "@blocknote/react";
import { Columns2, Columns3 } from "lucide-react";

export const columnsBlockSpec = createReactBlockSpec(
  {
    type: "columns",
    propSchema: {
      count: { default: "2" as string, values: ["2", "3"] as const },
    },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => {
      const count = (block.props as { count: string }).count === "3" ? 3 : 2;
      return (
        <div className="bn-columns" data-count={count}>
          {editor.isEditable && (
            <div className="bn-columns__toolbar" contentEditable={false}>
              <button
                type="button"
                className={`bn-columns__btn ${count === 2 ? "is-on" : ""}`}
                onClick={() => editor.updateBlock(block, { props: { count: "2" } })}
                title="Two columns"
                aria-label="Two columns"
                tabIndex={-1}
              >
                <Columns2 />
              </button>
              <button
                type="button"
                className={`bn-columns__btn ${count === 3 ? "is-on" : ""}`}
                onClick={() => editor.updateBlock(block, { props: { count: "3" } })}
                title="Three columns"
                aria-label="Three columns"
                tabIndex={-1}
              >
                <Columns3 />
              </button>
            </div>
          )}
          <div className="bn-columns__flow" style={{ columnCount: count }} ref={contentRef} />
        </div>
      );
    },
  },
);
