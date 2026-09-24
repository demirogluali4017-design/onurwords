"use client";

import { useEffect, useState } from "react";

const LINES = [
  "Bugün bilmediğin kelime yarın götünü tırmalar",
  "We are the same pencil",
  "Her yeni kelime, zihninde kilitli kalmış yeni bir kapının anahtarıdır.",
  "Kelime hazinesi genişledikçe sadece bir dili değil, dünyayı ve insanları anlama kapasiten de büyür.",
  "Anlamını öğrendiğin her sözcük, kendini ifade ederken özgürlüğüne katılan yeni bir güçtür.",
  "Mükemmel ezberlemek zorunda değilsin; bugün karşılaştığın tek bir kelime bile yarınki iletişimini kolaylaştıracak.",
  "Dilde ilerleme, büyük adımlarla değil, sabırla biriktirilen küçük kelime parçalarıyla inşa edilir.",
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
