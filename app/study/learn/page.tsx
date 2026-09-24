"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAll";
import { calculateSM2 } from "@/lib/sm2";
import { logDailyActivity } from "@/lib/dailyActivity";
import { Flashcard, SelfAssessment, StudyQuestion } from "@/types";
import FlashCardView from "@/components/FlashCardView";
import {
  buildDailyPackage,
  buildQuestion,
  interleaveDailyPackage,
  mapAssessmentToRating,
  computeWeakWordUpdate,
  deriveLearningStage,
  deriveCardStatus,
  LEARNING_STAGE_LABELS,
  CARD_STATUS_LABELS,
  getTestableWord,
  getGroupSiblings,
} from "@/lib/studyEngine";

type Phase = "loading" | "empty" | "recall_front" | "recall_back" | "mcq_pending" | "mcq_answered" | "done";

const STATUS_BADGE_CLASSES: Record<string, string> = {
  new: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
  due: "bg-amber-100 dark:bg-amber-950 text-amber-700",
  overdue: "bg-red-100 dark:bg-red-950 text-red-700",
  weak: "bg-orange-100 dark:bg-orange-950 text-orange-700",
  strong: "bg-green-100 dark:bg-green-950 text-green-700",
};

export default function StudyPage() {
  const [allCards, setAllCards] = useState<Flashcard[]>([]);
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<StudyQuestion | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [packageSummary, setPackageSummary] = useState({ due: 0, overdue: 0, weak: 0, fresh: 0 });

  const loadCards = useCallback(async () => {
    setPhase("loading");
    const cards = await fetchAllRows<Flashcard>((from, to) =>
      supabase.from("flashcards").select("*").range(from, to)
    );

    if (cards.length === 0) {
      setPhase("empty");
      return;
    }

    setAllCards(cards);

    const pkg = buildDailyPackage(cards);
    setPackageSummary({
      due: pkg.dueCards.length,
      overdue: pkg.overdueCards.length,
      weak: pkg.weakCards.length,
      fresh: pkg.newCards.length,
    });

    const interleaved = interleaveDailyPackage(pkg);
    setQueue(interleaved);

    if (interleaved.length === 0) {
      setPhase("empty");
    } else {
      const first = interleaved[0];
      const question = buildQuestion(first, cards);
      setCurrentQuestion(question);
      setPhase(question.type === "recall" ? "recall_front" : "mcq_pending");
    }
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const progressLabel = useMemo(() => {
    const total = queue.length + reviewedCount;
    return `${reviewedCount} / ${total}`;
  }, [queue.length, reviewedCount]);

  async function finalizeReview(card: Flashcard, assessment: SelfAssessment) {
    if (submitting) return;
    setSubmitting(true);

    const rating = mapAssessmentToRating(assessment);

    const sm2Result = calculateSM2(
      {
        repetitions: card.repetitions,
        interval: card.interval,
        ease_factor: card.ease_factor,
      },
      rating
    );

    const weakUpdate = computeWeakWordUpdate(card, assessment);

    const { error } = await supabase
      .from("flashcards")
      .update({
        repetitions: sm2Result.repetitions,
        interval: sm2Result.interval,
        ease_factor: sm2Result.ease_factor,
        next_review_date: sm2Result.next_review_date,
        correct_count: weakUpdate.correct_count,
        incorrect_count: weakUpdate.incorrect_count,
        struggle_count: weakUpdate.struggle_count,
        is_weak: weakUpdate.is_weak,
        last_reviewed_at: new Date().toISOString(),
      })
      .eq("id", card.id);

    if (error) {
      alert("Kart güncellenirken hata oluştu: " + error.message);
      setSubmitting(false);
      return;
    }

    // Streak/günlük hedef için aktiviteyi logla (SM-2 verisini etkilemez)
    logDailyActivity(supabase, { review: true, newWord: card.repetitions === 0 });

    if (assessment !== "forgot") {
      setCorrectCount((c) => c + 1);
    }
    setReviewedCount((c) => c + 1);

    const nextQueue = queue.slice(1);
    setQueue(nextQueue);
    setSelectedOption(null);

    if (nextQueue.length === 0) {
      setPhase("done");
      setCurrentQuestion(null);
    } else {
      const nextCard = nextQueue[0];
      const nextQuestion = buildQuestion(nextCard, allCards);
      setCurrentQuestion(nextQuestion);
      setPhase(nextQuestion.type === "recall" ? "recall_front" : "mcq_pending");
    }

    setSubmitting(false);
  }

  function handleShowAnswer() {
    setPhase("recall_back");
  }

  function handleMcqSelect(option: string) {
    if (phase !== "mcq_pending") return;
    setSelectedOption(option);
    setPhase("mcq_answered");
  }

  function handleMcqContinue() {
    if (!currentQuestion) return;
    const isCorrect = selectedOption === currentQuestion.correctAnswer;
    finalizeReview(currentQuestion.card, isCorrect ? "recalled" : "forgot");
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">🧠 Öğren</h1>
          <Link href="/study" className="text-sm text-indigo-600 hover:underline">
            ← Mod seçimine dön
          </Link>
        </div>

        {phase !== "empty" && phase !== "done" && (
          <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
            <span>
              Bugünkü paket: {packageSummary.overdue} gecikmiş · {packageSummary.weak} zayıf ·{" "}
              {packageSummary.due} tekrar · {packageSummary.fresh} yeni
            </span>
            <span className="font-semibold text-slate-600 dark:text-slate-300">{progressLabel}</span>
          </div>
        )}

        {phase === "empty" && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-12 text-center space-y-3">
            <p className="text-4xl">🎉</p>
            <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              Bugünlük tekrar edilecek kart kalmadı!
            </p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Yeni kartlar yüklemek için &apos;Kart Yükle&apos; sayfasına git.
            </p>
          </div>
        )}

        {phase === "done" && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-12 text-center space-y-3">
            <p className="text-4xl">✅</p>
            <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">Bugünkü paketi bitirdin!</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {reviewedCount} kelime tekrar ettin, {correctCount} tanesini doğru bildin (%
              {reviewedCount > 0 ? Math.round((correctCount / reviewedCount) * 100) : 0}
              ).
            </p>
          </div>
        )}

        {currentQuestion && (phase === "recall_front" || phase === "recall_back") && (
          <RecallView
            question={currentQuestion}
            phase={phase}
            submitting={submitting}
            pool={allCards}
            onShowAnswer={handleShowAnswer}
            onAssess={(assessment) => finalizeReview(currentQuestion.card, assessment)}
          />
        )}

        {currentQuestion &&
          (phase === "mcq_pending" || phase === "mcq_answered") &&
          currentQuestion.options && (
            <McqView
              question={currentQuestion}
              phase={phase}
              selectedOption={selectedOption}
              submitting={submitting}
              onSelect={handleMcqSelect}
              onContinue={handleMcqContinue}
            />
          )}
      </div>
    </main>
  );
}

// ============================================================
// RECALL — kelimeyi zihinden hatırla, sonra cevabı gör, öz-değerlendir
// ============================================================
function RecallView({
  question,
  phase,
  submitting,
  pool,
  onShowAnswer,
  onAssess,
}: {
  question: StudyQuestion;
  phase: Phase;
  submitting: boolean;
  pool: Flashcard[];
  onShowAnswer: () => void;
  onAssess: (assessment: SelfAssessment) => void;
}) {
  const stage = deriveLearningStage(question.card);
  const status = deriveCardStatus(question.card);
  const groupSiblings = phase === "recall_back" ? getGroupSiblings(question.card, pool) : [];

  return (
    <div className="space-y-4">
      <StatusBadges stage={stage} status={status} />

      <FlashCardView
        card={question.card}
        isFlipped={phase === "recall_back"}
        onFlip={phase === "recall_front" ? onShowAnswer : () => {}}
      />

      {groupSiblings.length > 0 && (
        <p className="text-center text-xs text-indigo-500 dark:text-indigo-400">
          🔗 Aynı grupta: {groupSiblings.map((s) => s.word).join(", ")}
        </p>
      )}

      {phase === "recall_front" && (
        <p className="text-center text-sm text-slate-400 dark:text-slate-500">
          Cevabı zihninden hatırlamaya çalış, sonra karta tıkla.
        </p>
      )}

      {phase === "recall_back" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto">
          <button
            onClick={() => onAssess("forgot")}
            disabled={submitting}
            className="rounded-xl bg-red-100 dark:bg-red-950 text-red-700 font-semibold py-3 hover:bg-red-200 transition-colors disabled:opacity-50"
          >
            😖 Unuttum
          </button>
          <button
            onClick={() => onAssess("struggled")}
            disabled={submitting}
            className="rounded-xl bg-orange-100 dark:bg-orange-950 text-orange-700 font-semibold py-3 hover:bg-orange-200 transition-colors disabled:opacity-50"
          >
            😕 Zorlandım
          </button>
          <button
            onClick={() => onAssess("recalled")}
            disabled={submitting}
            className="rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-700 font-semibold py-3 hover:bg-amber-200 transition-colors disabled:opacity-50"
          >
            🙂 Hatırladım
          </button>
          <button
            onClick={() => onAssess("easy")}
            disabled={submitting}
            className="rounded-xl bg-green-100 dark:bg-green-950 text-green-700 font-semibold py-3 hover:bg-green-200 transition-colors disabled:opacity-50"
          >
            😄 Çok kolaydı
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MCQ / FILL BLANK — çoktan seçmeli soru görünümü
// ============================================================
function McqView({
  question,
  phase,
  selectedOption,
  submitting,
  onSelect,
  onContinue,
}: {
  question: StudyQuestion;
  phase: Phase;
  selectedOption: string | null;
  submitting: boolean;
  onSelect: (option: string) => void;
  onContinue: () => void;
}) {
  const stage = deriveLearningStage(question.card);
  const status = deriveCardStatus(question.card);
  const answered = phase === "mcq_answered";

  const promptText =
    question.type === "mcq_fr_to_tr"
      ? "Bu kelimenin Türkçe anlamı nedir?"
      : question.type === "mcq_tr_to_fr"
        ? "Bu anlama gelen İngilizce kelime hangisi?"
        : question.type === "synonym"
          ? "Bu kelimeyle aynı anlam grubundan olan hangisi?"
          : "Boşluğu doğru kelimeyle tamamla:";

  const promptHeading =
    question.type === "mcq_fr_to_tr"
      ? getTestableWord(question.card)
      : question.type === "mcq_tr_to_fr"
        ? question.card.meaning
        : question.type === "synonym"
          ? getTestableWord(question.card)
          : question.blankedSentence;

  return (
    <div className="space-y-6">
      <StatusBadges stage={stage} status={status} />

      <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-8 text-center space-y-3">
        <p className="text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500 font-medium">
          {promptText}
        </p>
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100">{promptHeading}</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto">
        {question.options?.map((option) => {
          const isCorrect = option === question.correctAnswer;
          const isSelected = option === selectedOption;

          let classes =
            "rounded-xl border px-4 py-3 text-left font-medium transition-colors ";
          if (!answered) {
            classes += "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-indigo-400 hover:bg-indigo-50 dark:bg-indigo-950";
          } else if (isCorrect) {
            classes += "border-green-400 bg-green-50 dark:bg-green-950 text-green-700";
          } else if (isSelected && !isCorrect) {
            classes += "border-red-400 bg-red-50 dark:bg-red-950 text-red-700";
          } else {
            classes += "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 opacity-50";
          }

          return (
            <button
              key={option}
              onClick={() => onSelect(option)}
              disabled={answered}
              className={classes}
            >
              {option}
            </button>
          );
        })}
      </div>

      {answered && (
        <div className="max-w-xl mx-auto space-y-3">
          <p
            className={`text-center text-sm font-medium ${
              selectedOption === question.correctAnswer ? "text-green-600" : "text-red-600"
            }`}
          >
            {selectedOption === question.correctAnswer
              ? "✅ Doğru!"
              : `❌ Yanlış — doğru cevap: ${question.correctAnswer}`}
          </p>
          <button
            onClick={onContinue}
            disabled={submitting}
            className="w-full rounded-xl bg-indigo-600 text-white font-medium py-3 hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            Sonraki Kelime →
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadges({ stage, status }: { stage: string; status: string }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="text-xs font-medium px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600">
        {LEARNING_STAGE_LABELS[stage as keyof typeof LEARNING_STAGE_LABELS]}
      </span>
      <span
        className={`text-xs font-medium px-3 py-1 rounded-full ${STATUS_BADGE_CLASSES[status] ?? "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}
      >
        {CARD_STATUS_LABELS[status as keyof typeof CARD_STATUS_LABELS]}
      </span>
    </div>
  );
}
