export interface WordMemory {
  hint_word: string | null;
  synonyms: string | null;
}

const EMPTY: WordMemory = { hint_word: null, synonyms: null };
const MODELS = ["gemini-3.5-flash-lite"];

const HINT_RULE = `hint_word: Kelimeyi hafızada tutan kısa bir Türkçe çağrışım cümlesi. Düz çeviri yazma.
Cümlede iki şey birden olsun:
1) İngilizce kelimenin sesine veya yazılışına benzeyen tanıdık bir Türkçe kelime, isim ya da öbek.
2) Kelimenin gerçek anlamı, aynı cümlenin içinde.
Örnek: "par intérim" arasıra demektir. İpucu "Fatih Terim arasıra gelir gider" olsun. "Fatih Terim" sese benzer, "arasıra" gerçek anlamdır.
"futile" faydasız demektir. İpucu "Faydasız işe futile diye üzülme" gibi anlamı da taşıyan bir cümle olsun. Sadece "fay" yazma.
Tek cümle yaz, en fazla 12 kelime.`;

export function normalizeHint(value: unknown): string | null {
  const hint = String(value ?? "")
    .replace(/["“”]/g, "")
    .split(/[.!?]/)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (!hint || hint.length > 140) return null;
  return hint;
}

export function normalizeSynonyms(value: unknown, word = ""): string | null {
  const parts = Array.isArray(value) ? value.map(String) : String(value ?? "").split(/[,;|]/);
  const banned = word.trim().toLocaleLowerCase("en");
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const item = raw.replace(/["“”]/g, "").trim();
    if (!item || item.length > 40) continue;
    const key = item.toLocaleLowerCase("en");
    if (key === banned || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length === 4) break;
  }
  return unique.length ? unique.join(", ") : null;
}

function collectApiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  let i = 2;
  while (process.env[`GEMINI_API_KEY_${i}`]) {
    keys.push(process.env[`GEMINI_API_KEY_${i}`] as string);
    i++;
  }
  return keys;
}

async function geminiText(prompt: string): Promise<string | null> {
  const keys = collectApiKeys();
  for (const apiKey of keys) {
    for (const model of MODELS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.4,
                responseMimeType: "application/json",
              },
            }),
            signal: controller.signal,
          }
        );
        const data = (await res.json().catch(() => ({}))) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        if (!res.ok) continue;
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
        if (text.trim()) return text;
      } catch (err) {
        console.warn("İpucu üretilemedi:", err);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return null;
}

function parseMemory(raw: string, word: string, meaning: string): WordMemory {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned) as { hint_word?: unknown; synonyms?: unknown };
  return {
    hint_word: normalizeHint(parsed.hint_word),
    synonyms: normalizeSynonyms(parsed.synonyms, word),
  };
}

export async function suggestMemory(word: string, meaning: string): Promise<WordMemory> {
  const prompt = `İngilizce kelime: ${word}
Türkçe anlam: ${meaning}
Sadece JSON döndür:
{"hint_word":"","synonyms":["","",""]}
${HINT_RULE}
synonyms: bu kelimenin 3 yaygın İngilizce eş anlamlısı. Kelimenin kendisini yazma.`;
  const raw = await geminiText(prompt);
  if (!raw) return EMPTY;
  try {
    return parseMemory(raw, word, meaning);
  } catch {
    return EMPTY;
  }
}

export async function suggestMemories(items: { word: string; meaning: string }[]): Promise<WordMemory[]> {
  if (items.length === 0) return [];
  const lines = items.map((item, index) => `${index + 1}. ${item.word} = ${item.meaning}`).join("\n");
  const prompt = `Her satır bir İngilizce kelime ve Türkçe anlamı.
${lines}
Sadece JSON array döndür. Sıra ve sayı aynı kalsın: ${items.length} kayıt.
[{"hint_word":"","synonyms":["","",""]}]
${HINT_RULE}
synonyms: 3 yaygın İngilizce eş anlam. Kelimenin kendisini yazma.`;
  const raw = await geminiText(prompt);
  if (!raw) return items.map(() => EMPTY);
  try {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as { hint_word?: unknown; synonyms?: unknown }[];
    if (!Array.isArray(parsed)) return items.map(() => EMPTY);
    return items.map((item, index) => ({
      hint_word: normalizeHint(parsed[index]?.hint_word),
      synonyms: normalizeSynonyms(parsed[index]?.synonyms, item.word),
    }));
  } catch {
    return items.map(() => EMPTY);
  }
}
