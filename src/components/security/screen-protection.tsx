"use client";

import { useEffect } from "react";

export function ScreenProtection() {
  useEffect(() => {
    // Disable right-click
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    // Disable print screen and common shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        e.preventDefault();
        document.body.style.display = "none";
        setTimeout(() => { document.body.style.display = ""; }, 100);
      }
      if (e.ctrlKey && e.key === "p") e.preventDefault();
      if (e.ctrlKey && e.key === "s") e.preventDefault();
    };

    // Blur content when window loses focus
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

  return null;
}
