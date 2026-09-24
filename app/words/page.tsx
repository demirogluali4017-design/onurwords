"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAll";
import { Flashcard, WordGroup } from "@/types";
import {
  deriveLearningStage,
  deriveCardStatus,
  LEARNING_STAGE_LABELS,
  CARD_STATUS_LABELS,
} from "@/lib/studyEngine";

type FilterTab = "all" | "weak" | "long_term" | "new" | "grouped" | "ungrouped";

interface EditDraft {
  word: string;
  preposition: string;
  meaning: string;
  example_sentence: string;
}

export default function WordsPage() {
  const [words, setWords] = useState<Flashcard[]>([]);
  const [groups, setGroups] = useState<WordGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoGrouping, setAutoGrouping] = useState(false);
  const [autoGroupProgress, setAutoGroupProgress] = useState<{
    batch: number;
    groupsCreated: number;
    wordsGrouped: number;
    remaining: number;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");

  // Çoklu seçim / toplu gruplama
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkGroupValue, setBulkGroupValue] = useState("__pick__");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Satır içi düzenleme
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  async function fetchAll() {
    setLoading(true);
    const [wordData, { data: groupData }] = await Promise.all([
      fetchAllRows<Flashcard>((from, to) =>
        supabase.from("flashcards").select("*").order("created_at", { ascending: false }).range(from, to)
      ),
      supabase.from("word_groups").select("*").order("name", { ascending: true }),
    ]);
    setWords(wordData);
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
    } else if (filter === "ungrouped") {
      list = list.filter((w) => !w.group_id);
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

  // Performans: 1000+ kelimeyi (her satırda bir grup <select>'i ile)
  // aynı anda DOM'a basmak taramayı kasıyordu. Bunun yerine tek
  // seferde en fazla pageSize kadar satır render ediliyor.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    setPage(0);
  }, [search, filter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredWords.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);

  const pagedWords = useMemo(
    () => filteredWords.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [filteredWords, safePage, pageSize]
  );

  const weakCount = useMemo(() => words.filter((w) => w.is_weak).length, [words]);
  const groupedCount = useMemo(() => words.filter((w) => w.group_id).length, [words]);

  // ============================================================
  // Silme
  // ============================================================
  async function handleDelete(id: string) {
    if (!confirm("Bu kelimeyi silmek istediğine emin misin?")) return;
    const { error } = await supabase.from("flashcards").delete().eq("id", id);
    if (!error) {
      setWords((prev) => prev.filter((w) => w.id !== id));
    }
  }

  // ============================================================
  // Tekli grup atama (satır bazlı select)
  // ============================================================
  async function handleAssignGroup(word: Flashcard, value: string) {
    if (value === "__new__") {
      const name = prompt("Yeni grup adı (örn. 'artırmak/büyütmek'):");
      if (!name || !name.trim()) return;
      const newGroup = await createGroup(name.trim());
      if (newGroup) await updateWordGroup([word.id], newGroup.id);
      return;
    }
    if (value === "__none__") {
      await updateWordGroup([word.id], null);
      return;
    }
    await updateWordGroup([word.id], value);
  }

  async function createGroup(name: string): Promise<WordGroup | null> {
    const { data: newGroup, error } = await supabase
      .from("word_groups")
      .insert({ name })
      .select()
      .single();
    if (error || !newGroup) {
      alert("Grup oluşturulamadı: " + error?.message);
      return null;
    }
    setGroups((prev) => [...prev, newGroup as WordGroup]);
    return newGroup as WordGroup;
  }

  async function updateWordGroup(wordIds: string[], groupId: string | null) {
    const { error } = await supabase.from("flashcards").update({ group_id: groupId }).in("id", wordIds);
    if (!error) {
      const idSet = new Set(wordIds);
      setWords((prev) => prev.map((w) => (idSet.has(w.id) ? { ...w, group_id: groupId } : w)));
    } else {
      alert("Grup ataması güncellenemedi: " + error.message);
    }
  }

  // ============================================================
  // Mükerrer grupları birleştir — isim bazında (birebir aynı isimli)
  // birden fazla grup varsa (örn. Gemini'nin farklı parçalarda aynı
  // adla ayrı grup açması), en eskisini ana grup seçip diğerlerindeki
  // tüm kelimeleri oraya taşır, boşalan grupları siler.
  // ============================================================
  async function handleMergeDuplicateGroups() {
    const buckets = new Map<string, WordGroup[]>();
    for (const g of groups) {
      const key = g.name.trim().toLowerCase().replace(/\s+/g, " ");
      const list = buckets.get(key) ?? [];
      list.push(g);
      buckets.set(key, list);
    }

    const duplicateClusters = [...buckets.values()].filter((list) => list.length >= 2);

    if (duplicateClusters.length === 0) {
      alert("Mükerrer isimli grup bulunamadı.");
      return;
    }

    const confirmed = confirm(
      `${duplicateClusters.length} isim için mükerrer grup bulundu. Her birinde en eski grup ana grup olacak, diğerlerindeki kelimeler oraya taşınıp boşalan gruplar silinecek. Devam edilsin mi?`
    );
    if (!confirmed) return;

    setAutoGrouping(true);
    let mergedGroupCount = 0;

    try {
      for (const cluster of duplicateClusters) {
        const sorted = [...cluster].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const primary = sorted[0];
        const duplicateIds = sorted.slice(1).map((g) => g.id);

        const { error: reassignError } = await supabase
          .from("flashcards")
          .update({ group_id: primary.id })
          .in("group_id", duplicateIds);

        if (reassignError) {
          console.error("Kelimeler taşınamadı:", reassignError.message);
          continue;
        }

        const { error: deleteError } = await supabase.from("word_groups").delete().in("id", duplicateIds);
        if (!deleteError) mergedGroupCount += duplicateIds.length;
      }

      await fetchAll();
      alert(`✅ ${mergedGroupCount} mükerrer grup birleştirildi ve silindi.`);
    } finally {
      setAutoGrouping(false);
    }
  }

  // ============================================================
  // Ücretsiz gruplama — Gemini KULLANMAZ. Sadece Türkçe anlamı
  // BİREBİR (boşluk/büyük-küçük harf farkı hariç) aynı olan grupsuz
  // kelimeleri eşleştirir. Anlamı farklı ifadelerle yazılmış gerçek
  // eş anlamlıları YAKALAMAZ — onun için "Otomatik Grupla (AI)" gerekir.
  // ============================================================
  async function handleGroupByExactMeaning() {
    const ungrouped = words.filter((w) => !w.group_id);
    if (ungrouped.length < 2) {
      alert("Gruplanacak yeterli grupsuz kelime yok.");
      return;
    }

    const buckets = new Map<string, Flashcard[]>();
    for (const w of ungrouped) {
      const key = w.meaning.trim().toLowerCase().replace(/\s+/g, " ");
      if (!key) continue;
      const list = buckets.get(key) ?? [];
      list.push(w);
      buckets.set(key, list);
    }

    const clusters = [...buckets.values()].filter((list) => list.length >= 2);
    if (clusters.length === 0) {
      alert("Birebir aynı anlama sahip grupsuz kelime çifti bulunamadı. 'Otomatik Grupla (AI)' yakın anlamlıları yakalayabilir.");
      return;
    }

    setAutoGrouping(true);
    let groupsCreated = 0;
    let wordsGrouped = 0;

    try {
      for (const cluster of clusters) {
        const meaningLabel = cluster[0].meaning.trim();

        // Aynı isimde bir grup zaten varsa onu kullan, yoksa oluştur
        const existing = groups.find((g) => g.name.trim().toLowerCase() === meaningLabel.toLowerCase());
        const group = existing ?? (await createGroup(meaningLabel));
        if (!group) continue;

        await updateWordGroup(cluster.map((w) => w.id), group.id);
        groupsCreated += existing ? 0 : 1;
        wordsGrouped += cluster.length;
      }

      alert(`✅ ${groupsCreated} yeni grup, ${wordsGrouped} kelime birebir anlam eşleşmesiyle gruplandı (Gemini kullanılmadı, kotan etkilenmedi).`);
    } finally {
      setAutoGrouping(false);
    }
  }

  // ============================================================
  // Otomatik gruplama (AI) — istemci, tek-parça işleyen endpoint'i
  // ardışık olarak çağırır. Her çağrı hızlı (tek batch), zaman
  // aşımına takılmaz; ekranda gerçek zamanlı ilerleme gösterilir.
  // ============================================================
  const MAX_AUTO_GROUP_ITERATIONS = 60; // kota güvenliği için üst sınır

  async function handleAutoGroup() {
    const ungroupedCount = words.length - groupedCount;
    if (ungroupedCount < 2) {
      alert("Gruplanacak yeterli grupsuz kelime yok.");
      return;
    }

    const confirmed = confirm(
      `${ungroupedCount} grupsuz kelime Gemini ile parça parça analiz edilecek. Her parça ~80 kelime, günlük kotanı etkiler. Devam edilsin mi?`
    );
    if (!confirmed) return;

    setAutoGrouping(true);
    let totalGroups = 0;
    let totalWords = 0;
    let iteration = 0;
    const allErrors: string[] = [];

    try {
      while (iteration < MAX_AUTO_GROUP_ITERATIONS) {
        iteration += 1;
        const res = await fetch("/api/auto-group", { method: "POST" });
        const data = await res.json();

        if (!res.ok) {
          allErrors.push(data.error || "Bilinmeyen hata");
          break;
        }

        totalGroups += data.groupsCreated ?? 0;
        totalWords += data.wordsGrouped ?? 0;
        if (data.errors) allErrors.push(...data.errors);

        setAutoGroupProgress({
          batch: iteration,
          groupsCreated: totalGroups,
          wordsGrouped: totalWords,
          remaining: data.remainingUngrouped ?? 0,
        });

        if (data.done) break;
      }

      await fetchAll();
      alert(
        `✅ Tamamlandı — ${totalGroups} yeni grup, ${totalWords} kelime gruplandı (${iteration} istek).` +
          (allErrors.length > 0 ? `\n\n⚠️ Bazı parçalarda hata: ${allErrors.slice(0, 3).join(", ")}` : "")
      );
    } catch (err) {
      alert("Otomatik gruplama başarısız: " + (err instanceof Error ? err.message : "Bilinmeyen hata"));
    } finally {
      setAutoGrouping(false);
      setAutoGroupProgress(null);
    }
  }

  // ============================================================
  // Çoklu seçim / toplu gruplama
  // ============================================================
  function toggleSelectionMode() {
    setSelectionMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(filteredWords.map((w) => w.id)));
  }

  async function handleBulkGroup() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);

    if (bulkGroupValue === "__new__") {
      const name = prompt(`${ids.length} kelime için yeni grup adı:`);
      if (!name || !name.trim()) {
        setBulkBusy(false);
        return;
      }
      const newGroup = await createGroup(name.trim());
      if (newGroup) await updateWordGroup(ids, newGroup.id);
    } else if (bulkGroupValue === "__none__") {
      await updateWordGroup(ids, null);
    } else if (bulkGroupValue !== "__pick__") {
      await updateWordGroup(ids, bulkGroupValue);
    }

    setBulkBusy(false);
    setBulkGroupValue("__pick__");
    setSelectedIds(new Set());
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    const confirmed = confirm(`${selectedIds.size} kelimeyi kalıcı olarak silmek istediğine emin misin? Bu işlem geri alınamaz.`);
    if (!confirmed) return;

    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from("flashcards").delete().in("id", ids);

    if (error) {
      alert("Silinemedi: " + error.message);
      setBulkBusy(false);
      return;
    }

    const idSet = new Set(ids);
    setWords((prev) => prev.filter((w) => !idSet.has(w.id)));
    setBulkBusy(false);
    setSelectedIds(new Set());
  }

  // ============================================================
  // Satır içi düzenleme
  // ============================================================
  function startEdit(w: Flashcard) {
    setEditingId(w.id);
    setEditDraft({
      word: w.word,
      preposition: w.preposition ?? "",
      meaning: w.meaning,
      example_sentence: w.example_sentence ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    if (!editDraft.word.trim() || !editDraft.meaning.trim()) {
      alert("Kelime ve anlam boş olamaz.");
      return;
    }

    setSavingEdit(true);
    const { error } = await supabase
      .from("flashcards")
      .update({
        word: editDraft.word.trim(),
        preposition: editDraft.preposition.trim() || null,
        meaning: editDraft.meaning.trim(),
        example_sentence: editDraft.example_sentence.trim(),
      })
      .eq("id", id);

    if (error) {
      alert("Kaydedilemedi: " + error.message);
      setSavingEdit(false);
      return;
    }

    setWords((prev) =>
      prev.map((w) =>
        w.id === id
          ? {
              ...w,
              word: editDraft.word.trim(),
              preposition: editDraft.preposition.trim() || null,
              meaning: editDraft.meaning.trim(),
              example_sentence: editDraft.example_sentence.trim(),
            }
          : w
      )
    );
    setSavingEdit(false);
    setEditingId(null);
    setEditDraft(null);
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

        <div className="flex flex-wrap items-center gap-2">
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
          <FilterButton active={filter === "ungrouped"} onClick={() => setFilter("ungrouped")}>
            Grupsuz ({words.length - groupedCount})
          </FilterButton>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleMergeDuplicateGroups}
              disabled={autoGrouping}
              className="text-xs font-medium px-3 py-1.5 rounded-full border bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-red-300 disabled:opacity-50 transition-colors"
              title="Birebir aynı isimli grupları tek gruba birleştirir"
            >
              🧹 Mükerrer Grupları Birleştir
            </button>
            <button
              onClick={handleGroupByExactMeaning}
              disabled={autoGrouping}
              className="text-xs font-medium px-3 py-1.5 rounded-full border bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-300 disabled:opacity-50 transition-colors"
              title="Türkçe anlamı birebir aynı olan kelimeleri Gemini kullanmadan, ücretsiz gruplar"
            >
              🔤 Birebir Anlamları Grupla (Ücretsiz)
            </button>
            <button
              onClick={handleAutoGroup}
              disabled={autoGrouping}
              className="text-xs font-medium px-3 py-1.5 rounded-full border bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300 disabled:opacity-50 transition-colors"
            >
              {autoGrouping
                ? autoGroupProgress
                  ? `🤖 Parça ${autoGroupProgress.batch} · ${autoGroupProgress.groupsCreated} grup · ${autoGroupProgress.wordsGrouped} kelime`
                  : "🤖 Başlıyor..."
                : "🤖 Yakın Anlamları Grupla (AI)"}
            </button>
            <button
              onClick={toggleSelectionMode}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                selectionMode
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300"
              }`}
            >
              {selectionMode ? "✕ Çoklu seçimi kapat" : "☑️ Çoklu Seç / Toplu Grupla"}
            </button>
          </div>
        </div>

        <input
          type="text"
          placeholder="Kelime, anlam veya preposition ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />

        {selectionMode && (
          <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 p-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
              {selectedIds.size} kelime seçili
            </span>
            <button onClick={selectAllFiltered} className="text-xs text-indigo-600 hover:underline">
              Görünenlerin tümünü seç ({filteredWords.length})
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-indigo-600 hover:underline">
              Seçimi temizle
            </button>

            <div className="flex items-center gap-2 ml-auto">
              <select
                value={bulkGroupValue}
                onChange={(e) => setBulkGroupValue(e.target.value)}
                disabled={selectedIds.size === 0}
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-1.5"
              >
                <option value="__pick__">Grup seç...</option>
                <option value="__none__">— (grupsuz yap)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                <option value="__new__">+ Yeni grup oluştur</option>
              </select>
              <button
                onClick={handleBulkGroup}
                disabled={selectedIds.size === 0 || bulkGroupValue === "__pick__" || bulkBusy}
                className="text-xs font-medium px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {bulkBusy ? "Uygulanıyor..." : "Uygula"}
              </button>

              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || bulkBusy}
                className="text-xs font-medium px-4 py-1.5 rounded-lg bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900 disabled:opacity-50 transition-colors"
              >
                🗑️ Seçilenleri Sil
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-left">
              <tr>
                {selectionMode && <th className="px-3 py-3 w-8"></th>}
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
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Yükleniyor...
                  </td>
                </tr>
              ) : pagedWords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Kelime bulunamadı.
                  </td>
                </tr>
              ) : (
                pagedWords.map((w) => {
                  const stage = deriveLearningStage(w);
                  const status = deriveCardStatus(w);
                  const isEditing = editingId === w.id;

                  return (
                    <tr key={w.id} className={selectedIds.has(w.id) ? "bg-indigo-50/50 dark:bg-indigo-950/30" : ""}>
                      {selectionMode && (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(w.id)}
                            onChange={() => toggleSelected(w.id)}
                            className="accent-indigo-600 w-4 h-4"
                          />
                        </td>
                      )}

                      {isEditing && editDraft ? (
                        <>
                          <td className="px-4 py-2">
                            <EditInput value={editDraft.word} onChange={(v) => setEditDraft({ ...editDraft, word: v })} />
                          </td>
                          <td className="px-4 py-2">
                            <EditInput
                              value={editDraft.preposition}
                              onChange={(v) => setEditDraft({ ...editDraft, preposition: v })}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <EditInput
                              value={editDraft.meaning}
                              onChange={(v) => setEditDraft({ ...editDraft, meaning: v })}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <EditInput
                              value={editDraft.example_sentence}
                              onChange={(v) => setEditDraft({ ...editDraft, example_sentence: v })}
                            />
                          </td>
                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                            {LEARNING_STAGE_LABELS[stage]}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-medium px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                              {CARD_STATUS_LABELS[status]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">
                            {w.group_id ? groupNameById.get(w.group_id) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveEdit(w.id)}
                                disabled={savingEdit}
                                className="text-emerald-600 hover:underline text-xs font-medium disabled:opacity-50"
                              >
                                Kaydet
                              </button>
                              <button onClick={cancelEdit} className="text-slate-400 hover:underline text-xs">
                                İptal
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
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
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => startEdit(w)}
                                className="text-indigo-600 hover:underline text-xs"
                              >
                                Düzenle
                              </button>
                              <button
                                onClick={() => handleDelete(w.id)}
                                className="text-red-500 hover:underline text-xs"
                              >
                                Sil
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Sayfalama */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Sayfa başına:</span>
            {[25, 50, 100].map((size) => (
              <button
                key={size}
                onClick={() => setPageSize(size)}
                className={`px-2 py-1 rounded-md border transition-colors ${
                  pageSize === size
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                }`}
              >
                {size}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40"
            >
              ← Önceki
            </button>
            <span className="text-slate-500 dark:text-slate-400">
              Sayfa {safePage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40"
            >
              Sonraki →
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500">
          Toplam {filteredWords.length} kelime bulundu (bu sayfada {pagedWords.length} tanesi
          gösteriliyor). &apos;Çoklu Seç&apos; ile filtredeki TÜM kelimeleri (sayfa sınırı olmadan)
          seçip gruplayabilirsin. Bir kelimeyi düzenlemek için &apos;Düzenle&apos;ye tıkla.
        </p>
      </div>
    </main>

  );
}

function EditInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-sm rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
    />
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
