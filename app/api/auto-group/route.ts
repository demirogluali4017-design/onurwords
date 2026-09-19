import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 150; // tek Gemini isteğinde işlenecek kelime sayısı

const GROUPING_PROMPT = `Aşağıda "id | kelime | Türkçe anlam" formatında bir kelime listesi var. Bu kelimeleri Türkçe anlamlarına göre incele ve AYNI veya ÇOK YAKIN anlama gelen (eş anlamlı sayılabilecek) kelimeleri kümelere ayır.

Kurallar:
- Bir kümede EN AZ 2 kelime olmalı. Tek başına kalan (başka hiçbir kelimeyle eşleşmeyen) kelimeleri HİÇBİR kümeye dahil etme, sonuçtan tamamen çıkar.
- Sadece anlamca gerçekten örtüşen kelimeleri aynı kümeye koy — yüzeysel benzerlik yeterli değil, gerçekten eş anlamlı/çok yakın anlamlı olmalı.
- Her küme için kısa, açıklayıcı bir Türkçe grup adı üret (örn. "artırmak/büyütmek", "belirsiz/muğlak").
- Bir kelime sadece TEK bir kümede olabilir.
- Yanıtı SADECE JSON array olarak ver, başka hiçbir açıklama ekleme. Format:
[{"group_name": "...", "word_ids": ["id1", "id2", ...]}]

Liste:
`;

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

function isRetryableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("429") ||
    message.includes("503") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("UNAVAILABLE")
  );
}

interface WordRow {
  id: string;
  word: string;
  meaning: string;
}

interface GeminiCluster {
  group_name: string;
  word_ids: string[];
}

async function callGeminiForBatch(batch: WordRow[], apiKeys: string[]): Promise<GeminiCluster[]> {
  const listText = batch.map((w) => `${w.id} | ${w.word} | ${w.meaning}`).join("\n");
  const prompt = GROUPING_PROMPT + listText;

  let lastError: unknown = null;

  for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
    const ai = new GoogleGenAI({ apiKey: apiKeys[keyIndex] });
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json", temperature: 0.1 },
      });

      const rawText = response.text;
      if (!rawText) throw new Error("Gemini boş yanıt döndürdü.");

      const cleaned = rawText
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) throw new Error("Gemini yanıtı JSON array değil.");
      return parsed as GeminiCluster[];
    } catch (err) {
      lastError = err;
      const hasNextKey = keyIndex < apiKeys.length - 1;
      if (isRetryableError(err) && hasNextKey) continue;
      throw err;
    }
  }

  throw lastError ?? new Error("Bilinmeyen hata");
}

export async function POST(_request: NextRequest) {
  try {
    const apiKeys = collectApiKeys();
    if (apiKeys.length === 0) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY ortam değişkeni tanımlı değil." },
        { status: 500 }
      );
    }

    const supabaseAdmin = createServiceRoleClient();

    // Sadece grupsuz kelimeleri işle (zaten gruplanmış olanlara dokunma)
    let allUngrouped: WordRow[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from("flashcards")
        .select("id, word, meaning")
        .is("group_id", null)
        .range(from, from + 999);
      if (error || !data) break;
      allUngrouped = allUngrouped.concat(data as WordRow[]);
      if (data.length < 1000) break;
      from += 1000;
    }

    if (allUngrouped.length < 2) {
      return NextResponse.json({
        success: true,
        groupsCreated: 0,
        wordsGrouped: 0,
        message: "Gruplanacak yeterli grupsuz kelime yok.",
      });
    }

    // Batch'lere böl
    const batches: WordRow[][] = [];
    for (let i = 0; i < allUngrouped.length; i += BATCH_SIZE) {
      batches.push(allUngrouped.slice(i, i + BATCH_SIZE));
    }

    let groupsCreated = 0;
    let wordsGrouped = 0;
    const errors: string[] = [];

    for (const batch of batches) {
      try {
        const clusters = await callGeminiForBatch(batch, apiKeys);
        const validIds = new Set(batch.map((w) => w.id));

        for (const cluster of clusters) {
          const ids = (cluster.word_ids ?? []).filter((id) => validIds.has(id));
          if (ids.length < 2) continue; // tek kelimelik kümeleri atla

          const { data: newGroup, error: groupError } = await supabaseAdmin
            .from("word_groups")
            .insert({ name: cluster.group_name || "Grup" })
            .select()
            .single();

          if (groupError || !newGroup) {
            errors.push(`Grup oluşturulamadı: ${groupError?.message}`);
            continue;
          }

          const { error: updateError } = await supabaseAdmin
            .from("flashcards")
            .update({ group_id: newGroup.id })
            .in("id", ids);

          if (updateError) {
            errors.push(`Kelimeler güncellenemedi: ${updateError.message}`);
            continue;
          }

          groupsCreated += 1;
          wordsGrouped += ids.length;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Bilinmeyen hata";
        errors.push(`Batch hatası: ${message}`);
      }
    }

    return NextResponse.json({
      success: true,
      groupsCreated,
      wordsGrouped,
      totalProcessed: allUngrouped.length,
      batchCount: batches.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    console.error("auto-group hata:", err);
    return NextResponse.json(
      { error: "Otomatik gruplama başarısız.", details: message },
      { status: 500 }
    );
  }
}
