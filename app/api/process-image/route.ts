import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createServiceRoleClient } from "@/lib/supabase";
import { ExtractedWord } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const EXTRACTION_PROMPT = `
You are a FAST vocabulary extraction assistant.

Your task is to extract English vocabulary items from the uploaded image(s).

IMPORTANT PERFORMANCE RULE:
Do NOT spend excessive time trying to perfectly OCR the handwriting.
If handwriting is unclear, partially unreadable, abbreviated, or messy,
make the most reasonable linguistic guess based on the visible letters,
context, surrounding words, and common English vocabulary.

The goal is FAST and USEFUL extraction, not perfect OCR.

Process ALL uploaded images in a single pass.
If multiple images are provided, treat them as pages of the same document.

RULES:

1. WORD
Extract the English vocabulary word exactly as reasonably readable.
Do not invent completely unrelated words.
If handwriting is unclear, choose the most plausible English word.

2. PREPOSITION
If the word is a verb/adjective/noun and a preposition pattern is visibly written,
preserve the complete pattern.

Examples:
"depend on" -> "on"
"listen to" -> "to"
"interested in" -> "in"

If patterns such as "sth", "sb", "something", "someone" are written,
preserve them when useful.

If there is no visible preposition pattern, use "".

3. MEANING
If a Turkish meaning is already written in the image,
COPY THAT TURKISH MEANING as closely as possible.

Do NOT replace it with your own synonym.
Do NOT add alternative meanings unless necessary to understand the written word.

If there is no Turkish meaning visible,
generate the most common and useful Turkish meaning.

4. EXAMPLE SENTENCE
The example sentence MUST be in English.

If an example sentence is visible in the image,
preserve it as closely as possible.

If there is no example sentence,
create one short, natural and grammatically correct English sentence.

5. DUPLICATES
If the same vocabulary item appears more than once across the images,
return it only ONCE.

6. SPEED
Do not provide explanations.
Do not analyze the image unnecessarily.
Do not try to reconstruct every unclear handwritten stroke.
Make a reasonable best guess and continue.

Return ONLY a valid JSON array.

Format:
[
  {
    "word": "",
    "preposition": "",
    "meaning": "",
    "example_sentence": ""
  }
]
`;

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

function isRetryableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);

  return (
    message.includes("429") ||
    message.includes("503") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("UNAVAILABLE") ||
    message.includes("DEADLINE_EXCEEDED") ||
    message.includes("TIMEOUT") ||
    message.includes("timed out")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "GEMINI_API_KEY ortam değişkeni tanımlı değil.",
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const files = formData.getAll("images") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        {
          error: "Görsel dosyası bulunamadı ('images' alanı gerekli).",
        },
        { status: 400 }
      );
    }

    const MAX_IMAGES = 3;

    if (files.length > MAX_IMAGES) {
      return NextResponse.json(
        {
          error: `En fazla ${MAX_IMAGES} görsel yükleyebilirsin.`,
        },
        { status: 400 }
      );
    }

    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];

    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        return NextResponse.json(
          {
            error:
              "Sadece JPG, PNG veya WEBP görselleri destekleniyor.",
          },
          { status: 400 }
        );
      }
    }

    /*
     * Tüm görselleri tek Gemini isteğinde gönderiyoruz.
     * Böylece 3 ayrı model çağrısı yapıp süreyi gereksiz yere artırmıyoruz.
     */
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

    const ai = new GoogleGenAI({
      apiKey,
    });

    let rawText: string | undefined;
    let lastError: unknown = null;

    /*
     * İlk deneme.
     * 503 / 429 gibi geçici hatalarda yalnızca 1 kısa retry.
     *
     * Tek API key kullanıldığı için uzun retry zinciri kurmuyoruz.
     */
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(
          `Gemini extraction denemesi: ${attempt}/${2}`
        );

        const response = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: EXTRACTION_PROMPT,
                },
                ...imageParts,
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            temperature: 0.1,
            maxOutputTokens: 2048,
          },
        });

        rawText = response.text;
        lastError = null;

        break;
      } catch (err) {
        lastError = err;

        console.error(
          `Gemini extraction hatası - deneme ${attempt}:`,
          err
        );

        const retryable = isRetryableError(err);

        if (!retryable || attempt >= 2) {
          throw err;
        }

        /*
         * Kısa bekleme.
         * Uzun 5-10 saniyelik backoff kullanmıyoruz çünkü
         * Vercel'in 60 saniyelik function süresini tüketebilir.
         */
        await sleep(1200);
      }
    }

    if (lastError) {
      throw lastError;
    }

    if (!rawText) {
      return NextResponse.json(
        {
          error: "Gemini boş yanıt döndürdü.",
          retryable: true,
        },
        { status: 502 }
      );
    }

    let extractedWords: ExtractedWord[];

    try {
      extractedWords = extractJsonArray(rawText);
    } catch (parseError) {
      console.error(
        "Gemini JSON parse hatası:",
        parseError,
        "Ham yanıt:",
        rawText
      );

      return NextResponse.json(
        {
          error: "Gemini geçerli JSON döndürmedi.",
          retryable: true,
        },
        { status: 502 }
      );
    }

    if (extractedWords.length === 0) {
      return NextResponse.json(
        {
          success: true,
          count: 0,
          words: [],
          message: "Görselde kelime tespit edilemedi.",
        },
        { status: 200 }
      );
    }

    /*
     * Aynı kelime Gemini tarafından tekrar döndürülürse
     * Supabase'e tekrar eklenmesini engelle.
     */
    const uniqueWords = new Map<string, ExtractedWord>();

    for (const item of extractedWords) {
      const word = item.word?.trim() ?? "";

      if (!word) continue;

      const key = word.toLowerCase();

      if (!uniqueWords.has(key)) {
        uniqueWords.set(key, {
          word,
          preposition: item.preposition?.trim() ?? "",
          meaning: item.meaning?.trim() ?? "",
          example_sentence:
            item.example_sentence?.trim() ?? "",
        });
      }
    }

    const cleanedWords = Array.from(uniqueWords.values());

    if (cleanedWords.length === 0) {
      return NextResponse.json(
        {
          success: true,
          count: 0,
          words: [],
        },
        { status: 200 }
      );
    }

    /*
     * Supabase'e kaydedilecek satırlar.
     */
    const rowsToInsert = cleanedWords.map((item) => ({
      word: item.word?.trim() ?? "",
      preposition: item.preposition?.trim() || null,
      meaning: item.meaning?.trim() ?? "",
      example_sentence:
        item.example_sentence?.trim() ?? "",

      repetitions: 0,
      interval: 1,
      ease_factor: 2.5,
      next_review_date: new Date().toISOString(),
      in_learning_phase: false,
      learning_streak: 0,
    }));

    const supabaseAdmin = createServiceRoleClient();

    const { data: insertedRows, error: insertError } =
      await supabaseAdmin
        .from("flashcards")
        .insert(rowsToInsert)
        .select();

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

    const retryable = isRetryableError(err);

    if (retryable) {
      return NextResponse.json(
        {
          error:
            "Gemini şu anda yoğun veya işlem zaman aşımına uğradı.",
          details: message,
          retryable: true,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error:
          "Görsel işlenirken beklenmeyen bir hata oluştu.",
        details: message,
        retryable: false,
      },
      { status: 500 }
    );
  }
}
