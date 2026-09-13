"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { calculateSM2 } from "@/lib/sm2";
import { logDailyActivity } from "@/lib/dailyActivity";
import { Flashcard, SelfAssessment } from "@/types";
import FlashCardView from "@/components/FlashCardView";
import { computeWeakWordUpdate } from "@/lib/studyEngine";

type Phase = "loading" | "empty" | "front" | "back";
type DayFilter = "all" | "7" | "30";

const DEFAULT_THRESHOLD = 2;

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export default function NewWordsModePage() {
  const [allNewCards, setAllNewCards] = useState<Flashcard[]>([]);
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [reviewedCount, setReviewedCount] = useState(0);
  const [graduatedCount, setGraduatedCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [autoPromoteEnabled, setAutoPromoteEnabled] = useState(true);

  const loadCards = useCallback(async () => {
    setPhase("loading");

    const { data: settings } = await supabase
      .from("app_settings")
      .select("learning_phase_threshold, auto_promote_enabled")
      .eq("id", 1)
      .maybeSingle();

    if (settings) {
      setThreshold(settings.learning_phase_threshold ?? DEFAULT_THRESHOLD);
      setAutoPromoteEnabled(settings.auto_promote_enabled ?? true);
    }

    const { data, error } = await supabase
      .from("flashcards")
      .select("*")
      .eq("in_learning_phase", true);

    if (error || !data) {
      setPhase("empty");
      return;
    }

    setAllNewCards(data as Flashcard[]);
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  useEffect(() => {
    const filtered = filterByDay(allNewCards, dayFilter);
    setQueue(shuffle(filtered));
    setReviewedCount(0);
    setGraduatedCount(0);
    setPhase(filtered.length > 0 ? "front" : "empty");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allNewCards, dayFilter]);

  function filterByDay(cards: Flashcard[], filter: DayFilter): Flashcard[] {
    if (filter === "all") return cards;
    const days = filter === "7" ? 7 : 30;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return cards.filter((c) => new Date(c.created_at).getTime() >= cutoff);
  }

  const currentCard = queue[0];

  const totalForFilter = useMemo(
    () => filterByDay(allNewCards, dayFilter).length,
    [allNewCards, dayFilter]
  );

  async function applyUpdate(card: Flashcard, payload: Record<string, unknown>, wasGraduated: boolean) {
    const { error } = await supabase.from("flashcards").update(payload).eq("id", card.id);

    if (error) {
      alert("Kart güncellenirken hata oluştu: " + error.message);
      setSubmitting(false);
      return;
    }

    logDailyActivity(supabase, { review: true, newWord: true });

    if (wasGraduated) setGraduatedCount((c) => c + 1);
    setReviewedCount((c) => c + 1);

    setQueue((q) => {
      const next = q.slice(1);
      setPhase(next.length > 0 ? "front" : "empty");
      return next;
    });
    setSubmitting(false);
  }

  async function handleAssess(assessment: SelfAssessment) {
    if (!currentCard || submitting) return;
    setSubmitting(true);

    const weakUpdate = computeWeakWordUpdate(currentCard, assessment);
    const baseWeakFields = {
      correct_count: weakUpdate.correct_count,
      incorrect_count: weakUpdate.incorrect_count,
      struggle_count: weakUpdate.struggle_count,
      is_weak: weakUpdate.is_weak,
      last_reviewed_at: new Date().toISOString(),
    };

    const isPositive = assessment === "recalled" || assessment === "easy";

    if (!isPositive) {
      // Unuttum / Zorlandım → seri sıfırlanır, öğrenme kutusunda kalır
      await applyUpdate(
        currentCard,
        {
          ...baseWeakFields,
          learning_streak: 0,
          next_review_date: tomorrowISO(),
        },
        false
      );
      return;
    }

    const newStreak = (currentCard.learning_streak ?? 0) + 1;

    if (autoPromoteEnabled && newStreak >= threshold) {
      // Eşik aşıldı → gerçek SM-2'ye devret
      const rating = assessment === "easy" ? 5 : 3;
      const sm2Result = calculateSM2(
        { repetitions: 0, interval: 1, ease_factor: currentCard.ease_factor },
        rating
      );
      await applyUpdate(
        currentCard,
        {
          ...baseWeakFields,
          in_learning_phase: false,
          learning_streak: 0,
          repetitions: sm2Result.repetitions,
          interval: sm2Result.interval,
          ease_factor: sm2Result.ease_factor,
          next_review_date: sm2Result.next_review_date,
        },
        true
      );
    } else {
      // Öğrenme kutusunda kal, seriyi ilerlet
      await applyUpdate(
        currentCard,
        {
          ...baseWeakFields,
          learning_streak: newStreak,
          next_review_date: tomorrowISO(),
        },
        false
      );
    }
  }

  async function handleManualPromote() {
    if (!currentCard || submitting) return;
    setSubmitting(true);

    const sm2Result = calculateSM2(
      { repetitions: 0, interval: 1, ease_factor: currentCard.ease_factor },
      3
    );

    await applyUpdate(
      currentCard,
      {
        in_learning_phase: false,
        learning_streak: 0,
        repetitions: sm2Result.repetitions,
        interval: sm2Result.interval,
        ease_factor: sm2Result.ease_factor,
        next_review_date: sm2Result.next_review_date,
      },
      true
    );
  }

  if (phase === "loading") {
    return (
      <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 dark:text-slate-500">Yükleniyor...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">🌱 Sıfırdan Öğren</h1>
          <Link href="/study" className="text-sm text-indigo-600 hover:underline">
            ← Mod seçimine dön
          </Link>
        </div>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          {autoPromoteEnabled
            ? `Art arda ${threshold} kez Hatırladım/Çok kolaydı dersen kelime otomatik SM-2 tekrar sistemine geçer.`
            : "Otomatik geçiş kapalı — kelimeleri 'SM-2'ye Aktar' butonuyla manuel geçirebilirsin."}
        </p>

        <div className="flex items-center justify-center gap-2">
          <DayFilterButton active={dayFilter === "all"} onClick={() => setDayFilter("all")}>
            Tümü
          </DayFilterButton>
          <DayFilterButton active={dayFilter === "7"} onClick={() => setDayFilter("7")}>
            Son 7 gün
          </DayFilterButton>
          <DayFilterButton active={dayFilter === "30"} onClick={() => setDayFilter("30")}>
            Son 30 gün
          </DayFilterButton>
        </div>

        {phase === "empty" && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-12 text-center space-y-3">
            <p className="text-4xl">🌱</p>
            <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              {totalForFilter === 0
                ? "Bu filtrede öğrenme kutusunda kelime yok."
                : "Bu oturumda tüm yeni kelimeleri bitirdin!"}
            </p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {reviewedCount > 0
                ? `${reviewedCount} kelime tekrar ettin, ${graduatedCount} tanesi SM-2'ye geçti.`
                : "Yeni kelime yüklemek için 'Kart Yükle' sayfasına git."}
            </p>
          </div>
        )}

        {currentCard && (phase === "front" || phase === "back") && (
          <>
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs font-medium px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-600">
                🌱 Öğrenme kutusu: {currentCard.learning_streak ?? 0}/{threshold}
              </span>
            </div>

            <p className="text-center text-sm text-slate-400 dark:text-slate-500">
              Kalan: <span className="font-semibold text-slate-600 dark:text-slate-300">{queue.length}</span>
              {" · "}Bu oturumda tekrar edilen: {reviewedCount}
              {graduatedCount > 0 && ` · SM-2'ye geçen: ${graduatedCount}`}
            </p>

            <FlashCardView
              card={currentCard}
              isFlipped={phase === "back"}
              onFlip={() => setPhase(phase === "front" ? "back" : "front")}
            />

            {phase === "back" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto">
                  <button
                    onClick={() => handleAssess("forgot")}
                    disabled={submitting}
                    className="rounded-xl bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 font-semibold py-3 hover:bg-red-200 dark:hover:bg-red-900 transition-colors disabled:opacity-50"
                  >
                    😖 Unuttum
                  </button>
                  <button
                    onClick={() => handleAssess("struggled")}
                    disabled={submitting}
                    className="rounded-xl bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 font-semibold py-3 hover:bg-orange-200 dark:hover:bg-orange-900 transition-colors disabled:opacity-50"
                  >
                    😕 Zorlandım
                  </button>
                  <button
                    onClick={() => handleAssess("recalled")}
                    disabled={submitting}
                    className="rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-semibold py-3 hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors disabled:opacity-50"
                  >
                    🙂 Hatırladım
                  </button>
                  <button
                    onClick={() => handleAssess("easy")}
                    disabled={submitting}
                    className="rounded-xl bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 font-semibold py-3 hover:bg-green-200 dark:hover:bg-green-900 transition-colors disabled:opacity-50"
                  >
                    😄 Çok kolaydı
                  </button>
                </div>

                <button
                  onClick={handleManualPromote}
                  disabled={submitting}
                  className="w-full max-w-xl mx-auto block text-xs text-indigo-600 hover:underline disabled:opacity-50"
                >
                  ⏩ SM-2'ye Aktar (eşiği beklemeden hemen geçir)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function DayFilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? "bg-indigo-600 text-white border-indigo-600"
          : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300"
      }`}
    >
      {children}
    </button>
  );
}
