import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase";
import { ExtractedWord } from "@/types";
import { normalizeHint, normalizeSynonyms, suggestMemories } from "@/lib/wordMemory";
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
5. "hint_word": Düz çeviri yazma. Kelimeyi hafızada tutan tek bir Türkçe çağrışım cümlesi yaz. Cümlede hem kelimenin sesine benzeyen tanıdık bir Türkçe söz olsun hem de gerçek anlamı geçsin. Örnek: "par intérim" (arasıra) için "Fatih Terim arasıra gelir gider". En fazla 12 kelime.
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

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
const CALL_TIMEOUT_MS = 24000;

async function callModel(
  apiKey: string,
  model: string,
  contents: unknown,
  withThinking: boolean
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const generationConfig: Record<string, unknown> = {
      temperature: 0.2,
      responseMimeType: "application/json",
    };
    if (withThinking) generationConfig.thinkingConfig = { thinkingLevel: "minimal" };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({ contents, generationConfig }),
        signal: controller.signal,
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string };
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    if (!res.ok) {
      const error = new Error(data.error?.message || `Gemini ${res.status}`);
      (error as { status?: number }).status = res.status;
      throw error;
    }
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
    if (!text.trim()) throw new Error("Gemini boş yanıt döndürdü.");
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const timeout = new Error("Gemini zaman aşımı");
      (timeout as { status?: number }).status = 503;
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function extractText(apiKeys: string[], contents: unknown): Promise<string> {
  let lastError: unknown = null;
  for (const apiKey of apiKeys) {
    for (const model of MODELS) {
      try {
        console.log(`Gemini ${model} deneniyor`);
        return await callModel(apiKey, model, contents, true);
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : "";
        const status = (err as { status?: number }).status;
        if (status === 400 && /thinking/i.test(message)) {
          try {
            return await callModel(apiKey, model, contents, false);
          } catch (retryErr) {
            lastError = retryErr;
          }
        }
        console.warn(`Gemini ${model} olmadı:`, message || err);
      }
    }
  }
  throw lastError ?? new Error("Gemini yanıt vermedi.");
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
    try {
      rawText = await extractText(apiKeys, contents);
    } catch (err) {
      lastError = err;
      console.error("Gemini çıkarma başarısız:", err);
    }
    if (!rawText) {
      if (lastError && isRetryableError(lastError)) {
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
      hint_word: normalizeHint(item.hint_word),
      synonyms: normalizeSynonyms(item.synonyms, item.word),
      repetitions: 0,
      interval: 1,
      ease_factor: 2.5,
      next_review_date: new Date().toISOString(),
      in_learning_phase: false,
      learning_streak: 0,
    }));
    try {
      const memories = await suggestMemories(
        rowsToInsert.map((row) => ({ word: row.word, meaning: row.meaning }))
      );
      memories.forEach((memory, index) => {
        if (memory.hint_word) rowsToInsert[index].hint_word = memory.hint_word;
        if (memory.synonyms) rowsToInsert[index].synonyms = memory.synonyms;
      });
    } catch (err) {
      console.warn("İpucu turu atlandı:", err);
    }
    const supabaseAdmin = createServiceRoleClient();
    let { data: insertedRows, error: insertError } = await supabaseAdmin
      .from("flashcards")
      .insert(rowsToInsert)
      .select();
    let memoryWarning: string | null = null;
    if (insertError && /hint_word|synonyms|column/i.test(insertError.message)) {
      memoryWarning =
        "Kelimeler kaydedildi ama ipucu sütunu yok. Supabase SQL editöründe hint_word ve synonyms sütunlarını ekle, sonra yeni kelime yükle.";
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
        warning: memoryWarning,
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
