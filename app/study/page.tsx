import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { buildDailyPackage } from "@/lib/studyEngine";
import { Flashcard } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

async function getPackageSize() {
  const { data, error } = await supabase.from("flashcards").select("*");
  const cards = (error || !data ? [] : data) as Flashcard[];
  const pkg = buildDailyPackage(cards);
  const newCount = cards.filter((c) => c.repetitions === 0).length;
  return { totalCount: pkg.totalCount, cardCount: cards.length, newCount };
}

export default async function StudyModeSelectPage() {
  const { totalCount, cardCount, newCount } = await getPackageSize();

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">🧠 Çalışma Modu Seç</h1>
          <Link href="/" className="text-sm text-indigo-600 hover:underline">
            ← Ana sayfaya dön
          </Link>
        </div>

        <div className="space-y-4">
          <ModeCard
            href="/study/learn"
            emoji="🧠"
            title="Öğren"
            recommended
            description="Ana motor — SM-2 aralıklı tekrar, öz-değerlendirme ve karışık soru tipleriyle bilimsel çalışma."
            badge={totalCount > 0 ? `${totalCount} kelime hazır` : "Bugün için paket boş"}
          />
          <ModeCard
            href="/study/new"
            emoji="🌱"
            title="Sıfırdan Öğren"
            description="Sadece hiç tekrar edilmemiş kelimeler — mevcut tekrarlarla karışmaz."
            badge={newCount > 0 ? `${newCount} yeni kelime` : "Hiç yeni kelime yok"}
          />
          <ModeCard
            href="/study/cards"
            emoji="🗂️"
            title="Kartlar"
            description="Puansız, serbest gezinme. SM-2 verisine hiç dokunmaz — sadece gözden geçirmek için."
            badge={`${cardCount} kelime`}
          />
          <ModeCard
            href="/study/test"
            emoji="📝"
            title="Test"
            description="Kendini sına — sonunda başarı yüzdeni gösteren hızlı bir sınav modu. SM-2'yi etkilemez."
            badge={`${cardCount} kelime havuzu`}
          />
          <ModeCard
            href="/study/match"
            emoji="🧩"
            title="Eşleştir"
            description="Kelimeyi anlamıyla eşleştir, süreni tut. Kendi en hızlı rekoruna karşı yarış. SM-2'yi etkilemez."
            badge={`${cardCount} kelime havuzu`}
          />
        </div>
      </div>
    </main>
  );
}

function ModeCard({
  href,
  emoji,
  title,
  description,
  badge,
  recommended,
}: {
  href: string;
  emoji: string;
  title: string;
  description: string;
  badge: string;
  recommended?: boolean;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 hover:border-indigo-400 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="text-3xl">{emoji}</span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h2>
              {recommended && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 uppercase tracking-wide">
                  Önerilen
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">{badge}</p>
    </Link>
  );
}
