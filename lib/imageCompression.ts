"use client";

/**
 * Kamera ile çekilen fotoğraflar genelde çok yüksek çözünürlüklü (3-8MB+)
 * olur. Birden fazla foto tek istekte gönderildiğinde toplam boyut sunucu
 * limitini aşabilir (özellikle Safari/iOS'ta garip bir hata olarak
 * yansıyabilir: "The string did not match the expected pattern").
 *
 * Bu fonksiyon, göndermeden önce her görseli tarayıcıda (canvas ile)
 * makul bir boyuta indirir. Kelime okunabilirliği bozulmaz — sadece
 * gereksiz yüksek çözünürlük ve dosya boyutu azaltılır.
 */
const MAX_DIMENSION = 1600; // px, en uzun kenar
const JPEG_QUALITY = 0.82;

export async function compressImage(file: File): Promise<File> {
  // Zaten küçükse (örn. galeriden gelen optimize edilmiş görsel) dokunma
  if (file.size <= 1.2 * 1024 * 1024) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file; // canvas desteklenmiyorsa orijinali gönder

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close?.();

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );

  if (!blob) return file; // sıkıştırma başarısızsa orijinali gönder

  return new File([blob], renameToJpg(file.name), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export async function compressImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map((f) => compressImage(f)));
}

function renameToJpg(originalName: string): string {
  const withoutExt = originalName.replace(/\.[^/.]+$/, "");
  return `${withoutExt || "photo"}.jpg`;
}
