"use client";

import { useState } from "react";
import { OcrPair, OcrToken } from "@/lib/ocr";

export interface OcrDraft {
  id: string;
  word: string;
  meaning: string;
  preposition: string;
  example_sentence: string;
}

interface PageView {
  url: string;
  label: string;
  tokens: OcrToken[];
  pairs: OcrPair[];
  width: number;
  height: number;
}

export default function OcrWordPicker({
  pages,
  onClose,
}: {
  pages: PageView[];
  onClose: () => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pending, setPending] = useState<OcrToken | null>(null);
  const [drafts, setDrafts] = useState<OcrDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const page = pages[pageIndex];

  function tap(token: OcrToken) {
    setSavedCount(null);
    setError(null);
    if (pending?.id === token.id) {
      setPending(null);
      return;
    }
    if (!pending) {
      setPending(token);
      return;
    }
    setDrafts((current) => [
      {
        id: `${pending.id}:${token.id}:${current.length}`,
        word: pending.text,
        meaning: token.text,
        preposition: "",
        example_sentence: "",
      },
      ...current,
    ]);
    setPending(null);
  }

  function addPair(pair: OcrPair) {
    setSavedCount(null);
    setError(null);
    setPending(null);
    setDrafts((current) => {
      if (current.some((draft) => draft.word === pair.word && draft.meaning === pair.meaning)) return current;
      return [
        {
          id: pair.id,
          word: pair.word,
          meaning: pair.meaning,
          preposition: "",
          example_sentence: "",
        },
        ...current,
      ];
    });
  }

  function updateDraft(id: string, patch: Partial<OcrDraft>) {
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  async function saveAll() {
    const ready = drafts.filter((draft) => draft.word.trim() && draft.meaning.trim());
    if (ready.length === 0) return;
    setSaving(true);
    setError(null);
    let saved = 0;
    try {
      for (const draft of ready) {
        const res = await fetch("/api/add-word", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            word: draft.word.trim(),
            preposition: draft.preposition.trim(),
            meaning: draft.meaning.trim(),
            example_sentence: draft.example_sentence.trim(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Kelime kaydedilemedi.");
        }
        saved += 1;
      }
      setSavedCount(saved);
      setDrafts([]);
    } catch (err) {
      setSavedCount(saved > 0 ? saved : null);
      setError(err instanceof Error ? err.message : "Beklenmeyen hata.");
    } finally {
      setSaving(false);
    }
  }

  const photo = (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={page.url} alt={page.label} className="block h-auto max-h-72 w-full object-contain" />
        {page.tokens.map((token) => {
          const active = pending?.id === token.id;
          return (
            <button
              key={token.id}
              type="button"
              onClick={() => tap(token)}
              title={token.text}
              className={`absolute border text-[0px] ${
                active
                  ? "border-indigo-600 bg-indigo-500/35"
                  : "border-transparent bg-indigo-400/10 hover:border-indigo-500 hover:bg-indigo-400/25"
              }`}
              style={{
                left: `${(token.bbox.x0 / page.width) * 100}%`,
                top: `${(token.bbox.y0 / page.height) * 100}%`,
                width: `${((token.bbox.x1 - token.bbox.x0) / page.width) * 100}%`,
                height: `${((token.bbox.y1 - token.bbox.y0) / page.height) * 100}%`,
              }}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {pending
            ? `Kelime: ${pending.text}. Şimdi Türkçe anlama dokun.`
            : "Önce İngilizce kelimeye, sonra anlamına dokun."}
        </p>
        <button type="button" onClick={onClose} className="text-sm text-indigo-600 hover:underline">
          Seçimi kapat
        </button>
      </div>

      {pages.length > 1 && (
        <div className="flex gap-2">
          {pages.map((item, index) => (
            <button
              key={item.url}
              type="button"
              onClick={() => setPageIndex(index)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                index === pageIndex
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {page.pairs.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">Satırdan tek dokunuş</p>
          <div className="space-y-2">
            {page.pairs.map((pair) => {
              const added = drafts.some((draft) => draft.word === pair.word && draft.meaning === pair.meaning);
              return (
                <button
                  key={pair.id}
                  type="button"
                  onClick={() => addPair(pair)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left text-sm ${
                    added
                      ? "border-indigo-600 bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-100"
                      : "border-slate-200 bg-white text-slate-800 hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  }`}
                >
                  <span>
                    <span className="font-semibold">{pair.word}</span>
                    <span className="text-slate-400"> — </span>
                    <span>{pair.meaning}</span>
                  </span>
                  <span className="shrink-0 text-xs">{added ? "Eklendi" : "Ekle"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {page.tokens.length === 0 ? (
        <p className="text-sm text-slate-500">Bu sayfada okunabilir kelime bulunamadı.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {page.tokens.map((token) => {
            const active = pending?.id === token.id;
            return (
              <button
                key={`${token.id}-chip`}
                type="button"
                onClick={() => tap(token)}
                className={`rounded-full border px-3 py-2 text-base ${
                  active
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                }`}
              >
                {token.text}
              </button>
            );
          })}
        </div>
      )}

      <details className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 md:hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm text-slate-600 dark:text-slate-300">Fotoğrafta göster</summary>
        {photo}
      </details>
      <div className="hidden md:block">{photo}</div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Seçilen kartlar ({drafts.length})
          </h2>
          <button
            type="button"
            onClick={saveAll}
            disabled={saving || drafts.length === 0}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Kaydediliyor..." : "Seçilenleri ekle"}
          </button>
        </div>

        {drafts.map((draft) => (
          <div
            key={draft.id}
            className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={draft.word}
                onChange={(event) => updateDraft(draft.id, { word: event.target.value })}
                aria-label="Kelime"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
              <input
                value={draft.meaning}
                onChange={(event) => updateDraft(draft.id, { meaning: event.target.value })}
                aria-label="Anlam"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <input
              value={draft.example_sentence}
              onChange={(event) => updateDraft(draft.id, { example_sentence: event.target.value })}
              placeholder="Örnek cümle"
              aria-label="Örnek cümle"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={draft.preposition}
                onChange={(event) => updateDraft(draft.id, { preposition: event.target.value })}
                placeholder="Edat"
                aria-label="Edat"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
              <button
                type="button"
                onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:border-red-300 hover:text-red-600 dark:border-slate-700"
              >
                Sil
              </button>
            </div>
          </div>
        ))}

        {drafts.length === 0 && (
          <p className="text-sm text-slate-400">Henüz kart yok.</p>
        )}
      </div>

      {savedCount !== null && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:bg-green-950">
          ✅ {savedCount} kelime kaydedildi.
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950">
          ⚠️ {error}
          {savedCount ? ` ${savedCount} kelime bundan önce kaydedildi.` : ""}
        </div>
      )}
    </div>
  );
}
