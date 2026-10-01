// The settings page glyphs, by the registry's icon name (one map, shared by
// the takeover sidebar, the Overview tiles and the All settings index).
import {
  BarChart3, Bell, Boxes, Building2, CalendarCheck, CircleUser, CreditCard, Database, FileCheck, Globe,
  Key, Keyboard, LayoutGrid, List, Network, Shapes, Shield, ShieldCheck, SlidersHorizontal, Users,
  type LucideIcon,
} from "lucide-react";
import type { SettingsIconName } from "@/lib/settings-registry";

export const SETTINGS_ICONS: Record<SettingsIconName, LucideIcon> = {
  LayoutGrid, Building2, Globe, Boxes, Users, Network, ShieldCheck, Shapes, BarChart3, Shield, Database, FileCheck,
  Key, CreditCard, List, CircleUser, SlidersHorizontal, Bell, CalendarCheck, Keyboard,
};
