export interface OcrToken {
  id: string;
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrPair {
  id: string;
  word: string;
  meaning: string;
}

export interface OcrPage {
  tokens: OcrToken[];
  pairs: OcrPair[];
  width: number;
  height: number;
}

const LETTER = /[A-Za-zÀ-ÖØ-öø-ÿĞğİıŞşÇçÖöÜü]/;
const PAIR_SPLIT = /\s+(?:—|–|--|-|:|\||→|=>)\s+/;

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitPair(text: string): { word: string; meaning: string } | null {
  const parts = text.split(PAIR_SPLIT).map(clean).filter(Boolean);
  if (parts.length < 2) return null;
  const word = parts[0];
  const meaning = parts.slice(1).join(" ");
  if (!LETTER.test(word) || !LETTER.test(meaning)) return null;
  if (word.length < 2 || meaning.length < 2) return null;
  return { word, meaning };
}

function pairFromGap(words: OcrToken[]): { word: string; meaning: string } | null {
  if (words.length < 2) return null;
  let maxGap = 0;
  let splitAt = -1;
  for (let index = 1; index < words.length; index += 1) {
    const gap = words[index].bbox.x0 - words[index - 1].bbox.x1;
    if (gap > maxGap) {
      maxGap = gap;
      splitAt = index;
    }
  }
  const height =
    words.reduce((sum, word) => sum + (word.bbox.y1 - word.bbox.y0), 0) / words.length;
  if (splitAt <= 0 || maxGap < Math.max(18, height * 1.3)) return null;
  const word = clean(words.slice(0, splitAt).map((item) => item.text).join(" "));
  const meaning = clean(words.slice(splitAt).map((item) => item.text).join(" "));
  if (!LETTER.test(word) || !LETTER.test(meaning) || word.length < 2 || meaning.length < 2) return null;
  return { word, meaning };
}

type RawWord = {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
};

function toToken(word: RawWord, id: string): OcrToken | null {
  const text = clean(word.text ?? "");
  const confidence = word.confidence ?? 0;
  if (!text || !word.bbox || !LETTER.test(text)) return null;
  if (text.length < 2 && confidence < 80) return null;
  if (confidence < 40) return null;
  return { id, text, confidence, bbox: word.bbox };
}

export async function recognizeImages(
  files: File[],
  onProgress?: (pageIndex: number, progress: number) => void
): Promise<OcrPage[]> {
  const { createWorker } = await import("tesseract.js");
  let currentPage = 0;
  const worker = await createWorker("eng+tur", 1, {
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        onProgress?.(currentPage, message.progress);
      }
    },
  });

  const pages: OcrPage[] = [];

  try {
    for (let pageIndex = 0; pageIndex < files.length; pageIndex += 1) {
      currentPage = pageIndex;
      const file = files[pageIndex];
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close?.();

      const { data } = await worker.recognize(file);
      const tokens: OcrToken[] = [];
      data.words?.forEach((word, index) => {
        const token = toToken(word, `${pageIndex}-${index}`);
        if (token) tokens.push(token);
      });
      tokens.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

      const pairs: OcrPair[] = [];
      const seen = new Set<string>();
      data.lines?.forEach((line, lineIndex) => {
        const lineTokens: OcrToken[] = [];
        line.words?.forEach((word, index) => {
          const token = toToken(word, `${pageIndex}-line-${lineIndex}-${index}`);
          if (token) lineTokens.push(token);
        });
        const text = clean(line.text || lineTokens.map((token) => token.text).join(" "));
        const pair = splitPair(text) || pairFromGap(lineTokens);
        if (!pair) return;
        const key = `${pair.word.toLowerCase()}→${pair.meaning.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        pairs.push({ id: `${pageIndex}-pair-${lineIndex}`, ...pair });
      });

      pages.push({ tokens, pairs, width, height });
    }
    return pages;
  } finally {
    await worker.terminate();
  }
}
