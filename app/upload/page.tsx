"use client";

import { useState } from "react";
import Link from "next/link";
import MultiFileUploadZone from "@/components/MultiFileUploadZone";
import OcrWordPicker from "@/components/OcrWordPicker";
import { compressImages } from "@/lib/imageCompression";
import { recognizeImages } from "@/lib/ocr";
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
function PhotoUploadPanel() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [state, setState] = useState<ProcessState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedWords, setSavedWords] = useState<Flashcard[]>([]);
  const [ocrPages, setOcrPages] = useState<
    {
      url: string;
      label: string;
      tokens: Awaited<ReturnType<typeof recognizeImages>>[number]["tokens"];
      pairs: Awaited<ReturnType<typeof recognizeImages>>[number]["pairs"];
      width: number;
      height: number;
    }[] | null
  >(null);
  const [ocrProgress, setOcrProgress] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  function clearOcr(pages = ocrPages) {
    pages?.forEach((page) => URL.revokeObjectURL(page.url));
    setOcrPages(null);
    setOcrProgress(null);
    setOcrError(null);
  }

  async function handleOcr() {
    if (selectedFiles.length === 0 || ocrProgress) return;
    clearOcr();
    setOcrError(null);
    try {
      setOcrProgress("Fotoğraflar hazırlanıyor…");
      const compressed = await compressImages(selectedFiles);
      const recognized = await recognizeImages(compressed, (index, progress) => {
        setOcrProgress(
          `Sayfa ${index + 1}/${compressed.length} okunuyor… %${Math.round(progress * 100)}`
        );
      });
      setOcrPages(
        recognized.map((result, index) => ({
          url: URL.createObjectURL(compressed[index]),
          label: `Sayfa ${index + 1}`,
          tokens: result.tokens,
          pairs: result.pairs,
          width: result.width,
          height: result.height,
        }))
      );
      setOcrProgress(null);
    } catch (err) {
      setOcrProgress(null);
      setOcrError(err instanceof Error ? err.message : "Fotoğraf okunamadı.");
    }
  }

  async function handleProcess() {
    if (selectedFiles.length === 0) return;

    setState("processing");
    setErrorMessage(null);

    try {
      const compressedFiles = await compressImages(selectedFiles);

      const formData = new FormData();
      compressedFiles.forEach((file) => formData.append("images", file));

      const res = await fetch("/api/process-image", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        const message = String(data.error || "");
        const busy =
          res.status === 503 ||
          res.status === 429 ||
          data.retryable === true ||
          /yoğun|kullanılamıyor|unavailable/i.test(message);
        if (busy) {
          setState("idle");
          setErrorMessage(message || "Gemini şu anda yoğun.");
          await handleOcr();
          return;
        }
        throw new Error(message || "Bilinmeyen bir hata oluştu.");
      }

      setSavedWords(data.words ?? []);
      setState("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Beklenmeyen hata.");
      setState("error");
    }
  }

  function handleReset() {
    setSelectedFiles([]);
    setSavedWords([]);
    setState("idle");
    setErrorMessage(null);
  }

  return (
    <div className="space-y-6">
      <MultiFileUploadZone
        onFilesChanged={(files) => {
          setSelectedFiles(files);
          setState("idle");
          setSavedWords([]);
          clearOcr();
        }}
        disabled={state === "processing" || Boolean(ocrProgress)}
      />

      {selectedFiles.length > 0 && state !== "success" && !ocrPages && (
        <div className="space-y-2">
          <button
            onClick={handleProcess}
            disabled={state === "processing" || Boolean(ocrProgress)}
            className="w-full rounded-xl bg-indigo-600 py-3 font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state === "processing" ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Gemini {selectedFiles.length} sayfayı analiz ediyor...
              </span>
            ) : (
              `${selectedFiles.length} Sayfayı İşle ve Kelimeleri Çıkar`
            )}
          </button>
          <button
            onClick={handleOcr}
            disabled={state === "processing" || Boolean(ocrProgress)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-3 font-medium text-slate-700 transition-colors hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            {ocrProgress ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-700" />
                {ocrProgress}
              </>
            ) : (
              "OCR ile kelime seç"
            )}
          </button>
          <p className="text-xs text-slate-400">
            Önce Gemini dener. Yoğunsa kelimeleri buradan seçersin.
          </p>
        </div>
      )}

      {ocrError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950">
          ⚠️ {ocrError}
        </div>
      )}

      {ocrPages && <OcrWordPicker pages={ocrPages} onClose={() => clearOcr()} />}

      {state === "error" && errorMessage && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950 border border-red-200 text-red-700 p-4 text-sm">
          ⚠️ {errorMessage}
        </div>
      )}

      {state === "success" && (
        <div className="space-y-4">
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
