"use client";

import { useState } from "react";
import Link from "next/link";
import MultiFileUploadZone from "@/components/MultiFileUploadZone";
import { compressImages } from "@/lib/imageCompression";
import { Flashcard } from "@/types";

type ProcessState = "idle" | "processing" | "success" | "error";
type Tab = "photo" | "manual";

export default function UploadPage() {
  const [tab, setTab] = useState<Tab>("photo");

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">⬆️ Kart Yükle</h1>
          <Link href="/" className="text-sm text-indigo-600 hover:underline">
            ← Ana sayfaya dön
          </Link>
        </div>

        <div className="flex gap-2">
          <TabButton active={tab === "photo"} onClick={() => setTab("photo")}>
            📷 Fotoğraf Yükle
          </TabButton>
          <TabButton active={tab === "manual"} onClick={() => setTab("manual")}>
            ✍️ Manuel Ekle
          </TabButton>
        </div>

        {tab === "photo" ? <PhotoUploadPanel /> : <ManualAddPanel />}
      </div>
    </main>
  );
}

function TabButton({
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
      className={`text-sm font-medium px-4 py-2 rounded-lg border transition-colors ${
        active
          ? "bg-indigo-600 text-white border-indigo-600"
          : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300"
      }`}
    >
      {children}
    </button>
  );
}

// ============================================================
// SEKME 1: Fotoğraf(lar)ı yükle → Gemini ile çıkar (azami 3 sayfa)
// ============================================================
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPage(file: File, onStatus: (label: string) => void): Promise<Flashcard[]> {
  let lastMessage = "Gemini şu anda yoğun. Biraz sonra aynı sayfayı tekrar dene.";

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 28000);
    try {
      const formData = new FormData();
      formData.append("images", file);
      const res = await fetch("/api/process-image", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastMessage = String(data.error || lastMessage);
        const busy = res.status === 503 || res.status === 429 || data.retryable === true;
        if (busy && attempt === 0) {
          onStatus("yoğun, kısa ara veriliyor");
          await sleep(1200);
          continue;
        }
        throw new Error(lastMessage);
      }
      return (data.words ?? []) as Flashcard[];
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (aborted) lastMessage = "Bu sayfa çok uzun sürdü. Gemini yanıt vermedi.";
      else if (err instanceof Error && err.message) lastMessage = err.message;
      if (attempt === 0) {
        onStatus("yeniden deneniyor");
        await sleep(1200);
        continue;
      }
      throw new Error(lastMessage);
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw new Error(lastMessage);
}

function PhotoUploadPanel() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [state, setState] = useState<ProcessState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [savedWords, setSavedWords] = useState<Flashcard[]>([]);

  async function handleProcess() {
    if (selectedFiles.length === 0 || state === "processing") return;

    setState("processing");
    setErrorMessage(null);
    setNotice(null);
    setSavedWords([]);

    const saved: Flashcard[] = [];
    try {
      const compressedFiles = await compressImages(selectedFiles);

      for (let index = 0; index < compressedFiles.length; index++) {
        setProgress(`Sayfa ${index + 1}/${compressedFiles.length} işleniyor`);
        const pageWords = await sendPage(compressedFiles[index], (label) => {
          setProgress(`Sayfa ${index + 1}/${compressedFiles.length}: ${label}`);
        });
        saved.push(...pageWords);
        setSavedWords([...saved]);
      }

      setSavedWords(saved);
      setState("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Beklenmeyen hata.";
      if (saved.length > 0) {
        setSavedWords(saved);
        setNotice(message);
        setState("success");
      } else {
        setErrorMessage(message);
        setState("error");
      }
    } finally {
      setProgress(null);
    }
  }

  function handleReset() {
    setSelectedFiles([]);
    setSavedWords([]);
    setState("idle");
    setErrorMessage(null);
    setNotice(null);
    setProgress(null);
  }

  return (
    <div className="space-y-6">
      <MultiFileUploadZone
        onFilesChanged={(files) => {
          setSelectedFiles(files);
          setState("idle");
          setSavedWords([]);
          setNotice(null);
        }}
        disabled={state === "processing"}
      />

      {selectedFiles.length > 0 && state !== "success" && (
        <button
          onClick={handleProcess}
          disabled={state === "processing"}
          className="w-full rounded-xl bg-indigo-600 py-3 font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "processing" ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              {progress ?? "Hazırlanıyor..."}
            </span>
          ) : (
            `${selectedFiles.length} Sayfayı İşle ve Kelimeleri Çıkar`
          )}
        </button>
      )}

      {state === "error" && errorMessage && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950 border border-red-200 text-red-700 p-4 text-sm">
          ⚠️ {errorMessage}
        </div>
      )}

      {state === "success" && (
        <div className="space-y-4">
          {notice && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950">
              {notice} Kaydedilen {savedWords.length} kelime duruyor.
            </div>
          )}
          <div className="rounded-xl bg-green-50 dark:bg-green-950 border border-green-200 text-green-700 p-4 text-sm flex items-center justify-between">
            <span>✅ {savedWords.length} kelime başarıyla kaydedildi.</span>
            <button onClick={handleReset} className="text-green-800 font-medium hover:underline">
              Yeni sayfa yükle
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Kelime</th>
                  <th className="px-4 py-3 font-medium">Preposition</th>
                  <th className="px-4 py-3 font-medium">Anlam</th>
                  <th className="px-4 py-3 font-medium">Örnek Cümle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {savedWords.map((w) => (
                  <tr key={w.id}>
                    <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">{w.word}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{w.preposition ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{w.meaning}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 italic">{w.example_sentence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SEKME 2: Manuel ekleme (yapay zeka yok, doğrudan form)
// ============================================================
function ManualAddPanel() {
  const [word, setWord] = useState("");
  const [preposition, setPreposition] = useState("");
  const [meaning, setMeaning] = useState("");
  const [exampleSentence, setExampleSentence] = useState("");
  const [state, setState] = useState<ProcessState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  function resetForm() {
    setWord("");
    setPreposition("");
    setMeaning("");
    setExampleSentence("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!word.trim() || !meaning.trim()) return;

    setState("processing");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/add-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word,
          preposition,
          meaning,
          example_sentence: exampleSentence,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Bilinmeyen bir hata oluştu.");
      }

      setAddedCount((c) => c + 1);
      setState("success");
      resetForm();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Beklenmeyen hata.");
      setState("error");
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-4">
        <Field label="Kelime *" value={word} onChange={setWord} placeholder="ör. améliorer" required />
        <Field
          label="Preposition (edat)"
          value={preposition}
          onChange={setPreposition}
          placeholder="ör. à qn/qch (varsa)"
        />
        <Field label="Anlam (Türkçe) *" value={meaning} onChange={setMeaning} placeholder="ör. geliştirmek" required />
        <Field
          label="Örnek Cümle (İngilizce)"
          value={exampleSentence}
          onChange={setExampleSentence}
          placeholder="ör. Il faut améliorer ce projet."
          textarea
        />

        <button
          type="submit"
          disabled={state === "processing" || !word.trim() || !meaning.trim()}
          className="w-full rounded-xl bg-indigo-600 text-white font-medium py-3 hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {state === "processing" ? "Ekleniyor..." : "Kelimeyi Ekle"}
        </button>
      </form>

      {state === "success" && (
        <div className="rounded-xl bg-green-50 dark:bg-green-950 border border-green-200 text-green-700 p-4 text-sm">
          ✅ Kelime eklendi. Bu oturumda toplam {addedCount} kelime ekledin — devam edebilirsin.
        </div>
      )}

      {state === "error" && errorMessage && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950 border border-red-200 text-red-700 p-4 text-sm">
          ⚠️ {errorMessage}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  textarea?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{label}</label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      )}
    </div>
  );
}
