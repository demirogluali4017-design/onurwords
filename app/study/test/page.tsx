"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Flashcard, StudyQuestion } from "@/types";
import { buildTestQuestion, getTestableWord } from "@/lib/studyEngine";

const TEST_LENGTH = 15;
const BASE_POINTS = 100;

type Phase = "loading" | "empty" | "running" | "answered" | "finished";

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Streak arttıkça puan çarpanı büyür — kendi kendine yarış hissi burada.
function streakMultiplier(streak: number): number {
  if (streak >= 6) return 2;
  if (streak >= 3) return 1.5;
  return 1;
}

export default function TestModePage() {
  const [allCards, setAllCards] = useState<Flashcard[]>([]);
  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);

  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [lastGain, setLastGain] = useState(0);

  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [saving, setSaving] = useState(false);

  async function fetchPersonalBest() {
    const { data } = await supabase
      .from("test_results")
      .select("score")
      .order("score", { ascending: false })
      .limit(1)
      .maybeSingle();
    setPersonalBest(data?.score ?? null);
  }

  useEffect(() => {
    async function setup() {
      setPhase("loading");
      const { data, error } = await supabase.from("flashcards").select("*");

      await fetchPersonalBest();

      if (error || !data || data.length === 0) {
        setPhase("empty");
        return;
      }

      const cards = data as Flashcard[];
      setAllCards(cards);

      const picked = shuffle(cards).slice(0, Math.min(TEST_LENGTH, cards.length));
      const builtQuestions = picked.map((card) => buildTestQuestion(card, cards));

      setQuestions(builtQuestions);
      setPhase(builtQuestions.length > 0 ? "running" : "empty");
    }
    setup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelect(option: string) {
    if (phase !== "running") return;
    setSelectedOption(option);
    setPhase("answered");

    const current = questions[currentIndex];
    const isCorrect = option === current.correctAnswer;

    if (isCorrect) {
      const newStreak = streak + 1;
      const gain = Math.round(BASE_POINTS * streakMultiplier(newStreak));
      setStreak(newStreak);
      setBestStreak((b) => Math.max(b, newStreak));
      setScore((s) => s + gain);
      setLastGain(gain);
      setCorrectCount((c) => c + 1);
    } else {
      setStreak(0);
      setLastGain(0);
    }
  }

  async function handleContinue() {
    const nextIndex = currentIndex + 1;
    setSelectedOption(null);

    if (nextIndex >= questions.length) {
      setPhase("finished");
      await saveResult();
    } else {
      setCurrentIndex(nextIndex);
      setPhase("running");
    }
  }

  async function saveResult() {
    setSaving(true);
    const finalScore = score; // state güncellemesi zaten handleSelect'te yapıldı
    const beatRecord = personalBest === null || finalScore > personalBest;
    setIsNewRecord(beatRecord);

    const { error } = await supabase.from("test_results").insert({
      score: finalScore,
      correct_count: correctCount,
      total_questions: questions.length,
      best_streak: bestStreak,
    });

    if (!error && beatRecord) {
      setPersonalBest(finalScore);
    }
    setSaving(false);
  }

  function handleRestart() {
    const picked = shuffle(allCards).slice(0, Math.min(TEST_LENGTH, allCards.length));
    const builtQuestions = picked.map((card) => buildTestQuestion(card, allCards));
    setQuestions(builtQuestions);
    setCurrentIndex(0);
    setCorrectCount(0);
    setSelectedOption(null);
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setLastGain(0);
    setIsNewRecord(false);
    setPhase("running");
  }

  if (phase === "loading") {
    return (
      <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 dark:text-slate-500">Yükleniyor...</p>
      </main>
    );
  }

  const current = questions[currentIndex];
  const answered = phase === "answered";

  const promptText =
    current?.type === "mcq_fr_to_tr"
      ? "Bu kelimenin Türkçe anlamı nedir?"
      : current?.type === "mcq_tr_to_fr"
        ? "Bu anlama gelen İngilizce kelime hangisi?"
        : current?.type === "synonym"
          ? "Bu kelimeyle aynı anlam grubundan olan hangisi?"
          : "Boşluğu doğru kelimeyle tamamla:";

  const promptHeading =
    current?.type === "mcq_fr_to_tr"
      ? getTestableWord(current.card)
      : current?.type === "mcq_tr_to_fr"
        ? current.card.meaning
        : current?.type === "synonym"
          ? getTestableWord(current.card)
          : current?.blankedSentence;

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">📝 Test Modu</h1>
          <Link href="/study" className="text-sm text-indigo-600 hover:underline">
            ← Mod seçimine dön
          </Link>
        </div>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          Bu mod SM-2 tekrar planını ETKİLEMEZ — sadece kendi rekorlarına karşı yarışmak içindir.
        </p>

        {phase === "empty" && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-12 text-center space-y-3">
            <p className="text-4xl">📝</p>
            <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              Test için yeterli kelime yok.
            </p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Önce &apos;Kart Yükle&apos; sayfasından kelime ekle.
            </p>
          </div>
        )}

        {phase === "finished" && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-12 text-center space-y-4">
            {isNewRecord && (
              <div className="inline-block bg-amber-100 dark:bg-amber-950 text-amber-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                🏆 Yeni Rekor!
              </div>
            )}
            <p className="text-4xl">🏁</p>
            <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">Test bitti!</p>

            <p className="text-5xl font-extrabold text-indigo-600">{score}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 -mt-2">puan</p>

            <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto text-center pt-2">
              <div>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100">
                  {correctCount}/{questions.length}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">Doğru</p>
              </div>
              <div>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100">
                  %{Math.round((correctCount / questions.length) * 100)}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">Başarı</p>
              </div>
              <div>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100">🔥 {bestStreak}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">En uzun seri</p>
              </div>
            </div>

            {personalBest !== null && !isNewRecord && (
              <p className="text-sm text-slate-400 dark:text-slate-500">Kişisel rekorun: {personalBest} puan</p>
            )}

            {saving && <p className="text-xs text-slate-400 dark:text-slate-500">Kaydediliyor...</p>}

            <button
              onClick={handleRestart}
              className="rounded-xl bg-indigo-600 text-white font-medium px-6 py-3 hover:bg-indigo-700 transition-colors"
            >
              Yeniden Başla
            </button>
          </div>
        )}

        {(phase === "running" || phase === "answered") && current && (
          <div className="space-y-6">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 dark:text-slate-500">
                Soru {currentIndex + 1} / {questions.length}
              </span>
              <div className="flex items-center gap-3">
                {streak >= 3 && (
                  <span className="text-orange-500 font-semibold">🔥 {streak} seri</span>
                )}
                <span className="font-bold text-indigo-600">{score} puan</span>
              </div>
            </div>

            <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-8 text-center space-y-3">
              <p className="text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500 font-medium">
                {promptText}
              </p>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100">{promptHeading}</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {current.options?.map((option) => {
                const isCorrect = option === current.correctAnswer;
                const isSelected = option === selectedOption;

                let classes = "rounded-xl border px-4 py-3 text-left font-medium transition-colors ";
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
                    onClick={() => handleSelect(option)}
                    disabled={answered}
                    className={classes}
                  >
                    {option}
                  </button>
                );
              })}
            </div>

            {answered && (
              <div className="space-y-3">
                <p
                  className={`text-center text-sm font-semibold ${
                    selectedOption === current.correctAnswer ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {selectedOption === current.correctAnswer
                    ? `✅ Doğru! +${lastGain} puan${streak >= 3 ? ` (×${streakMultiplier(streak)} seri bonusu)` : ""}`
                    : `❌ Yanlış — seri sıfırlandı`}
                </p>
                <button
                  onClick={handleContinue}
                  className="w-full rounded-xl bg-indigo-600 text-white font-medium py-3 hover:bg-indigo-700 transition-colors"
                >
                  {currentIndex + 1 >= questions.length ? "Sonucu Gör →" : "Sonraki Soru →"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
