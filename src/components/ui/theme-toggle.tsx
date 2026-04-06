"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground transition-all w-full ${
        collapsed ? "justify-center px-2" : ""
      }`}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
      {!collapsed && <span>{isDark ? "Light Mode" : "Dark Mode"}</span>}
    </button>
  );
}
