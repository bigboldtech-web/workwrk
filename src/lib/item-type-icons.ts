// Item-type icon registry. ItemType.icon stores a lucide icon *name*
// (a string); this resolves it to a component. Anywhere an item type
// renders — picker, manage page, board Type column — goes through
// `itemTypeIcon(name)`. Unknown names fall back to CircleDot.

import {
  CircleDot, Diamond, ClipboardList, NotebookPen, Building2, Box, Bug,
  Megaphone, FileText, Handshake, Flag, UserPlus, FolderKanban, Inbox,
  Package, BookOpen, Target, Star, Rocket, Bookmark, CheckSquare, Layers,
  Wrench, Calendar, Users, ShoppingCart, Lightbulb, type LucideIcon,
} from "lucide-react";

export const ITEM_TYPE_ICONS: Record<string, LucideIcon> = {
  CircleDot, Diamond, ClipboardList, NotebookPen, Building2, Box, Bug,
  Megaphone, FileText, Handshake, Flag, UserPlus, FolderKanban, Inbox,
  Package, BookOpen, Target, Star, Rocket, Bookmark, CheckSquare, Layers,
  Wrench, Calendar, Users, ShoppingCart, Lightbulb,
};

/** Resolve a stored icon name to a component (CircleDot fallback). */
export function itemTypeIcon(name: string | null | undefined): LucideIcon {
  return (name && ITEM_TYPE_ICONS[name]) || CircleDot;
}

/** The palette offered in the create-type icon picker (registry order). */
export const ITEM_TYPE_ICON_NAMES: string[] = Object.keys(ITEM_TYPE_ICONS);
