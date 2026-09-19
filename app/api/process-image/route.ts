import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createServiceRoleClient } from "@/lib/supabase";
import { ExtractedWord } from "@/types";
 
export const runtime = "nodejs";
export const maxDuration = 60;
 
const EXTRACTION_PROMPT = `Bu görsel(ler)deki Fransızca kelimeleri çıkar. Birden fazla görsel verildiyse HEPSİNİ işle ve TEK bir birleşik JSON array olarak döndür (görseller ayrı sayfalar olabilir, sırayla işle). Kurallara KESİNLİKLE uy:
 
1. "preposition" alanı: Kelimenin (özellikle fiillerin) görselde geçen TÜM edat kalıplarını EKSİKSİZ ve BİREBİR yaz.
   - Görselde "qch" (quelque chose) veya "qn" (quelqu'un) gibi kısaltmalar varsa bunları da kalıba dahil et, çıkarma. Örnek: "penser à qn/qch" görüldüyse preposition alanına tam olarak "à qn/qch" yaz, sadece "à" yazma.
   - Bir fiilin birden fazla edat kalıbı varsa (örn. "parler de qch à qn") HEPSİNİ kaçırmadan yaz, virgülle ayırarak listele. Örnek: "de qch, à qn".
   - Kelimenin yanında edat geçiyorsa bu alanı ASLA boş bırakma ve ASLA kısaltma; edat yoksa boş string ("") bırak.
2. "meaning" alanı: Eğer görselde kelimenin Türkçe anlamı zaten YAZILI olarak veriliyorsa (defter/kitap sayfasında karşısında yazan Türkçe kelime/ifade), onu BİREBİR, HİÇBİR ŞEKİLDE DEĞİŞTİRMEDEN, PARAFRAZ YAPMADAN, EŞ ANLAMLISINI KULLANMADAN aynen yaz — kendi yorumunu veya alternatif çevirini KATMA. Görselde yazılı bir anlam YOKSA (sadece kelimenin kendisi varsa) o zaman doğru ve yaygın Türkçe anlamını sen üret.
3. "example_sentence" alanı: SADECE ve KESİNLİKLE Fransızca bir örnek cümle yaz. İngilizce veya başka bir dilde örnek cümle YAZMA. Görselde kelimeyle birlikte bir örnek cümle varsa onu birebir kullan; yoksa kelimeye uygun basit, doğru dilbilgisiyle yazılmış yeni bir Fransızca cümle üret.
4. Aynı kelime birden fazla görselde tekrar geçiyorsa SADECE BİR KEZ ekle (tekrar eden kaydı çıkarma).
 
Yanıtı sadece ve strictly JSON array formatında döndür, başka hiçbir açıklama ekleme. Format: [{"word": "", "preposition": "", "meaning": "", "example_sentence": ""}]`;
 
/**
 * Gemini'nin bazen JSON'u ```json ... ``` gibi code fence içine
 * sarmalamasına karşı temizleme yardımcı fonksiyonu.
 */
function extractJsonArray(rawText: string): ExtractedWord[] {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
 
  const parsed = JSON.parse(cleaned);
 
  if (!Array.isArray(parsed)) {
    throw new Error("Gemini yanıtı bir JSON array değil.");
  }
 
  return parsed as ExtractedWord[];
}
 
/**
 * Ortam değişkenlerinden sırayla Gemini API anahtarlarını toplar.
 * GEMINI_API_KEY zorunludur; GEMINI_API_KEY_2, GEMINI_API_KEY_3 ...
 * şeklinde eklenen ek anahtarlar, birincisi kota (429) veya geçici
 * kullanılamazlık (503) hatası verdiğinde otomatik yedek olarak denenir.
 */
function collectApiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
 
  let i = 2;
  while (process.env[`GEMINI_API_KEY_${i}`]) {
    keys.push(process.env[`GEMINI_API_KEY_${i}`] as string);
    i += 1;
  }
 
  return keys;
}
 
/** Hata mesajından Gemini'nin kota/yoğunluk hatası verip vermediğini anlar. */
function isRetryableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("429") ||
    message.includes("503") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("UNAVAILABLE")
  );
}
 
export async function POST(request: NextRequest) {
  try {
    const apiKeys = collectApiKeys();
    if (apiKeys.length === 0) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY ortam değişkeni tanımlı değil." },
        { status: 500 }
      );
    }
 
    const formData = await request.formData();
    const files = formData.getAll("images") as File[];
 
    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "Görsel dosyası bulunamadı ('images' alanı gerekli)." },
        { status: 400 }
      );
    }
 
    const MAX_IMAGES = 3;
    if (files.length > MAX_IMAGES) {
      return NextResponse.json(
        { error: `En fazla ${MAX_IMAGES} görsel birden yükleyebilirsin.` },
        { status: 400 }
      );
    }
 
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png"];
    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        return NextResponse.json(
          { error: "Sadece JPG/PNG formatları destekleniyor." },
          { status: 400 }
        );
      }
    }
 
    // Dosyaları base64'e çevir
    const imageParts = await Promise.all(
      files.map(async (file) => {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return {
          inlineData: {
            mimeType: file.type,
            data: base64,
          },
        };
      })
    );
 
    // Anahtarları sırayla dene: biri kota/yoğunluk hatası verirse bir sonrakine geç
    let rawText: string | undefined;
    let lastError: unknown = null;
 
    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
      const ai = new GoogleGenAI({ apiKey: apiKeys[keyIndex] });
 
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: [
            {
              role: "user",
              parts: [{ text: EXTRACTION_PROMPT }, ...imageParts],
            },
          ],
          config: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });
 
        rawText = response.text;
        lastError = null;
        break; // başarılı oldu, döngüden çık
      } catch (err) {
        lastError = err;
        const hasNextKey = keyIndex < apiKeys.length - 1;
 
        if (isRetryableError(err) && hasNextKey) {
          console.warn(
            `Gemini anahtarı #${keyIndex + 1} kota/yoğunluk hatası verdi, sıradaki anahtara geçiliyor.`
          );
          continue; // sıradaki anahtarı dene
        }
 
        // Yeniden denenemeyecek bir hata ya da denenecek anahtar kalmadı
        throw err;
      }
    }
 
    if (lastError) {
      throw lastError;
    }
 
    if (!rawText) {
      return NextResponse.json(
        { error: "Gemini boş yanıt döndürdü." },
        { status: 502 }
      );
    }
 
    let extractedWords: ExtractedWord[];
    try {
      extractedWords = extractJsonArray(rawText);
    } catch (parseError) {
      console.error("JSON parse hatası:", parseError, "Ham yanıt:", rawText);
      return NextResponse.json(
        { error: "Gemini yanıtı geçerli JSON formatında değil.", raw: rawText },
        { status: 502 }
      );
    }
 
    if (extractedWords.length === 0) {
      return NextResponse.json(
        { error: "Görselde herhangi bir kelime tespit edilemedi.", words: [] },
        { status: 200 }
      );
    }
 
    // Supabase'e kaydedilecek satırları hazırla (SM-2 varsayılan değerleriyle)
    const rowsToInsert = extractedWords.map((item) => ({
      word: item.word?.trim() ?? "",
      preposition: item.preposition?.trim() || null,
      meaning: item.meaning?.trim() ?? "",
      example_sentence: item.example_sentence?.trim() ?? "",
      repetitions: 0,
      interval: 1,
      ease_factor: 2.5,
      next_review_date: new Date().toISOString(),
      in_learning_phase: false,
      learning_streak: 0,
    }));
 
    const supabaseAdmin = createServiceRoleClient();
    const { data: insertedRows, error: insertError } = await supabaseAdmin
      .from("flashcards")
      .insert(rowsToInsert)
      .select();
 
    if (insertError) {
      console.error("Supabase insert hatası:", insertError);
      return NextResponse.json(
        { error: "Kelimeler veritabanına kaydedilemedi.", details: insertError.message },
        { status: 500 }
      );
    }
 
    return NextResponse.json(
      { success: true, count: insertedRows?.length ?? 0, words: insertedRows },
      { status: 201 }
    );
  } catch (err) {
    console.error("process-image genel hata:", err);
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    return NextResponse.json(
      { error: "İşlem sırasında beklenmeyen bir hata oluştu.", details: message },
      { status: 500 }
    );
  }
}
