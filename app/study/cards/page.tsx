"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Flashcard } from "@/types";
import FlashCardView from "@/components/FlashCardView";

export default function CardsBrowsePage() {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCards() {
      setLoading(true);
      const { data, error } = await supabase
        .from("flashcards")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data) {
        setCards(data as Flashcard[]);
      }
      setLoading(false);
    }
    fetchCards();
  }, []);

  function goPrev() {
    setIsFlipped(false);
    setIndex((i) => Math.max(0, i - 1));
  }

  function goNext() {
    setIsFlipped(false);
    setIndex((i) => Math.min(cards.length - 1, i + 1));
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 dark:text-slate-500">Yükleniyor...</p>
      </main>
    );
  }

  const currentCard = cards[index];

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">🗂️ Kartlar</h1>
          <Link href="/study" className="text-sm text-indigo-600 hover:underline">
            ← Mod seçimine dön
          </Link>
        </div>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          Serbest gezinme modu — puanlama yapılmaz, SM-2 tekrar planını etkilemez.
        </p>

        {!currentCard ? (
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-12 text-center space-y-3">
            <p className="text-4xl">🗂️</p>
            <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">Henüz hiç kelime yok.</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Önce &apos;Kart Yükle&apos; sayfasından bir fotoğraf yükle.
            </p>
          </div>
        ) : (
          <>
            <p className="text-center text-sm text-slate-400 dark:text-slate-500">
              {index + 1} / {cards.length}
            </p>

            <FlashCardView
              card={currentCard}
              isFlipped={isFlipped}
              onFlip={() => setIsFlipped((f) => !f)}
            />

            <div className="flex items-center justify-center gap-4 max-w-xl mx-auto">
              <button
                onClick={goPrev}
                disabled={index === 0}
                className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium px-6 py-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Önceki
              </button>
              <button
                onClick={goNext}
                disabled={index === cards.length - 1}
                className="rounded-xl bg-indigo-600 text-white font-medium px-6 py-3 hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Sonraki →
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
