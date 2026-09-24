"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAll";
import { Flashcard } from "@/types";

const MAX_PAIRS = 6;
const BEST_KEY = "quizanki:synonym-best";

type Phase = "loading" | "empty" | "running" | "finished";

interface Tile {
  key: string;
  cardId: string;
  groupId: string;
  word: string;
  meaning: string;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
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

function readBest(pairs: number): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, number>;
    return typeof parsed[String(pairs)] === "number" ? parsed[String(pairs)] : null;
  } catch {
    return null;
  }
}

function writeBest(pairs: number, ms: number) {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    parsed[String(pairs)] = ms;
    localStorage.setItem(BEST_KEY, JSON.stringify(parsed));
  } catch {
    // rekor kaydı isteğe bağlı
  }
}

export default function SynonymMatchPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [pairCount, setPairCount] = useState(0);
  const [matchedGroups, setMatchedGroups] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Tile[]>([]);
  const [wrongFlash, setWrongFlash] = useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [lastPair, setLastPair] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [finalDuration, setFinalDuration] = useState(0);
  const [personalBestMs, setPersonalBestMs] = useState<number | null>(null);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const poolRef = useRef<Flashcard[]>([]);

  function setupRound(pool: Flashcard[]) {
    const byGroup = new Map<string, Flashcard[]>();
    for (const card of pool) {
      if (!card.group_id) continue;
      const list = byGroup.get(card.group_id) ?? [];
      list.push(card);
      byGroup.set(card.group_id, list);
    }
    const playable = [...byGroup.values()].filter((group) => group.length >= 2);
    if (playable.length === 0) {
      setTiles([]);
      setPairCount(0);
      setPhase("empty");
      return;
    }

    const pickedGroups = shuffle(playable).slice(0, MAX_PAIRS);
    const nextTiles: Tile[] = [];
    for (const group of pickedGroups) {
      const [left, right] = shuffle(group).slice(0, 2);
      nextTiles.push(
        {
          key: `a-${left.id}`,
          cardId: left.id,
          groupId: left.group_id as string,
          word: left.word,
          meaning: left.meaning,
        },
        {
          key: `b-${right.id}`,
          cardId: right.id,
          groupId: right.group_id as string,
          word: right.word,
          meaning: right.meaning,
        }
      );
    }

    setTiles(shuffle(nextTiles));
    setPairCount(pickedGroups.length);
    setMatchedGroups(new Set());
    setSelected([]);
    setWrongFlash(new Set());
    setMistakes(0);
    setLastPair(null);
    setElapsedMs(0);
    setFinalDuration(0);
    setIsNewRecord(false);
    setStartedAt(null);
    setPersonalBestMs(readBest(pickedGroups.length));
    setPhase("running");
  }

  useEffect(() => {
    async function setup() {
      setPhase("loading");
      const cards = await fetchAllRows<Flashcard>((from, to) =>
        supabase.from("flashcards").select("*").range(from, to)
      );
      poolRef.current = cards;
      setupRound(cards);
    }
    setup();
  }, []);

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

  function finishRound(matchedSize: number, duration: number) {
    setFinalDuration(duration);
    setPhase("finished");
    if (tickRef.current) clearInterval(tickRef.current);
    const best = readBest(matchedSize);
    const beat = best === null || duration < best;
    setIsNewRecord(beat);
    if (beat) {
      writeBest(matchedSize, duration);
      setPersonalBestMs(duration);
    }
  }

  function handleTileClick(tile: Tile) {
    if (phase !== "running") return;
    if (matchedGroups.has(tile.groupId)) return;
    if (selected.some((item) => item.key === tile.key)) return;
    if (selected.length === 2) return;

    const start = startedAt ?? Date.now();
    if (startedAt === null) setStartedAt(start);

    const nextSelected = [...selected, tile];
    setSelected(nextSelected);
    if (nextSelected.length < 2) return;

    const [a, b] = nextSelected;
    if (a.groupId === b.groupId) {
      const nextMatched = new Set(matchedGroups);
      nextMatched.add(a.groupId);
      setMatchedGroups(nextMatched);
      setSelected([]);
      setLastPair(`${a.word} = ${b.word}`);
      if (nextMatched.size === pairCount) finishRound(pairCount, Date.now() - start);
      return;
    }

    setMistakes((count) => count + 1);
    setWrongFlash(new Set([a.key, b.key]));
    setTimeout(() => {
      setWrongFlash(new Set());
      setSelected([]);
    }, 600);
  }

  if (phase === "loading") {
    return (
      <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 dark:text-slate-500">Yükleniyor...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">🔁 Eş Anlamlı</h1>
          <Link href="/study" className="text-sm text-indigo-600 hover:underline">
            ← Mod seçimine dön
          </Link>
        </div>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          Aynı gruptaki iki kelimeyi eşleştir. Örneğin se former = établir. SM-2 tekrar planını etkilemez.
        </p>

        {phase === "empty" && (
          <div className="rounded-[28px] border border-[#e4d3b4] bg-[#fffaf2] p-12 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <p className="font-display text-5xl text-[#0f6b5c]">=</p>
            <p className="mt-3 text-lg font-semibold text-slate-800 dark:text-slate-100">Eş anlamlı grup yok.</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              En az iki kelimesi olan bir grup gerekir. Kelimeler sayfasından gruplayabilirsin.
            </p>
            <Link href="/words" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
              Kelimelere git
            </Link>
          </div>
        )}

        {(phase === "running" || phase === "finished") && (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-3xl font-semibold text-slate-900 dark:text-slate-50">
                  {formatDuration(phase === "finished" ? finalDuration : elapsedMs)}
                </p>
                <p className="text-xs text-slate-400">
                  {matchedGroups.size} / {pairCount} eşleşti · {mistakes} hata
                </p>
              </div>
              <div className="flex gap-1.5">
                {Array.from({ length: pairCount }).map((_, index) => (
                  <span
                    key={index}
                    className={`h-2.5 w-6 rounded-full ${
                      index < matchedGroups.size ? "bg-[#0f6b5c]" : "bg-[#e7dcc8] dark:bg-slate-700"
                    }`}
                  />
                ))}
              </div>
            </div>

            {lastPair && phase === "running" && (
              <p className="rounded-full border border-[#d7c4a3] bg-[#fffaf2] px-4 py-2 text-center font-display text-lg text-[#0f6b5c] dark:border-slate-700 dark:bg-slate-800">
                {lastPair}
              </p>
            )}

            {phase === "running" && (
              <div className="relative overflow-hidden rounded-[28px] border border-[#e4d3b4] bg-[#f6efe2] p-3 shadow-sm dark:border-slate-700 dark:bg-[#171411] sm:p-5">
                <div className="pointer-events-none absolute inset-y-6 left-1/2 hidden w-px -translate-x-1/2 border-l border-dashed border-[#c4a574] sm:block" />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {tiles.map((tile) => {
                    const isMatched = matchedGroups.has(tile.groupId);
                    const isSelected = selected.some((item) => item.key === tile.key);
                    const isWrong = wrongFlash.has(tile.key);
                    let classes =
                      "relative min-h-[92px] rounded-2xl border px-3 py-4 text-center transition-transform duration-200 flex flex-col items-center justify-center gap-1 ";
                    if (isMatched) {
                      classes += "border-[#b7d7c8] bg-[#eef7f2] text-[#0f6b5c] dark:bg-emerald-950/40";
                    } else if (isWrong) {
                      classes += "tile-shake border-red-400 bg-[#fff1ee] text-red-700";
                    } else if (isSelected) {
                      classes += "-translate-y-1 border-[#0f6b5c] bg-white text-[#0f6b5c] shadow-md dark:bg-slate-800";
                    } else {
                      classes +=
                        "border-[#eadcc4] bg-[#fffaf2] text-slate-900 hover:-translate-y-0.5 hover:border-[#0f6b5c] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50";
                    }

                    return (
                      <button
                        key={tile.key}
                        onClick={() => handleTileClick(tile)}
                        disabled={isMatched}
                        className={classes}
                      >
                        <span className="absolute left-3 top-3 h-1.5 w-1.5 rounded-full bg-[#c4a574]" />
                        <span className="font-display text-xl leading-tight">{tile.word}</span>
                        {isMatched && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">{tile.meaning}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {phase === "finished" && (
              <div className="rounded-[28px] border border-[#e4d3b4] bg-[#fffaf2] p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-8">
                {isNewRecord && (
                  <div className="mb-3 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-950">
                    🏆 Yeni Rekor!
                  </div>
                )}
                <p className="font-display text-4xl text-slate-900 dark:text-slate-50">Tamamlandı!</p>
                <p className="mt-2 font-mono text-5xl font-extrabold text-[#0f6b5c]">{formatDuration(finalDuration)}</p>
                <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">{mistakes} hata ile bitirdin</p>
                {personalBestMs !== null && !isNewRecord && (
                  <p className="text-sm text-slate-400 dark:text-slate-500">
                    Kişisel rekorun: {formatDuration(personalBestMs)}
                  </p>
                )}
                <ul className="mt-6 space-y-2 text-left">
                  {tiles
                    .filter((tile) => tile.key.startsWith("a-"))
                    .map((left) => {
                      const right = tiles.find((tile) => tile.groupId === left.groupId && tile.key !== left.key);
                      if (!right) return null;
                      return (
                        <li
                          key={left.groupId}
                          className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-white px-4 py-3 dark:bg-slate-900"
                        >
                          <span>
                            <span className="block font-display text-lg text-slate-900 dark:text-slate-50">{left.word}</span>
                            <span className="text-xs text-slate-500">{left.meaning}</span>
                          </span>
                          <span className="font-display text-2xl text-[#0f6b5c]">=</span>
                          <span className="text-right">
                            <span className="block font-display text-lg text-slate-900 dark:text-slate-50">{right.word}</span>
                            <span className="text-xs text-slate-500">{right.meaning}</span>
                          </span>
                        </li>
                      );
                    })}
                </ul>
                <button
                  onClick={() => setupRound(poolRef.current)}
                  className="mt-6 rounded-full bg-[#0f6b5c] px-6 py-3 font-medium text-white hover:bg-[#0d564b]"
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
