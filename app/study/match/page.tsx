"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Flashcard } from "@/types";

const PAIRS_COUNT = 6;

type Phase = "loading" | "empty" | "running" | "finished";

interface Tile {
  key: string; // benzersiz tile id
  cardId: string; // eşleşme kontrolü için
  label: string;
  kind: "word" | "meaning";
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function MatchModePage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [matchedCardIds, setMatchedCardIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Tile[]>([]);
  const [wrongFlash, setWrongFlash] = useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = useState(0);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [finalDuration, setFinalDuration] = useState(0);

  const [personalBestMs, setPersonalBestMs] = useState<number | null>(null);
  const [isNewRecord, setIsNewRecord] = useState(false);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchPersonalBest() {
    const { data } = await supabase
      .from("match_results")
      .select("duration_ms")
      .eq("pairs_count", PAIRS_COUNT)
      .order("duration_ms", { ascending: true })
      .limit(1)
      .maybeSingle();
    setPersonalBestMs(data?.duration_ms ?? null);
  }

  function setupRound(pool: Flashcard[]) {
    const picked = shuffle(pool).slice(0, Math.min(PAIRS_COUNT, pool.length));
    const wordTiles: Tile[] = picked.map((c) => ({
      key: `w-${c.id}`,
      cardId: c.id,
      label: c.word,
      kind: "word",
    }));
    const meaningTiles: Tile[] = picked.map((c) => ({
      key: `m-${c.id}`,
      cardId: c.id,
      label: c.meaning,
      kind: "meaning",
    }));
    setTiles(shuffle([...wordTiles, ...meaningTiles]));
    setMatchedCardIds(new Set());
    setSelected([]);
    setWrongFlash(new Set());
    setMistakes(0);
    setElapsedMs(0);
    setFinalDuration(0);
    setIsNewRecord(false);
    setStartedAt(null);
  }

  useEffect(() => {
    async function setup() {
      setPhase("loading");
      const { data, error } = await supabase.from("flashcards").select("*");
      await fetchPersonalBest();

      if (error || !data || data.length < 2) {
        setPhase("empty");
        return;
      }

      setupRound(data as Flashcard[]);
      setPhase("running");
    }
    setup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kronometre
  useEffect(() => {
    if (phase === "running" && startedAt !== null) {
      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAt);
      }, 100);
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [phase, startedAt]);

  function handleTileClick(tile: Tile) {
    if (phase !== "running") return;
    if (matchedCardIds.has(tile.cardId)) return;
    if (selected.some((s) => s.key === tile.key)) return;
    if (selected.length === 2) return;

    if (startedAt === null) {
      setStartedAt(Date.now());
    }

    const nextSelected = [...selected, tile];
    setSelected(nextSelected);

    if (nextSelected.length === 2) {
      const [a, b] = nextSelected;

      if (a.cardId === b.cardId && a.kind !== b.kind) {
        // Doğru eşleşme
        const newMatched = new Set(matchedCardIds);
        newMatched.add(a.cardId);
        setMatchedCardIds(newMatched);
        setSelected([]);

        if (newMatched.size === PAIRS_COUNT) {
          finishRound();
        }
      } else {
        // Yanlış eşleşme — kısa bir kırmızı yanıp sönme, sonra sıfırla
        setMistakes((m) => m + 1);
        setWrongFlash(new Set([a.key, b.key]));
        setTimeout(() => {
          setWrongFlash(new Set());
          setSelected([]);
        }, 600);
      }
    }
  }

  async function finishRound() {
    const duration = startedAt ? Date.now() - startedAt : 0;
    setFinalDuration(duration);
    setPhase("finished");
    if (tickRef.current) clearInterval(tickRef.current);

    const beatRecord = personalBestMs === null || duration < personalBestMs;
    setIsNewRecord(beatRecord);

    const { error } = await supabase.from("match_results").insert({
      pairs_count: PAIRS_COUNT,
      duration_ms: duration,
      mistakes,
    });

    if (!error && beatRecord) {
      setPersonalBestMs(duration);
    }
  }

  async function handleRestart() {
    setPhase("loading");
    const { data, error } = await supabase.from("flashcards").select("*");
    if (error || !data || data.length < 2) {
      setPhase("empty");
      return;
    }
    setupRound(data as Flashcard[]);
    setPhase("running");
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">🧩 Eşleştir</h1>
          <Link href="/study" className="text-sm text-indigo-600 hover:underline">
            ← Mod seçimine dön
          </Link>
        </div>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          Kelimeyi anlamıyla eşleştir. SM-2 tekrar planını etkilemez — kendi en hızlı rekoruna karşı yarış.
        </p>

        {phase === "empty" && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-12 text-center space-y-3">
            <p className="text-4xl">🧩</p>
            <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">Eşleştirme için yeterli kelime yok.</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">En az 2 kelime gerekiyor.</p>
          </div>
        )}

        {(phase === "running" || phase === "finished") && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                ⏱️ {formatDuration(phase === "finished" ? finalDuration : elapsedMs)}
              </span>
              <span className="text-slate-400 dark:text-slate-500">
                {matchedCardIds.size} / {PAIRS_COUNT} eşleşti · {mistakes} hata
              </span>
            </div>

            {phase === "running" && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {tiles.map((tile) => {
                  const isMatched = matchedCardIds.has(tile.cardId);
                  const isSelected = selected.some((s) => s.key === tile.key);
                  const isWrong = wrongFlash.has(tile.key);

                  let classes =
                    "rounded-xl border px-3 py-4 text-center text-sm font-medium transition-all min-h-[64px] flex items-center justify-center ";

                  if (isMatched) {
                    classes += "border-green-300 bg-green-50 dark:bg-green-950 text-green-400 opacity-40 cursor-default";
                  } else if (isWrong) {
                    classes += "border-red-400 bg-red-50 dark:bg-red-950 text-red-600";
                  } else if (isSelected) {
                    classes += "border-indigo-500 bg-indigo-50 dark:bg-indigo-950 text-indigo-700";
                  } else {
                    classes +=
                      "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-indigo-300 hover:bg-indigo-50 dark:bg-indigo-950/50 cursor-pointer";
                  }

                  return (
                    <button
                      key={tile.key}
                      onClick={() => handleTileClick(tile)}
                      disabled={isMatched}
                      className={classes}
                    >
                      {tile.label}
                    </button>
                  );
                })}
              </div>
            )}

            {phase === "finished" && (
              <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-12 text-center space-y-4">
                {isNewRecord && (
                  <div className="inline-block bg-amber-100 dark:bg-amber-950 text-amber-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                    🏆 Yeni Rekor!
                  </div>
                )}
                <p className="text-4xl">🎉</p>
                <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">Tamamlandı!</p>
                <p className="text-5xl font-mono font-extrabold text-indigo-600">
                  {formatDuration(finalDuration)}
                </p>
                <p className="text-sm text-slate-400 dark:text-slate-500">{mistakes} hata ile bitirdin</p>

                {personalBestMs !== null && !isNewRecord && (
                  <p className="text-sm text-slate-400 dark:text-slate-500">
                    Kişisel rekorun: {formatDuration(personalBestMs)}
                  </p>
                )}

                <button
                  onClick={handleRestart}
                  className="rounded-xl bg-indigo-600 text-white font-medium px-6 py-3 hover:bg-indigo-700 transition-colors"
                >
                  Yeniden Başla
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
