"use client";

import { useEffect, useState } from "react";

const LINES = [
  "Bir dil, her gün bir cümleyle büyür.",
  "Bugün bilmediğin kelime, yarının cümlesidir.",
  "İngilizce, tekrar edilince yabancı kalmaz.",
  "Azim, aynı kelimeye ikinci kez bakmaktır.",
  "İstikrar, beş dakikalık turu her gün yapmaktır.",
  "Kararlılık, zor kelimeyi atlamamaktır.",
  "Unutmak normaldir. Dönmek öğrenmektir.",
  "Küçük tekrar, uzun hafızayı kurar.",
  "Bugünkü on kelime, yarının rahatlığıdır.",
  "Öğrenmek acele etmez. Bırakmayan ilerler.",
  "Her doğru cevap, bir kapıyı aralar.",
  "Dil, vazgeçmeyen insanın yanına oturur.",
  "Bugün bilmediğin kelime yarın götünü tırmalar",
  "We are the same pencil",
];

export default function MotiveLine() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const start = Math.floor(Date.now() / 86400000) % LINES.length;
    setIndex(start);
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % LINES.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="max-w-xl text-center">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#0f6b5c]">Bugünün cümlesi</p>
      <p className="mt-3 font-display text-3xl leading-snug text-slate-900 dark:text-slate-50 sm:text-4xl">
        {LINES[index]}
      </p>
      <div className="mt-4 flex justify-center gap-1.5">
        {LINES.map((line, dot) => (
          <button
            key={line}
            type="button"
            aria-label={line}
            onClick={() => setIndex(dot)}
            className={`h-1.5 rounded-full transition-all ${dot === index ? "w-4 bg-[#0f6b5c]" : "w-1.5 bg-slate-300 dark:bg-slate-600"}`}
          />
        ))}
      </div>
    </div>
  );
}
