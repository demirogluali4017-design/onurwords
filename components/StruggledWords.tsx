"use client";

import { useState } from "react";

export interface StruggledWord {
  id: string;
  word: string;
  meaning: string;
  example: string;
  rate: number;
}

export default function StruggledWords({ items }: { items: StruggledWord[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-400 dark:text-slate-500">Henüz yeterli veri yok (en az 3 cevap gerekiyor).</p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => {
        const open = openId === item.id;
        const miss = Math.max(0, 100 - item.rate);
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : item.id)}
              aria-expanded={open}
              className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                open
                  ? "border-orange-300 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/40"
                  : "border-slate-200 bg-slate-50 hover:border-orange-200 dark:border-slate-700 dark:bg-slate-900"
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white font-display text-sm text-orange-700 shadow-sm dark:bg-slate-800">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg text-slate-900 dark:text-slate-50">{item.word}</span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <span className="block h-full rounded-full bg-orange-500" style={{ width: `${miss}%` }} />
                  </span>
                </span>
                <span className="font-semibold text-red-600">%{item.rate}</span>
              </span>
              {open && (
                <span className="mt-3 block border-t border-orange-200 pt-3 dark:border-orange-900">
                  <span className="block text-[11px] uppercase tracking-[0.16em] text-orange-700">Anlam</span>
                  <span className="mt-1 block text-base text-slate-800 dark:text-slate-100">{item.meaning || "—"}</span>
                  <span className="mt-3 block text-[11px] uppercase tracking-[0.16em] text-orange-700">Örnek cümle</span>
                  <span className="mt-1 block text-sm italic text-slate-600 dark:text-slate-300">
                    {item.example || "Örnek cümle yok."}
                  </span>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
