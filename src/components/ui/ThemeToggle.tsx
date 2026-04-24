"use client";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

type ThemeMode = "dark" | "light" | "system";

function applyTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  const isDark =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : mode === "dark";
  document.documentElement.classList.toggle("light", !isDark);
  /* Update meta theme-color for browser chrome */
  const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (meta) meta.content = isDark ? "#0c0c16" : "#f4f4f8";
}

const LABELS: Record<ThemeMode, string> = {
  dark:   "深色",
  light:  "淺色",
  system: "跟隨系統",
};

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");

  /* Hydrate from localStorage */
  useEffect(() => {
    const saved = (localStorage.getItem("theme") ?? "system") as ThemeMode;
    setMode(saved);
    applyTheme(saved);
  }, []);

  /* React to OS-level theme changes when in "system" mode */
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  function cycle() {
    const order: ThemeMode[] = ["dark", "light", "system"];
    const next = order[(order.indexOf(mode) + 1) % 3];
    setMode(next);
    applyTheme(next);
    localStorage.setItem("theme", next);
  }

  const Icon = mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;

  return (
    <button
      onClick={cycle}
      className="p-2 rounded-lg transition-smooth hover:bg-white/8 text-[#9898b0] hover:text-[#eeeef8]
                 min-w-[36px] min-h-[36px] flex items-center justify-center"
      aria-label="切換主題"
      title={LABELS[mode]}
    >
      <Icon size={17} />
    </button>
  );
}
