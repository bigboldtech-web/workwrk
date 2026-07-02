"use client";

// SidebarQuickStar — retired. The star/favorite affordance was removed from
// every sidebar row (Space / Board / Folder / Table / Doc / Whiteboard) per
// product decision. Kept as a null-rendering stub so existing call sites in the
// sidebar tree stay valid without threading changes.

type Kind = "space" | "board" | "folder" | "table" | "doc" | "whiteboard" | "file";

interface Props {
  kind: Kind;
  id: string;
}

export function SidebarQuickStar(props: Props) {
  void props;
  return null;
}
