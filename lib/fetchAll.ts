/**
 * Supabase/PostgREST varsayılan olarak tek istekte en fazla 1000 satır
 * döndürür. Kelime sayısı bunu aştığında (ki bu uygulamada oldu — 1000+
 * kelime), .select("*") çağrıları sessizce eksik veri döndürür ve hem
 * sayaçlar hem de çalışma havuzu (distractor seçimi, günlük paket vb.)
 * yanlış hesaplanır.
 *
 * Bu fonksiyon, verilen sorguyu 1000'er satırlık sayfalar halinde
 * tekrar tekrar çalıştırarak TÜM satırları toplar. Herhangi bir
 * .select("*") çağrısının yerine bunu kullan.
 *
 * Kullanım:
 *   const cards = await fetchAllRows<Flashcard>((from, to) =>
 *     supabase.from("flashcards").select("*").range(from, to)
 *   );
 *   // filtreli:
 *   const newCards = await fetchAllRows<Flashcard>((from, to) =>
 *     supabase.from("flashcards").select("*").eq("in_learning_phase", true).range(from, to)
 *   );
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let all: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error || !data) break;

    all = all.concat(data);

    if (data.length < PAGE_SIZE) break; // son sayfaya ulaşıldı
    from += PAGE_SIZE;
  }

  return all;
}
