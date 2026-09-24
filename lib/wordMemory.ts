import { GoogleGenAI } from "@google/genai";

export interface WordMemory {
  hint_word: string | null;
  synonyms: string | null;
}

const EMPTY: WordMemory = { hint_word: null, synonyms: null };

export function normalizeHint(value: unknown, meaning = ""): string | null {
  const hint = String(value ?? "")
    .replace(/["“”]/g, "")
    .split(/[.,;:|/]/)[0]
    .trim();
  if (!hint || hint.length > 40) return null;
  if (meaning && hint.toLocaleLowerCase("tr") === meaning.trim().toLocaleLowerCase("tr")) return null;
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("zaman aşımı")), ms);
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

export async function suggestMemory(word: string, meaning: string): Promise<WordMemory> {
  const keys = collectApiKeys();
  if (keys.length === 0) return EMPTY;

  const prompt = `İngilizce kelime: ${word}
Türkçe anlam: ${meaning}
Sadece JSON döndür:
{"hint_word":"","synonyms":["","",""]}
hint_word: anlamın kendisi olmayan, sesi veya çağrışımıyla bu İngilizce kelimeyi akılda tutan TEK Türkçe kelime.
synonyms: bu kelimenin 3 yaygın İngilizce eş anlamlısı. Kelimenin kendisini yazma.`;

  for (const apiKey of keys) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await withTimeout(
        ai.models.generateContent({
          model: "gemini-3.5-flash-lite",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0.4,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        12000
      );
      const raw = String(response.text ?? "")
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "");
      const parsed = JSON.parse(raw) as { hint_word?: unknown; synonyms?: unknown };
      return {
        hint_word: normalizeHint(parsed.hint_word, meaning),
        synonyms: normalizeSynonyms(parsed.synonyms, word),
      };
    } catch (err) {
      console.warn("İpucu üretilemedi:", err);
    }
  }
  return EMPTY;
}
