"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Flashcard, WordGroup } from "@/types";
import {
  deriveLearningStage,
  deriveCardStatus,
  LEARNING_STAGE_LABELS,
  CARD_STATUS_LABELS,
} from "@/lib/studyEngine";

type FilterTab = "all" | "weak" | "long_term" | "new" | "grouped";

export default function WordsPage() {
  const [words, setWords] = useState<Flashcard[]>([]);
  const [groups, setGroups] = useState<WordGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");

  async function fetchAll() {
    setLoading(true);
    const [{ data: wordData }, { data: groupData }] = await Promise.all([
      supabase.from("flashcards").select("*").order("created_at", { ascending: false }),
      supabase.from("word_groups").select("*").order("name", { ascending: true }),
    ]);
    if (wordData) setWords(wordData as Flashcard[]);
    if (groupData) setGroups(groupData as WordGroup[]);
    setLoading(false);
  }

  useEffect(() => {
    fetchAll();
  }, []);

  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((g) => map.set(g.id, g.name));
    return map;
  }, [groups]);

  const filteredWords = useMemo(() => {
    let list = words;

    if (filter === "weak") {
      list = list.filter((w) => w.is_weak);
    } else if (filter === "long_term") {
      list = list.filter((w) => deriveLearningStage(w) === "long_term");
    } else if (filter === "new") {
      list = list.filter((w) => deriveLearningStage(w) === "new");
    } else if (filter === "grouped") {
      list = list.filter((w) => !!w.group_id);
    }

    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (w) =>
        w.word.toLowerCase().includes(q) ||
        w.meaning.toLowerCase().includes(q) ||
        (w.preposition ?? "").toLowerCase().includes(q)
    );
  }, [words, search, filter]);

  const weakCount = useMemo(() => words.filter((w) => w.is_weak).length, [words]);
  const groupedCount = useMemo(() => words.filter((w) => w.group_id).length, [words]);

  async function handleDelete(id: string) {
    if (!confirm("Bu kelimeyi silmek istediğine emin misin?")) return;
    const { error } = await supabase.from("flashcards").delete().eq("id", id);
    if (!error) {
      setWords((prev) => prev.filter((w) => w.id !== id));
    }
  }

  async function handleAssignGroup(word: Flashcard, value: string) {
    if (value === "__new__") {
      const name = prompt("Yeni grup adı (örn. 'artırmak/büyütmek'):");
      if (!name || !name.trim()) return;

      const { data: newGroup, error } = await supabase
        .from("word_groups")
        .insert({ name: name.trim() })
        .select()
        .single();

      if (error || !newGroup) {
        alert("Grup oluşturulamadı: " + error?.message);
        return;
      }

      setGroups((prev) => [...prev, newGroup as WordGroup]);
      await updateWordGroup(word.id, (newGroup as WordGroup).id);
      return;
    }

    if (value === "__none__") {
      await updateWordGroup(word.id, null);
      return;
    }

    await updateWordGroup(word.id, value);
  }

  async function updateWordGroup(wordId: string, groupId: string | null) {
    const { error } = await supabase.from("flashcards").update({ group_id: groupId }).eq("id", wordId);
    if (!error) {
      setWords((prev) => prev.map((w) => (w.id === wordId ? { ...w, group_id: groupId } : w)));
    } else {
      alert("Grup ataması güncellenemedi: " + error.message);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 px-6 py-12">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">📋 Tüm Kelimeler</h1>
          <Link href="/" className="text-sm text-indigo-600 hover:underline">
            ← Ana sayfaya dön
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
            Tümü ({words.length})
          </FilterButton>
          <FilterButton active={filter === "weak"} onClick={() => setFilter("weak")}>
            🟠 Zayıf ({weakCount})
          </FilterButton>
          <FilterButton active={filter === "new"} onClick={() => setFilter("new")}>
            Yeni
          </FilterButton>
          <FilterButton active={filter === "long_term"} onClick={() => setFilter("long_term")}>
            🧠 Uzun Süreli Hafıza
          </FilterButton>
          <FilterButton active={filter === "grouped"} onClick={() => setFilter("grouped")}>
            🔗 Gruplu ({groupedCount})
          </FilterButton>
        </div>

        <input
          type="text"
          placeholder="Kelime, anlam veya preposition ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Kelime</th>
                <th className="px-4 py-3 font-medium">Preposition</th>
                <th className="px-4 py-3 font-medium">Anlam</th>
                <th className="px-4 py-3 font-medium">Örnek Cümle</th>
                <th className="px-4 py-3 font-medium">Aşama</th>
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 font-medium">Grup</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Yükleniyor...
                  </td>
                </tr>
              ) : filteredWords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Kelime bulunamadı.
                  </td>
                </tr>
              ) : (
                filteredWords.map((w) => {
                  const stage = deriveLearningStage(w);
                  const status = deriveCardStatus(w);
                  return (
                    <tr key={w.id}>
                      <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">{w.word}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{w.preposition || "—"}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{w.meaning}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 italic max-w-xs truncate">
                        {w.example_sentence}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {LEARNING_STAGE_LABELS[stage]}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-medium px-2 py-1 rounded-full ${
                            status === "weak"
                              ? "bg-orange-100 dark:bg-orange-950 text-orange-700"
                              : status === "overdue"
                                ? "bg-red-100 dark:bg-red-950 text-red-700"
                                : status === "due"
                                  ? "bg-amber-100 dark:bg-amber-950 text-amber-700"
                                  : status === "strong"
                                    ? "bg-green-100 dark:bg-green-950 text-green-700"
                                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {CARD_STATUS_LABELS[status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={w.group_id ?? "__none__"}
                          onChange={(e) => handleAssignGroup(w, e.target.value)}
                          className="text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-1.5 max-w-[140px]"
                        >
                          <option value="__none__">— (grupsuz)</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                          <option value="__new__">+ Yeni grup oluştur</option>
                        </select>
                        {w.group_id && groupNameById.get(w.group_id) && (
                          <p className="text-[10px] text-indigo-500 mt-1">🔗 {groupNameById.get(w.group_id)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDelete(w.id)}
                          className="text-red-500 hover:underline text-xs"
                        >
                          Sil
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500">
          Toplam {filteredWords.length} kelime gösteriliyor. Bir kelimeyi gruplayınca, Test/Öğren
          modlarında aynı gruptan seçenekler arasından &quot;hangisi bu kelimeyle aynı anlam
          grubundan?&quot; şeklinde ara sıra soru çıkar.
        </p>
      </div>
    </main>
  );
}

function FilterButton({
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
