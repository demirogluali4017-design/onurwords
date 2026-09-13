"use client";

import { useCallback, useRef, useState } from "react";

interface FileUploadZoneProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

export default function FileUploadZone({ onFileSelected, disabled }: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!["image/jpeg", "image/jpg", "image/png"].includes(file.type)) {
        alert("Lütfen sadece JPG veya PNG formatında bir dosya seçin.");
        return;
      }
      setPreviewUrl(URL.createObjectURL(file));
      onFileSelected(file);
    },
    [onFileSelected]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (disabled) return;
        handleFile(e.dataTransfer.files?.[0]);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer
        ${isDragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-slate-300 bg-slate-50 dark:bg-slate-950"}
        ${disabled ? "opacity-60 cursor-not-allowed" : "hover:border-indigo-400 hover:bg-indigo-50 dark:bg-indigo-950/50"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png"
        className="hidden"
        disabled={disabled}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Yüklenen sayfa önizlemesi"
          className="max-h-64 rounded-lg shadow-md object-contain"
        />
      ) : (
        <>
          <svg
            className="w-12 h-12 text-slate-400 dark:text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 16.5V9m0 0l-3.5 3.5M12 9l3.5 3.5M6 20.25h12A2.25 2.25 0 0020.25 18v-7.5A2.25 2.25 0 0018 8.25h-1.5l-1.06-2.12A2.25 2.25 0 0013.44 5h-2.88a2.25 2.25 0 00-2.01 1.13L7.5 8.25H6A2.25 2.25 0 003.75 10.5V18A2.25 2.25 0 006 20.25z"
            />
          </svg>
          <p className="text-slate-600 dark:text-slate-300 font-medium">
            Sayfa fotoğrafını buraya sürükle veya tıklayarak seç
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">JPG veya PNG formatı desteklenir</p>
        </>
      )}
    </div>
  );
}
