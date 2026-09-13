import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { computeStreaks } from "@/lib/dailyActivity";
import {
  deriveLearningStage,
  LEARNING_STAGE_LABELS,
} from "@/lib/studyEngine";
import { Flashcard, LearningStage } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

async function getProgressData() {
  const { data: cardRows } = await supabase.from("flashcards").select("*");
  const cards = (cardRows ?? []) as Flashcard[];

  const { data: activityRows } = await supabase
    .from("daily_activity")
    .select("activity_date, reviews_done, new_words_done");

  const activity = activityRows ?? [];
  const activeDates = activity.filter((r) => r.reviews_done > 0).map((r) => r.activity_date as string);
  const streaks = computeStreaks(activeDates);

  const today = new Date().toISOString().slice(0, 10);
  const todayRow = activity.find((r) => r.activity_date === today);
  const todayReviews = todayRow?.reviews_done ?? 0;

  const totalReviews = activity.reduce((sum, r) => sum + r.reviews_done, 0);

  function sumNewWordsInLastNDays(n: number): number {
    const cutoff = Date.now() - n * 24 * 60 * 60 * 1000;
    return activity
      .filter((r) => new Date(r.activity_date as string).getTime() >= cutoff)
      .reduce((sum, r) => sum + r.new_words_done, 0);
  }

  const newLast7 = sumNewWordsInLastNDays(7);
  const newLast30 = sumNewWordsInLastNDays(30);

  // Genel başarı oranı
  const totalCorrect = cards.reduce((sum, c) => sum + (c.correct_count ?? 0), 0);
  const totalIncorrect = cards.reduce((sum, c) => sum + (c.incorrect_count ?? 0), 0);
  const totalAnswered = totalCorrect + totalIncorrect;
  const successRate = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null;

  const learnedCount = cards.filter((c) => c.repetitions > 0).length;
  const weakCount = cards.filter((c) => c.is_weak).length;

  // Aşama dağılımı
  const stageCounts: Record<LearningStage, number> = {
    new: 0,
    learning: 0,
    consolidating: 0,
    long_term: 0,
  };
  for (const c of cards) {
    stageCounts[deriveLearningStage(c)] += 1;
  }

  // En başarılı / en zorlanılan kelimeler (en az 3 cevap verilmiş olmalı)
  const withEnoughData = cards
    .map((c) => {
      const correct = c.correct_count ?? 0;
      const incorrect = c.incorrect_count ?? 0;
      const total = correct + incorrect;
      const rate = total > 0 ? correct / total : null;
      return { card: c, correct, incorrect, total, rate };
    })
    .filter((x) => x.total >= 3);

  const mostSuccessful = [...withEnoughData]
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, 5);

  const mostStruggled = [...withEnoughData]
    .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))
    .slice(0, 5);

  // Kelime bazlı detay tablo verisi
  const wordDetails = cards
    .map((c) => {
      const correct = c.correct_count ?? 0;
      const incorrect = c.incorrect_count ?? 0;
      const total = correct + incorrect;
      const rate = total > 0 ? Math.round((correct / total) * 100) : null;
      return { card: c, correct, incorrect, total, rate };
    })
    .sort((a, b) => b.total - a.total);

  return {
    total: cards.length,
    learnedCount,
    weakCount,
    successRate,
    streaks,
    todayReviews,
    totalReviews,
    newLast7,
    newLast30,
    stageCounts,
    mostSuccessful,
    mostStruggled,
    wordDetails,
  };
}

export default async function ProgressPage() {
  const {
    total,
    learnedCount,
    weakCount,
    successRate,
    streaks,
    todayReviews,
    totalReviews,
    newLast7,
    newLast30,
    stageCounts,
    mostSuccessful,
    mostStruggled,
    wordDetails,
  } = await getProgressData();

  const stageOrder: LearningStage[] = ["new", "learning", "consolidating", "long_term"];
  const stageColors: Record<LearningStage, string> = {
    new: "bg-slate-400",
    learning: "bg-amber-400",
    consolidating: "bg-indigo-400",
    long_term: "bg-emerald-500",
  };

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 px-6 py-12">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">📈 İlerleme</h1>
          <Link href="/" className="text-sm text-indigo-600 hover:underline">
            ← Ana sayfaya dön
          </Link>
        </div>

        {/* Üst özet kartları */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard label="Toplam Kelime" value={total} />
          <SummaryCard label="Öğrenilmiş" value={learnedCount} />
          <SummaryCard label="Bugün Tekrar" value={todayReviews} />
          <SummaryCard label="Toplam Tekrar" value={totalReviews} />
          <SummaryCard label="Başarı Oranı" value={successRate !== null ? `%${successRate}` : "—"} />
          <SummaryCard label="Güncel Seri" value={`🔥 ${streaks.current}`} />
          <SummaryCard label="En Uzun Seri" value={`🏆 ${streaks.longest}`} />
          <SummaryCard label="Zayıf Kelime" value={weakCount} accent="text-orange-600" />
        </div>

        {/* Son N günde öğrenilen */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{newLast7}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Son 7 günde öğrenilen yeni kelime</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{newLast30}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Son 30 günde öğrenilen yeni kelime</p>
          </div>
        </div>

        {/* Aşama dağılımı */}
        <section className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">🧭 Kelime Durum Dağılımı</h2>
          <div className="h-4 rounded-full overflow-hidden flex w-full bg-slate-100 dark:bg-slate-700">
            {stageOrder.map((stage) => {
              const count = stageCounts[stage];
              const pct = total > 0 ? (count / total) * 100 : 0;
              return pct > 0 ? (
                <div
                  key={stage}
                  className={stageColors[stage]}
                  style={{ width: `${pct}%` }}
                  title={`${LEARNING_STAGE_LABELS[stage]}: ${count}`}
                />
              ) : null;
            })}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {stageOrder.map((stage) => (
              <div key={stage} className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${stageColors[stage]}`} />
                <span className="text-slate-600 dark:text-slate-300">
                  {LEARNING_STAGE_LABELS[stage]}: <strong>{stageCounts[stage]}</strong>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* En başarılı / en zorlanılan */}
        <div className="grid sm:grid-cols-2 gap-4">
          <section className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-3">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100">🌟 En Başarılı Kelimeler</h2>
            {mostSuccessful.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">Henüz yeterli veri yok (en az 3 cevap gerekiyor).</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {mostSuccessful.map(({ card, rate }) => (
                  <li key={card.id} className="flex items-center justify-between">
                    <span className="text-slate-700 dark:text-slate-200 font-medium">{card.word}</span>
                    <span className="text-emerald-600 font-semibold">%{Math.round((rate ?? 0) * 100)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-3">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100">😖 En Zorlanılan Kelimeler</h2>
            {mostStruggled.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">Henüz yeterli veri yok (en az 3 cevap gerekiyor).</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {mostStruggled.map(({ card, rate }) => (
                  <li key={card.id} className="flex items-center justify-between">
                    <span className="text-slate-700 dark:text-slate-200 font-medium">{card.word}</span>
                    <span className="text-red-600 font-semibold">%{Math.round((rate ?? 0) * 100)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Kelime bazlı detay tablo */}
        <section className="space-y-3">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">📋 Kelime Bazlı Detay</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Kelime</th>
                  <th className="px-3 py-2 font-medium">Görülme</th>
                  <th className="px-3 py-2 font-medium">Doğru</th>
                  <th className="px-3 py-2 font-medium">Yanlış</th>
                  <th className="px-3 py-2 font-medium">Başarı</th>
                  <th className="px-3 py-2 font-medium">Interval</th>
                  <th className="px-3 py-2 font-medium">Ease</th>
                  <th className="px-3 py-2 font-medium">Son Tekrar</th>
                  <th className="px-3 py-2 font-medium">Sonraki Tekrar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {wordDetails.map(({ card, correct, incorrect, total: totalAnswers, rate }) => (
                  <tr key={card.id}>
                    <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-100">{card.word}</td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{totalAnswers}</td>
                    <td className="px-3 py-2 text-emerald-600">{correct}</td>
                    <td className="px-3 py-2 text-red-500">{incorrect}</td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                      {rate !== null ? `%${rate}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{card.interval}g</td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{card.ease_factor.toFixed(2)}</td>
                    <td className="px-3 py-2 text-slate-400 dark:text-slate-500 text-xs">
                      {card.last_reviewed_at
                        ? new Date(card.last_reviewed_at).toLocaleDateString("tr-TR")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-400 dark:text-slate-500 text-xs">
                      {new Date(card.next_review_date).toLocaleDateString("tr-TR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-4 text-center">
      <p className={`text-xl font-bold ${accent ?? "text-slate-800 dark:text-slate-100"}`}>{value}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{label}</p>
    </div>
  );
}
