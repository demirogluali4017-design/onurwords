import { SupabaseClient } from "@supabase/supabase-js";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Bugünün aktivite satırını (varsa) günceller, yoksa oluşturur.
 * Sadece GERÇEK SM-2 tekrarlarında çağrılır (Öğren / Sıfırdan Öğren).
 * Kartlar/Test/Eşleştir modları SM-2'yi etkilemediği gibi streak'i de
 * etkilemez — bilinçli bir tasarım kararı.
 */
export async function logDailyActivity(
  supabase: SupabaseClient,
  { review = false, newWord = false }: { review?: boolean; newWord?: boolean }
) {
  const today = todayStr();

  const { data: existing } = await supabase
    .from("daily_activity")
    .select("*")
    .eq("activity_date", today)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("daily_activity")
      .update({
        reviews_done: existing.reviews_done + (review ? 1 : 0),
        new_words_done: existing.new_words_done + (newWord ? 1 : 0),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("daily_activity").insert({
      activity_date: today,
      reviews_done: review ? 1 : 0,
      new_words_done: newWord ? 1 : 0,
    });
  }
}

export interface StreakResult {
  current: number;
  longest: number;
}

/**
 * activeDates: reviews_done > 0 olan tüm günlerin 'YYYY-MM-DD' listesi.
 * "current": bugün veya dün aktivite varsa oradan geriye doğru sayılan
 * kesintisiz gün sayısı (bugün henüz çalışmadıysan streak hemen 0'a
 * düşmesin diye dünü de kabul eder).
 */
export function computeStreaks(activeDates: string[]): StreakResult {
  const daySet = new Set(activeDates);
  const sorted = [...daySet].sort();

  let longest = 0;
  let run = 0;
  let prev: string | null = null;

  for (const d of sorted) {
    if (prev && addDaysStr(prev, 1) === d) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = d;
  }

  const today = todayStr();
  const yesterday = addDaysStr(today, -1);
  const anchor = daySet.has(today) ? today : daySet.has(yesterday) ? yesterday : null;

  let current = 0;
  if (anchor) {
    let cursor = anchor;
    while (daySet.has(cursor)) {
      current += 1;
      cursor = addDaysStr(cursor, -1);
    }
  }

  return { current, longest };
}
