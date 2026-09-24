"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Ana", icon: HomeIcon },
  { href: "/upload", label: "Yükle", icon: UploadIcon },
  { href: "/study", label: "Çalış", icon: StudyIcon },
  { href: "/words", label: "Kelimeler", icon: WordsIcon },
  { href: "/progress", label: "İlerleme", icon: ProgressIcon },
];

export default function BottomNav() {
  const path = usePathname();
  if (path === "/login") return null;

  return (
    <>
      <div className="h-24" />
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-[#fffcf7]/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5">
          {ITEMS.map((item) => {
            const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] ${
                    active
                      ? "text-[#0f6b5c]"
                      : "text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                  }`}
                >
                  <Icon active={active} />
                  <span className={active ? "font-semibold" : ""}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M12 16V5M8 8.5 12 4.5 16 8.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 16.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5" strokeLinecap="round" />
    </svg>
  );
}

function StudyIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8">
      <path d="M12 4 4 8l8 4 8-4-8-4Z" strokeLinejoin="round" />
      <path d="M6 10.5V16c1.8 1.4 3.8 2 6 2s4.2-.6 6-2v-5.5" strokeLinejoin="round" />
    </svg>
  );
}

function WordsIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M7 5h11a1 1 0 0 1 1 1v14H8a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1Z" />
      <path d="M7 5a2 2 0 0 0-2 2v12" />
      <path d="M10 9h6M10 13h6" strokeLinecap="round" />
    </svg>
  );
}

function ProgressIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M5 19V11M12 19V5M19 19v-6" strokeLinecap="round" />
    </svg>
  );
}
