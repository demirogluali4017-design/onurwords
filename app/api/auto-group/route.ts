import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 45;

const BATCH_SIZE = 80; // her istekte işlenecek kelime sayısı (hız + zaman aşımı güvenliği için düşürüldü)
const MAX_EXISTING_GROUPS_IN_PROMPT = 200; // prompt'u şişirmemek için

function buildPrompt(batch: WordRow[], existingGroups: GroupRow[]): string {
  const groupsText =
    existingGroups.length > 0
      ? existingGroups
          .slice(0, MAX_EXISTING_GROUPS_IN_PROMPT)
          .map((g) => `${g.id} | ${g.name}`)
          .join("\n")
      : "(henüz hiç grup yok)";

  const wordsText = batch.map((w) => `${w.id} | ${w.word} | ${w.meaning}`).join("\n");

  return `Aşağıda mevcut eş anlamlı gruplar ve grupsuz kelimeler var.

MEVCUT GRUPLAR (id | grup adı):
${groupsText}

GRUPSUZ KELİMELER (id | kelime | Türkçe anlam):
${wordsText}

Görev: Her grupsuz kelime için Türkçe anlamına bakarak KARAR VER:
1. Eğer kelime, MEVCUT gruplardan biriyle anlamca gerçekten örtüşüyorsa (eş anlamlı/çok yakın anlamlıysa), o kelimeyi o grubun id'sine ekle.
2. Eğer grupsuz kelimeler arasında birbirleriyle eşleşen ama hiçbir mevcut grupla örtüşmeyen kelimeler varsa, onlar için YENİ bir grup öner (en az 2 kelime).
3. Hiçbir kelimeyle eşleşmeyen kelimeleri hiçbir yere dahil etme, sonuçtan çıkar.
4. Sadece gerçekten örtüşen anlamları eşleştir, yüzeysel benzerlik yeterli değil.

Yanıtı SADECE JSON array olarak ver, başka açıklama ekleme. Format:
[
  {"action":"existing","group_id":"...","word_ids":["id1","id2"]},
  {"action":"new","group_name":"...","word_ids":["id3","id4"]}
]`;
}

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

interface GroupRow {
  id: string;
  name: string;
}

interface GeminiDecision {
  action: "existing" | "new";
  group_id?: string;
  group_name?: string;
  word_ids: string[];
}

async function callGemini(prompt: string, apiKeys: string[]): Promise<GeminiDecision[]> {
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
      return parsed as GeminiDecision[];
    } catch (err) {
      lastError = err;
      const hasNextKey = keyIndex < apiKeys.length - 1;
      if (isRetryableError(err) && hasNextKey) continue;
      throw err;
    }
  }

  throw lastError ?? new Error("Bilinmeyen hata");
}

/**
 * Bu endpoint HER ÇAĞRIDA SADECE BİR PARÇA (BATCH_SIZE kadar) grupsuz
 * kelime işler ve döner — Vercel'in 45sn'lik zaman aşımına asla
 * yaklaşmaz. Çoklu parça, İSTEMCİ TARAFINDA (words/page.tsx) bu
 * endpoint'i döngüyle tekrar tekrar çağırarak işlenir. Her çağrı,
 * mevcut grupları da Gemini'ye context olarak veriyor — böylece bir
 * önceki çağrıda oluşan grup, bu çağrıdaki kelimeye de açık oluyor
 * (parçalar arası eş anlamlı kaçırma sorunu böyle çözülüyor).
 */
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

    const { data: ungroupedPage, error: fetchError } = await supabaseAdmin
      .from("flashcards")
      .select("id, word, meaning")
      .is("group_id", null)
      .limit(BATCH_SIZE);

    if (fetchError) {
      return NextResponse.json(
        { error: "Kelimeler okunamadı.", details: fetchError.message },
        { status: 500 }
      );
    }

    const batch = (ungroupedPage ?? []) as WordRow[];

    if (batch.length < 2) {
      return NextResponse.json({
        success: true,
        done: true,
        processed: batch.length,
        groupsCreated: 0,
        wordsGrouped: 0,
        remainingUngrouped: 0,
      });
    }

    const { count: remainingBefore } = await supabaseAdmin
      .from("flashcards")
      .select("id", { count: "exact", head: true })
      .is("group_id", null);

    const { data: existingGroups } = await supabaseAdmin
      .from("word_groups")
      .select("id, name")
      .order("created_at", { ascending: false })
      .limit(MAX_EXISTING_GROUPS_IN_PROMPT);

    const prompt = buildPrompt(batch, (existingGroups ?? []) as GroupRow[]);
    const decisions = await callGemini(prompt, apiKeys);

    const validIds = new Set(batch.map((w) => w.id));
    const existingGroupIds = new Set((existingGroups ?? []).map((g) => g.id));

    let groupsCreated = 0;
    let wordsGrouped = 0;
    const errors: string[] = [];

    for (const decision of decisions) {
      const ids = (decision.word_ids ?? []).filter((id) => validIds.has(id));

      if (decision.action === "existing") {
        if (ids.length === 0 || !decision.group_id || !existingGroupIds.has(decision.group_id)) {
          continue;
        }
        const { error: updateError } = await supabaseAdmin
          .from("flashcards")
          .update({ group_id: decision.group_id })
          .in("id", ids);
        if (updateError) {
          errors.push(`Gruba ekleme hatası: ${updateError.message}`);
          continue;
        }
        wordsGrouped += ids.length;
      } else if (decision.action === "new") {
        if (ids.length < 2) continue;

        const { data: newGroup, error: groupError } = await supabaseAdmin
          .from("word_groups")
          .insert({ name: decision.group_name || "Grup" })
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
    }

    const { count: remainingAfter } = await supabaseAdmin
      .from("flashcards")
      .select("id", { count: "exact", head: true })
      .is("group_id", null);

    // Bu batch'te hiç ilerleme kaydedilmediyse (örn. tüm kelimeler
    // gerçekten eşleşmiyordu) sonsuz döngüye girmemek için done=true
    // döndür — istemci farklı bir batch'e geçmez, işlemi bitirir.
    const madeProgress = (remainingAfter ?? 0) < (remainingBefore ?? 0);

    return NextResponse.json({
      success: true,
      done: !madeProgress || (remainingAfter ?? 0) === 0,
      processed: batch.length,
      groupsCreated,
      wordsGrouped,
      remainingUngrouped: remainingAfter ?? 0,
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
