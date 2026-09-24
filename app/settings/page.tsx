"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/ThemeProvider";
import { getTTSSettings, setTTSSettings } from "@/components/SpeakButton";
import { Flashcard, WordGroup } from "@/types";

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const [rate, setRate] = useState(0.9);
  const [pitch, setPitch] = useState(1);
  const [mounted, setMounted] = useState(false);

  const [dailyNewGoal, setDailyNewGoal] = useState(10);
  const [dailyReviewGoal, setDailyReviewGoal] = useState(30);
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  const [savingGoals, setSavingGoals] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [testingMail, setTestingMail] = useState(false);
  const [mailNote, setMailNote] = useState<string | null>(null);

  useEffect(() => {
    const s = getTTSSettings();
    setRate(s.rate);
    setPitch(s.pitch);
    setMounted(true);

    async function loadGoals() {
      const { data } = await supabase
        .from("app_settings")
        .select("daily_new_goal, daily_review_goal")
        .eq("id", 1)
        .maybeSingle();
      if (data) {
        setDailyNewGoal(data.daily_new_goal);
        setDailyReviewGoal(data.daily_review_goal);
      }
      setGoalsLoaded(true);
    }
    loadGoals();
  }, []);

  async function downloadBackup() {
    setExporting(true);
    setExportNote(null);
    try {
      const PAGE = 1000;
      const flashcards: Flashcard[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("flashcards")
          .select("*")
          .order("created_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as Flashcard[];
        flashcards.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }

      const { data: groups, error: groupError } = await supabase.from("word_groups").select("*");
      if (groupError) throw groupError;

      const payload = {
        exported_at: new Date().toISOString(),
        flashcards,
        word_groups: (groups ?? []) as WordGroup[],
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `quizanki-en-yedek-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setExportNote(`${flashcards.length} kelime indirildi.`);
    } catch {
      setExportNote("Yedek alınamadı.");
    } finally {
      setExporting(false);
    }
  }

  async function saveGoals() {
    setSavingGoals(true);
    await supabase
      .from("app_settings")
      .update({
        daily_new_goal: dailyNewGoal,
        daily_review_goal: dailyReviewGoal,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setSavingGoals(false);
  }

  async function sendTestMail() {
    setTestingMail(true);
    setMailNote(null);
    try {
      const res = await fetch("/api/send-reminder", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMailNote(data.error || "Deneme maili gidemedi.");
        return;
      }
      setMailNote(`Gönderildi: ${data.to}. Gelen kutusuna ve spam klasörüne bak.`);
    } catch {
      setMailNote("Deneme maili gidemedi.");
    } finally {
      setTestingMail(false);
    }
  }

  function updateRate(value: number) {
    setRate(value);
    setTTSSettings(value, pitch);
  }

  function updatePitch(value: number) {
    setPitch(value);
    setTTSSettings(rate, value);
  }

  function testVoice() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance("Bonjour, comment ça va ?");
    utterance.lang = "en-US";
    utterance.rate = rate;
    utterance.pitch = pitch;
    window.speechSynthesis.speak(utterance);
  }

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">⚙️ Ayarlar</h1>
          <Link href="/" className="text-sm text-indigo-600 hover:underline">
            ← Ana sayfaya dön
          </Link>
        </div>

        <section className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Yedek</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Kelimeler, anlamlar, tekrarlar ve gruplar JSON dosyasına iner.
          </p>
          <button
            onClick={downloadBackup}
            disabled={exporting}
            className="w-full rounded-lg bg-indigo-600 text-white font-medium py-2.5 hover:bg-indigo-700 transition-colors text-sm disabled:opacity-60"
          >
            {exporting ? "Hazırlanıyor..." : "Yedek indir"}
          </button>
          {exportNote && <p className="text-xs text-slate-400 dark:text-slate-500">{exportNote}</p>}
        </section>

        <section className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Hatırlatma</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Öğlen mailinin aynısını şimdi bir kez gönderir.
          </p>
          <button
            onClick={sendTestMail}
            disabled={testingMail}
            className="w-full rounded-lg bg-indigo-600 text-white font-medium py-2.5 hover:bg-indigo-700 transition-colors text-sm disabled:opacity-60"
          >
            {testingMail ? "Gönderiliyor..." : "Deneme maili gönder"}
          </button>
          {mailNote && <p className="text-xs text-slate-400 dark:text-slate-500">{mailNote}</p>}
        </section>

        {/* Görünüm */}
        <section className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">🎨 Görünüm</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Karanlık Mod</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Şu an: {theme === "dark" ? "Karanlık" : "Aydınlık"}
              </p>
            </div>
            <button
              onClick={toggleTheme}
              className={`w-12 h-7 rounded-full transition-colors relative ${
                theme === "dark" ? "bg-indigo-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                  theme === "dark" ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </section>

        {/* Günlük Hedef */}
        <section className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-5">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">🎯 Günlük Hedef</h2>

          {goalsLoaded && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <label className="text-slate-600 dark:text-slate-300">Günlük yeni kelime hedefi</label>
                  <span className="text-slate-400 dark:text-slate-500">{dailyNewGoal}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={50}
                  step={1}
                  value={dailyNewGoal}
                  onChange={(e) => setDailyNewGoal(parseInt(e.target.value, 10))}
                  className="w-full accent-emerald-600"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <label className="text-slate-600 dark:text-slate-300">Günlük tekrar hedefi</label>
                  <span className="text-slate-400 dark:text-slate-500">{dailyReviewGoal}</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={150}
                  step={5}
                  value={dailyReviewGoal}
                  onChange={(e) => setDailyReviewGoal(parseInt(e.target.value, 10))}
                  className="w-full accent-indigo-600"
                />
              </div>

              <button
                onClick={saveGoals}
                disabled={savingGoals}
                className="w-full rounded-lg bg-indigo-600 text-white font-medium py-2.5 hover:bg-indigo-700 transition-colors text-sm disabled:opacity-60"
              >
                {savingGoals ? "Kaydediliyor..." : "Hedefleri Kaydet"}
              </button>

              <p className="text-xs text-slate-400 dark:text-slate-500">
                Bu hedef tüm cihazlarda ortak — ana sayfadaki ilerleme çubukları buna göre dolar.
              </p>
            </>
          )}
        </section>

        {/* Sesli Okuma (TTS) */}
        <section className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-5">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">🔊 Sesli Telaffuz</h2>

          {mounted && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <label className="text-slate-600 dark:text-slate-300">Hız</label>
                  <span className="text-slate-400 dark:text-slate-500">{rate.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={rate}
                  onChange={(e) => updateRate(parseFloat(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <label className="text-slate-600 dark:text-slate-300">Perde (Pitch)</label>
                  <span className="text-slate-400 dark:text-slate-500">{pitch.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={pitch}
                  onChange={(e) => updatePitch(parseFloat(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              <button
                onClick={testVoice}
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium py-2 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm"
              >
                🔊 Test Et: &quot;Bonjour, comment ça va ?&quot;
              </button>

              <p className="text-xs text-slate-400 dark:text-slate-500">
                Tarayıcının yerleşik İngilizce (en-US) sesi kullanılır. Cihazına göre ses kalitesi değişebilir.
              </p>
            </>
          )}
        </section>

        <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
          Daha fazla ayar (günlük hedef, SM-2 geçiş eşiği vb.) yakında burada olacak.
        </p>
      </div>
    </main>
  );
}
