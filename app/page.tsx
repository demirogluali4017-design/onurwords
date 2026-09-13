import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { buildDailyPackage } from "@/lib/studyEngine";
import { computeStreaks } from "@/lib/dailyActivity";
import { Flashcard } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

async function getDashboardData() {
  const { data, error } = await supabase.from("flashcards").select("*");
  const cards = (error || !data ? [] : data) as Flashcard[];

  const pkg = buildDailyPackage(cards);

  const totalCorrect = cards.reduce((sum, c) => sum + (c.correct_count ?? 0), 0);
  const totalIncorrect = cards.reduce((sum, c) => sum + (c.incorrect_count ?? 0), 0);
  const totalAnswers = totalCorrect + totalIncorrect;
  const successRate = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : null;

  const longTermCount = cards.filter((c) => c.repetitions > 0 && c.interval >= 30).length;

  // Streak + günlük hedef
  const today = new Date().toISOString().slice(0, 10);

  const { data: activityRows } = await supabase
    .from("daily_activity")
    .select("activity_date, reviews_done, new_words_done");

  const activeDates = (activityRows ?? [])
    .filter((r) => r.reviews_done > 0)
    .map((r) => r.activity_date as string);
  const streaks = computeStreaks(activeDates);

  const todayRow = (activityRows ?? []).find((r) => r.activity_date === today);
  const todayReviews = todayRow?.reviews_done ?? 0;
  const todayNewWords = todayRow?.new_words_done ?? 0;

  const { data: settingsRow } = await supabase
    .from("app_settings")
    .select("daily_new_goal, daily_review_goal")
    .eq("id", 1)
    .maybeSingle();

  const dailyNewGoal = settingsRow?.daily_new_goal ?? 10;
  const dailyReviewGoal = settingsRow?.daily_review_goal ?? 30;

  return {
    total: cards.length,
    pkg,
    successRate,
    longTermCount,
    streaks,
    todayReviews,
    todayNewWords,
    dailyNewGoal,
    dailyReviewGoal,
  };
}

export default async function HomePage() {
  const {
    total,
    pkg,
    successRate,
    longTermCount,
    streaks,
    todayReviews,
    todayNewWords,
    dailyNewGoal,
    dailyReviewGoal,
  } = await getDashboardData();

  const reviewProgress = Math.min(100, Math.round((todayReviews / Math.max(1, dailyReviewGoal)) * 100));
  const newProgress = Math.min(100, Math.round((todayNewWords / Math.max(1, dailyNewGoal)) * 100));

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center px-6 py-16">
      <div className="max-w-2xl w-full text-center space-y-4">
        <h1 className="text-4xl font-extrabold text-slate-900 dark:text-slate-50">
          📚 Flashcard <span className="text-indigo-600">Anki Klonu</span>
        </h1>
        <p className="text-slate-500 dark:text-slate-400">
          Fotoğraftan İngilizce kelime çıkar, SM-2 tabanlı adaptif öğrenme motoruyla kalıcı öğren.
        </p>
      </div>

      {/* Streak */}
      <div className="flex items-center gap-6 mt-8">
        <div className="text-center">
          <p className="text-3xl font-extrabold text-orange-500">🔥 {streaks.current}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Güncel seri (gün)</p>
        </div>
        <div className="w-px h-10 bg-slate-200 dark:bg-slate-700" />
        <div className="text-center">
          <p className="text-3xl font-extrabold text-slate-400 dark:text-slate-500">🏆 {streaks.longest}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">En uzun seri</p>
        </div>
      </div>

      {/* Günlük hedef ilerlemesi */}
      <div className="grid grid-cols-2 gap-4 mt-6 max-w-md w-full">
        <GoalBar label="Tekrar" done={todayReviews} goal={dailyReviewGoal} progress={reviewProgress} color="bg-indigo-500" />
        <GoalBar label="Yeni Kelime" done={todayNewWords} goal={dailyNewGoal} progress={newProgress} color="bg-emerald-500" />
      </div>

      {/* BUGÜN paketi */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8 max-w-2xl w-full">
        <StatBox label="Gecikmiş" value={pkg.overdueCards.length} accent="text-red-600" />
        <StatBox label="Zayıf Kelime" value={pkg.weakCards.length} accent="text-orange-600" />
        <StatBox label="Tekrar" value={pkg.dueCards.length} accent="text-amber-600" />
        <StatBox label="Yeni" value={pkg.newCards.length} accent="text-indigo-600" />
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mt-4 max-w-2xl w-full">
        <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-6 text-center">
          <p className="text-sm text-slate-400 dark:text-slate-500">📚 Toplam Kelime</p>
          <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-1">{total}</p>
        </div>
        <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-6 text-center">
          <p className="text-sm text-slate-400 dark:text-slate-500">📈 Başarı Oranı</p>
          <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-1">
            {successRate !== null ? `%${successRate}` : "—"}
          </p>
        </div>
        <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-6 text-center">
          <p className="text-sm text-slate-400 dark:text-slate-500">🧠 Uzun Süreli Hafıza</p>
          <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-1">{longTermCount}</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-4 mt-10 max-w-2xl w-full">
        <Link
          href="/upload"
          className="rounded-xl bg-slate-900 text-white font-medium py-4 px-6 text-center hover:bg-slate-800 transition-colors"
        >
          ⬆️ Kart Yükle
        </Link>
        <Link
          href="/study"
          className="rounded-xl bg-indigo-600 text-white font-medium py-4 px-6 text-center hover:bg-indigo-700 transition-colors"
        >
          🧠 Çalışmaya Başla {pkg.totalCount > 0 && `(${pkg.totalCount})`}
        </Link>
        <Link
          href="/words"
          className="rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-medium py-4 px-6 text-center border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          📋 Tüm Kelimeler
        </Link>
        <Link
          href="/progress"
          className="rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-medium py-4 px-6 text-center border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          📈 İlerleme
        </Link>
      </div>
    </main>
  );
}

function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-4 text-center">
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{label}</p>
    </div>
  );
}

function GoalBar({
  label,
  done,
  goal,
  progress,
  color,
}: {
  label: string;
  done: number;
  goal: number;
  progress: number;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-slate-500 dark:text-slate-400">{label}</span>
        <span className="text-slate-400 dark:text-slate-500">
          {done}/{goal}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
