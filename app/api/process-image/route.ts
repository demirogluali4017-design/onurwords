import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createServiceRoleClient } from "@/lib/supabase";
import { ExtractedWord } from "@/types";
import { normalizeHint, normalizeSynonyms } from "@/lib/wordMemory";
export const runtime = "nodejs";
export const maxDuration = 60;
const EXTRACTION_PROMPT = `Bu görsel(ler)deki İngilizce kelimeleri çıkar. Birden fazla görsel verildiyse HEPSİNİ işle ve TEK bir birleşik JSON array olarak döndür (görseller ayrı sayfalar olabilir, sırayla işle). Kurallara KESİNLİKLE uy:
1. "preposition" alanı: Kelimenin (özellikle fiillerin) görselde geçen TÜM edat ve phrasal verb kalıplarını EKSİKSİZ ve BİREBİR yaz.
   - Görselde "sb" (somebody) veya "sth" (something) gibi kısaltmalar varsa bunları da kalıba dahil et, çıkarma. Örnek: "look after sb" görüldüyse preposition alanına tam olarak "after sb" yaz, sadece "after" yazma.
   - Bir fiilin birden fazla kalıbı varsa (örn. "look at sth / look for sb") HEPSİNİ kaçırmadan yaz, virgülle ayırarak listele.
   - Kelimenin yanında edat veya parçacık geçiyorsa bu alanı ASLA boş bırakma ve ASLA kısaltma; yoksa boş string ("") bırak.
2. "meaning" alanı: Eğer görselde kelimenin Türkçe anlamı zaten YAZILI olarak veriliyorsa (defter/kitap sayfasında karşısında yazan Türkçe kelime/ifade), onu BİREBİR, HİÇBİR ŞEKİLDE DEĞİŞTİRMEDEN, PARAFRAZ YAPMADAN, EŞ ANLAMLISINI KULLANMADAN aynen yaz — kendi yorumunu veya alternatif çevirini KATMA. Görselde yazılı bir anlam YOKSA (sadece kelimenin kendisi varsa) o zaman doğru ve yaygın Türkçe anlamını sen üret.
3. "example_sentence" alanı: SADECE ve KESİNLİKLE İngilizce bir örnek cümle yaz. Türkçe veya başka bir dilde örnek cümle YAZMA. Görselde kelimeyle birlikte bir örnek cümle varsa onu birebir kullan; yoksa kelimeye uygun basit, doğru dilbilgisiyle yazılmış yeni bir İngilizce cümle üret.
4. Aynı kelime birden fazla görselde tekrar geçiyorsa SADECE BİR KEZ ekle (tekrar eden kaydı çıkarma).
5. "hint_word": Kelimeyi akılda tutan TEK Türkçe ipucu kelime. Anlamın kendisi olmasın. Sesi veya çağrışımı İngilizce kelimeye bağlansın. Cümle yazma.
6. "synonyms": Bu İngilizce kelimenin 3 yaygın eş anlamlısı. Dizi olarak yaz. Kelimenin kendisini tekrarlama.
Yanıtı sadece ve strictly JSON array formatında döndür, başka hiçbir açıklama ekleme.
Format:
[{"word": "", "preposition": "", "meaning": "", "example_sentence": "", "hint_word": "", "synonyms": ["", "", ""]}]`;
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
function collectApiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY);
  }
  let i = 2;
  while (process.env[`GEMINI_API_KEY_${i}`]) {
    keys.push(process.env[`GEMINI_API_KEY_${i}`] as string);
    i++;
  }
  return keys;
}
function isRetryableError(err: unknown): boolean {
  const error = err as {
    message?: string;
    status?: number | string;
    code?: number | string;
  };
  const message = String(error?.message ?? err ?? "").toUpperCase();
  const status = String(error?.status ?? error?.code ?? "");
  return (
    status === "429" ||
    status === "500" ||
    status === "503" ||
    message.includes("429") ||
    message.includes("500") ||
    message.includes("503") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("UNAVAILABLE") ||
    message.includes("TIMEOUT") ||
    message.includes("ZAMAN AŞIMI") ||
    message.includes("ABORTED")
  );
}
function getRetryDelay(): number {
  return 800 + Math.floor(Math.random() * 400);
}

const CALL_TIMEOUT_MS = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("Gemini zaman aşımı");
      (error as { status?: number }).status = 503;
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function generateWithRetry(ai: GoogleGenAI, contents: Parameters<GoogleGenAI["models"]["generateContent"]>[0]["contents"], maxRetries = 1) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(
        ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents,
          config: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
        CALL_TIMEOUT_MS
      );
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === maxRetries) throw err;
      const delay = getRetryDelay();
      console.warn(`Gemini geçici hata. ${delay}ms sonra bir kez daha denenecek.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
export async function POST(request: NextRequest) {
  try {
    const apiKeys = collectApiKeys();
    if (apiKeys.length === 0) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY ortam değişkeni tanımlı değil.",
        },
        { status: 500 }
      );
    }
    const formData = await request.formData();
    const files = formData.getAll("images") as File[];
    if (!files || files.length === 0) {
      return NextResponse.json(
        {
          error:
            "Görsel dosyası bulunamadı ('images' alanı gerekli).",
        },
        { status: 400 }
      );
    }
    const MAX_IMAGES = 3;
    if (files.length > MAX_IMAGES) {
      return NextResponse.json(
        {
          error: `En fazla ${MAX_IMAGES} görsel birden yükleyebilirsin.`,
        },
        { status: 400 }
      );
    }
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        return NextResponse.json(
          {
            error: "Sadece JPG/PNG formatları destekleniyor.",
          },
          { status: 400 }
        );
      }
    }
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
    const contents = [
      {
        role: "user",
        parts: [
          {
            text: EXTRACTION_PROMPT,
          },
          ...imageParts,
        ],
      },
    ];
    let rawText: string | undefined;
    let lastError: unknown = null;
    let allRetryable = true;
    for (
      let keyIndex = 0;
      keyIndex < apiKeys.length;
      keyIndex++
    ) {
      const ai = new GoogleGenAI({
        apiKey: apiKeys[keyIndex],
      });
      try {
        console.log(
          `Gemini API key #${keyIndex + 1}/${apiKeys.length} deneniyor...`
        );
        const response = await generateWithRetry(ai, contents, 1);
        rawText = response.text;
        lastError = null;
        console.log(
          `Gemini API key #${keyIndex + 1} başarılı.`
        );
        break;
      } catch (err) {
        lastError = err;
        if (!isRetryableError(err)) {
          allRetryable = false;
          console.error(
            `Gemini API key #${keyIndex + 1} geri döndürülemez hata verdi:`,
            err
          );
          throw err;
        }
        const hasNextKey =
          keyIndex < apiKeys.length - 1;
        if (hasNextKey) {
          console.warn(
            `Gemini API key #${keyIndex + 1} başarısız oldu. Sıradaki key deneniyor.`
          );
          continue;
        }
        console.error(
          "Tüm Gemini API key'leri başarısız oldu:",
          err
        );
      }
    }
    if (!rawText) {
      if (allRetryable && lastError) {
        return NextResponse.json(
          {
            error:
              "Gemini şu anda yoğun veya geçici olarak kullanılamıyor. Lütfen birkaç saniye sonra tekrar deneyin.",
            retryable: true,
          },
          { status: 503 }
        );
      }
      throw (
        lastError ??
        new Error("Gemini boş yanıt döndürdü.")
      );
    }
    let extractedWords: ExtractedWord[];
    try {
      extractedWords = extractJsonArray(rawText);
    } catch (parseError) {
      console.error(
        "JSON parse hatası:",
        parseError,
        "Ham yanıt:",
        rawText
      );
      return NextResponse.json(
        {
          error:
            "Gemini yanıtı geçerli JSON formatında değil.",
          raw: rawText,
        },
        { status: 502 }
      );
    }
    if (extractedWords.length === 0) {
      return NextResponse.json(
        {
          error:
            "Görselde herhangi bir kelime tespit edilemedi.",
          words: [],
        },
        { status: 200 }
      );
    }
    const rowsToInsert = extractedWords.map((item) => ({
      word: item.word?.trim() ?? "",
      preposition:
        item.preposition?.trim() || null,
      meaning: item.meaning?.trim() ?? "",
      example_sentence: item.example_sentence?.trim() ?? "",
      hint_word: normalizeHint(item.hint_word, item.meaning),
      synonyms: normalizeSynonyms(item.synonyms, item.word),
      repetitions: 0,
      interval: 1,
      ease_factor: 2.5,
      next_review_date: new Date().toISOString(),
      in_learning_phase: false,
      learning_streak: 0,
    }));
    const supabaseAdmin = createServiceRoleClient();
    let { data: insertedRows, error: insertError } = await supabaseAdmin
      .from("flashcards")
      .insert(rowsToInsert)
      .select();
    if (insertError && /hint_word|synonyms|column/i.test(insertError.message)) {
      const plain = rowsToInsert.map(({ hint_word: _hint, synonyms: _synonyms, ...rest }) => rest);
      const retry = await supabaseAdmin.from("flashcards").insert(plain).select();
      insertedRows = retry.data;
      insertError = retry.error;
    }
    if (insertError) {
      console.error(
        "Supabase insert hatası:",
        insertError
      );
      return NextResponse.json(
        {
          error:
            "Kelimeler veritabanına kaydedilemedi.",
          details: insertError.message,
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      {
        success: true,
        count: insertedRows?.length ?? 0,
        words: insertedRows,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error(
      "process-image genel hata:",
      err
    );
    const message =
      err instanceof Error
        ? err.message
        : "Bilinmeyen hata";
    if (isRetryableError(err)) {
      return NextResponse.json(
        {
          error:
            "Gemini şu anda yoğun veya geçici olarak kullanılamıyor. Lütfen birkaç saniye sonra tekrar deneyin.",
          details: message,
          retryable: true,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error:
          "İşlem sırasında beklenmeyen bir hata oluştu.",
        details: message,
      },
      { status: 500 }
    );
  }
}
