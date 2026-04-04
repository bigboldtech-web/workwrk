"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

export function ScreenProtection() {
  const { data: session } = useSession();
  const userEmail = (session?.user as any)?.email || "";
  const userName = (session?.user as any)?.name || "";

  useEffect(() => {
    // Disable right-click
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Disable print screen and common screenshot shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        e.preventDefault();
        document.body.style.display = "none";
        setTimeout(() => { document.body.style.display = ""; }, 100);
      }
      // Disable Ctrl+P (print)
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault();
      }
      // Disable Ctrl+S (save)
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
      }
    };

    // Blur content when window loses focus (user switching to screenshot tool)
    const handleBlur = () => {
      const main = document.querySelector("main");
      if (main) main.style.filter = "blur(8px)";
    };

    const handleFocus = () => {
      const main = document.querySelector("main");
      if (main) main.style.filter = "";
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  // Watermark overlay — shows user's email diagonally across the page
  // This is the most practical deterrent: if someone screenshots, their identity is visible
  return (
    <div
      className="fixed inset-0 pointer-events-none z-[9999] select-none"
      style={{
        backgroundImage: `repeating-linear-gradient(
          -45deg,
          transparent,
          transparent 200px,
          rgba(128, 128, 128, 0.03) 200px,
          rgba(128, 128, 128, 0.03) 201px
        )`,
      }}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transform: "rotate(-30deg)",
          opacity: 0.04,
          fontSize: "14px",
          fontFamily: "monospace",
          lineHeight: "80px",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {Array.from({ length: 20 }).map((_, row) => (
          <div key={row} className="whitespace-nowrap" style={{ marginLeft: row % 2 === 0 ? 0 : 100 }}>
            {Array.from({ length: 10 }).map((_, col) => (
              <span key={col} className="inline-block mx-16">
                {userEmail || userName}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
