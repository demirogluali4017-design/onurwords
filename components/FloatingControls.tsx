"use client";

import Link from "next/link";
import { useTheme } from "@/lib/ThemeProvider";

export default function FloatingControls() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
      <Link
        href="/settings"
        className="w-9 h-9 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center text-slate-500 dark:text-slate-300 hover:border-indigo-400 transition-colors"
        title="Ayarlar"
      >
        ⚙️
      </Link>
      <button
        onClick={toggleTheme}
        className="w-9 h-9 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center text-slate-500 dark:text-slate-300 hover:border-indigo-400 transition-colors"
        title="Temayı değiştir"
      >
        {theme === "dark" ? "☀️" : "🌙"}
      </button>
    </div>
  );
}
