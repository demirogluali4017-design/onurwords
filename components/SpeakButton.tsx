"use client";

import { useCallback, useState } from "react";

interface SpeakButtonProps {
  text: string;
  size?: "sm" | "md";
}

const RATE_KEY = "quizanki:tts:rate";
const PITCH_KEY = "quizanki:tts:pitch";

export function getTTSSettings() {
  if (typeof window === "undefined") return { rate: 0.9, pitch: 1 };
  const rate = parseFloat(localStorage.getItem(RATE_KEY) ?? "0.9");
  const pitch = parseFloat(localStorage.getItem(PITCH_KEY) ?? "1");
  return {
    rate: Number.isFinite(rate) ? rate : 0.9,
    pitch: Number.isFinite(pitch) ? pitch : 1,
  };
}

export function setTTSSettings(rate: number, pitch: number) {
  localStorage.setItem(RATE_KEY, String(rate));
  localStorage.setItem(PITCH_KEY, String(pitch));
}

export default function SpeakButton({ text, size = "md" }: SpeakButtonProps) {
  const [speaking, setSpeaking] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const handleSpeak = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // kart flip'ini tetiklemesin
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setUnsupported(true);
        return;
      }

      window.speechSynthesis.cancel(); // önceki okumayı durdur

      const { rate, pitch } = getTTSSettings();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = rate;
      utterance.pitch = pitch;

      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);

      window.speechSynthesis.speak(utterance);
    },
    [text]
  );

  if (unsupported) return null; // tarayıcı desteklemiyorsa sessizce gizle

  const dimensions = size === "sm" ? "w-7 h-7 text-sm" : "w-9 h-9 text-base";

  return (
    <button
      type="button"
      onClick={handleSpeak}
      className={`${dimensions} rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-indigo-100 dark:hover:bg-indigo-900 flex items-center justify-center transition-colors ${speaking ? "animate-pulse text-indigo-600" : "text-slate-500 dark:text-slate-300"}`}
      title="İngilizce telaffuzu dinle"
    >
      🔊
    </button>
  );
}
