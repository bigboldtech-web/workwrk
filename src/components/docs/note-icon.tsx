"use client";

/*
 * Note-icon rendering + the curated lucide icon set.
 *
 * Split out from note-icon-picker so that rendering a doc's icon does NOT
 * pull in the ~1MB @emoji-mart/data dataset — only opening the picker does
 * (the picker is lazy-loaded). A stored icon value is one of:
 *   - an emoji native string ("💡")
 *   - "lucide:<Name>"  (rendered via LUCIDE_MAP)
 *   - an "http(s)://…" image URL
 */

import { type ReactNode } from "react";
import {
  Star, FileText, Folder, Rocket, Target, Heart, Bookmark, Calendar,
  CheckCircle, Lightbulb, Zap, Bell, Briefcase, BookOpen, PenTool, Code, Database,
  BarChart, PieChart, TrendingUp, Users, User, MessageSquare, Mail, Phone,
  Globe, MapPin, Clock, Settings, Wrench, Shield, Lock, Key, Tag, Award, Trophy,
  Gift, Coffee, Music, Camera, Image as ImageIcon, Video, Mic, Cloud, Sun, Moon, Sparkles, Flag,
} from "lucide-react";

// Curated lucide set for the Icons tab + the map used to render them.
export const LUCIDE_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Star, FileText, Folder, Rocket, Target, Flag, Heart, Bookmark, Calendar,
  CheckCircle, Lightbulb, Zap, Bell, Briefcase, BookOpen, PenTool, Code, Database,
  BarChart, PieChart, TrendingUp, Users, User, MessageSquare, Mail, Phone,
  Globe, MapPin, Clock, Settings, Wrench, Shield, Lock, Key, Tag, Award, Trophy,
  Gift, Coffee, Music, Camera, Image: ImageIcon, Video, Mic, Cloud, Sun, Moon, Sparkles,
};
export const LUCIDE_NAMES = Object.keys(LUCIDE_MAP);

/** Render any stored note-icon value as a display node. */
export function renderNoteIcon(value: string | undefined | null): ReactNode {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={value} alt="" className="note-icon-img" />;
  }
  if (value.startsWith("lucide:")) {
    const Cmp = LUCIDE_MAP[value.slice(7)];
    return Cmp ? <Cmp /> : <FileText />;
  }
  return <span>{value}</span>;
}
