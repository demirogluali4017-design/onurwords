"use client";

import { useCallback, useRef, useState } from "react";

const MAX_FILES = 3;
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];

interface MultiFileUploadZoneProps {
  onFilesChanged: (files: File[]) => void;
  disabled?: boolean;
}

interface PreviewFile {
  file: File;
  url: string;
}

export default function MultiFileUploadZone({ onFilesChanged, disabled }: MultiFileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previews, setPreviews] = useState<PreviewFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList).filter((f) => ALLOWED_TYPES.includes(f.type));

      if (incoming.length === 0) {
        alert("Lütfen sadece JPG veya PNG formatında dosya seç.");
        return;
      }

      setPreviews((current) => {
        const combined = [...current, ...incoming.map((file) => ({ file, url: URL.createObjectURL(file) }))];

        if (combined.length > MAX_FILES) {
          alert(`En fazla ${MAX_FILES} fotoğraf birden yükleyebilirsin.`);
        }

        const trimmed = combined.slice(0, MAX_FILES);
        onFilesChanged(trimmed.map((p) => p.file));
        return trimmed;
      });
    },
    [onFilesChanged]
  );

  function removeAt(index: number) {
    setPreviews((current) => {
      const next = current.filter((_, i) => i !== index);
      onFilesChanged(next.map((p) => p.file));
      return next;
    });
  }

  const canAddMore = previews.length < MAX_FILES;

  return (
    <div className="space-y-3">
      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {previews.map((p, i) => (
            <div key={p.url} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={`Sayfa ${i + 1}`}
                className="w-full h-32 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={disabled}
                className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
              >
                ✕
              </button>
              <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                Sayfa {i + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      {canAddMore && (
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
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => !disabled && inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors
            ${isDragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-slate-300 bg-slate-50 dark:bg-slate-950"}
            ${disabled ? "opacity-60 cursor-not-allowed" : "hover:border-indigo-400 hover:bg-indigo-50 dark:bg-indigo-950/50"}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png"
            multiple
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <svg className="w-10 h-10 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 16.5V9m0 0l-3.5 3.5M12 9l3.5 3.5M6 20.25h12A2.25 2.25 0 0020.25 18v-7.5A2.25 2.25 0 0018 8.25h-1.5l-1.06-2.12A2.25 2.25 0 0013.44 5h-2.88a2.25 2.25 0 00-2.01 1.13L7.5 8.25H6A2.25 2.25 0 003.75 10.5V18A2.25 2.25 0 006 20.25z"
            />
          </svg>
          <p className="text-slate-600 dark:text-slate-300 font-medium text-sm">
            {previews.length === 0
              ? "Fotoğraf(lar)ı sürükle veya tıklayarak seç"
              : `Daha fazla ekle (${MAX_FILES - previews.length} kaldı)`}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">En fazla {MAX_FILES} sayfa, JPG/PNG</p>
        </div>
      )}
    </div>
  );
}
