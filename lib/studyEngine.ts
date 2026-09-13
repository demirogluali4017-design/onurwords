import {
  CardStatus,
  DailyPackage,
  Flashcard,
  LearningStage,
  QuestionType,
  SelfAssessment,
  SM2Rating,
  StudyQuestion,
} from "@/types";

// ============================================================
// 1) ÖZ-DEĞERLENDİRME → SM-2 RATING EŞLEMESİ
// ============================================================
// Kullanıcıya asla serbest yazı yaptırmıyoruz (yazım hatası ölçüm
// hatasına yol açar). Bunun yerine 4 öz-değerlendirme seçeneği SM-2
// rating'ine eşlenir. SM-2'nin kendi formülleri (lib/sm2.ts) değişmedi.
export function mapAssessmentToRating(assessment: SelfAssessment): SM2Rating {
  switch (assessment) {
    case "forgot":
      return 1;
    case "struggled":
      return 2;
    case "recalled":
      return 3;
    case "easy":
      return 5;
  }
}

// ============================================================
// 2) ÖĞRENME AŞAMASI (Learning Stage) — DB'de tutulmaz, türetilir
// ============================================================
// NEW → LEARNING → CONSOLIDATING → LONG_TERM
// repetitions ve interval'a bakarak hesaplanır; SM-2 verisini
// okur ama hiçbir şekilde değiştirmez.
export function deriveLearningStage(card: Flashcard): LearningStage {
  if (card.repetitions === 0) return "new";
  if (card.repetitions <= 2 || card.interval < 7) return "learning";
  if (card.interval < 30) return "consolidating";
  return "long_term";
}

export const LEARNING_STAGE_LABELS: Record<LearningStage, string> = {
  new: "Yeni",
  learning: "Öğreniliyor",
  consolidating: "Pekişiyor",
  long_term: "Uzun Süreli Hafıza",
};

// ============================================================
// 3) KART DURUMU (Card Status) — DB'de tutulmaz, türetilir
// ============================================================
export function deriveCardStatus(card: Flashcard): CardStatus {
  const now = new Date();
  const nextReview = new Date(card.next_review_date);
  const isDue = nextReview <= now;

  if (card.is_weak) return "weak";
  if (card.repetitions === 0) return "new";
  if (!isDue) return "strong";

  const daysOverdue =
    (now.getTime() - nextReview.getTime()) / (1000 * 60 * 60 * 24);
  return daysOverdue > 2 ? "overdue" : "due";
}

export const CARD_STATUS_LABELS: Record<CardStatus, string> = {
  new: "Yeni",
  due: "Tekrar zamanı geldi",
  overdue: "Gecikmiş",
  weak: "Zayıf",
  strong: "Güçlü",
};

// ============================================================
// 4) ZAYIF KELİME TESPİTİ
// ============================================================
// Bir kart şu durumlarda "zayıf" işaretlenir:
// - incorrect_count, correct_count'tan belirgin şekilde fazlaysa
// - struggle_count (art arda "Zorlandım" seçimi) eşiği aşarsa
// - SM-2 intervali uzun süredir 1-2 günde takılı kalmışsa (ilerlemiyorsa)
const WEAK_INCORRECT_RATIO_THRESHOLD = 0.4; // %40+ yanlış oranı
const WEAK_STRUGGLE_THRESHOLD = 3;
const WEAK_STUCK_INTERVAL_DAYS = 2;
const WEAK_STUCK_MIN_REPETITIONS = 4;

export function shouldMarkAsWeak(card: Flashcard): boolean {
  const correct = card.correct_count ?? 0;
  const incorrect = card.incorrect_count ?? 0;
  const struggle = card.struggle_count ?? 0;
  const total = correct + incorrect;

  if (total >= 3 && incorrect / total >= WEAK_INCORRECT_RATIO_THRESHOLD) {
    return true;
  }
  if (struggle >= WEAK_STRUGGLE_THRESHOLD) {
    return true;
  }
  if (
    card.repetitions >= WEAK_STUCK_MIN_REPETITIONS &&
    card.interval <= WEAK_STUCK_INTERVAL_DAYS
  ) {
    return true;
  }
  return false;
}

/** Bir kartın zayıflık göstergelerini bir sonraki tekrar cevabına göre günceller. */
export function computeWeakWordUpdate(
  card: Flashcard,
  assessment: SelfAssessment
): {
  correct_count: number;
  incorrect_count: number;
  struggle_count: number;
  is_weak: boolean;
} {
  const correct_count = card.correct_count ?? 0;
  const incorrect_count = card.incorrect_count ?? 0;
  const struggle_count = card.struggle_count ?? 0;

  const isCorrectish = assessment !== "forgot";
  const nextCorrect = isCorrectish ? correct_count + 1 : correct_count;
  const nextIncorrect = !isCorrectish ? incorrect_count + 1 : incorrect_count;
  // "Hatırladım" veya "Çok kolaydı" struggle sayacını sıfırlar (art arda zorlanma bitti)
  const nextStruggle =
    assessment === "struggled"
      ? struggle_count + 1
      : assessment === "forgot"
        ? struggle_count // unutma struggle'ı artırmaz, kendi kriteriyle zaten yakalanır
        : 0;

  const updatedCard: Flashcard = {
    ...card,
    correct_count: nextCorrect,
    incorrect_count: nextIncorrect,
    struggle_count: nextStruggle,
  };

  // "Hatırladım"/"Çok kolaydı" ile struggle sıfırlandıysa ve yanlış sayısı
  // doğru sayısını geçmiyorsa zayıf etiketi kaldırılabilir; aksi halde
  // mevcut kriterlere göre (yeniden) değerlendirilir.
  const recovering =
    (assessment === "recalled" || assessment === "easy") &&
    nextStruggle === 0 &&
    nextIncorrect <= nextCorrect;

  const is_weak = recovering
    ? false
    : shouldMarkAsWeak(updatedCard) || ((card.is_weak ?? false) && !recovering);

  return {
    correct_count: nextCorrect,
    incorrect_count: nextIncorrect,
    struggle_count: nextStruggle,
    is_weak,
  };
}

// ============================================================
// 5) GÜNLÜK ÇALIŞMA PAKETİ
// ============================================================
// Sabit sayılar değil; kullanıcının mevcut zayıf kelime yüküne göre
// yeni kelime sayısı adaptif olarak azaltılır/artırılır.
const BASE_NEW_WORDS_PER_DAY = 8;
const MAX_DUE_PER_DAY = 40;

export function buildDailyPackage(allCards: Flashcard[]): DailyPackage {
  const reviewable = allCards.filter((c) => c.repetitions > 0 || c.is_weak);
  const newPool = allCards.filter((c) => c.repetitions === 0 && !c.is_weak);

  const overdueCards: Flashcard[] = [];
  const dueCards: Flashcard[] = [];
  const weakCards: Flashcard[] = [];

  for (const card of reviewable) {
    const status = deriveCardStatus(card);
    if (status === "weak") {
      weakCards.push(card);
    } else if (status === "overdue") {
      overdueCards.push(card);
    } else if (status === "due") {
      dueCards.push(card);
    }
  }

  // Kullanıcının zayıf kelime yükü fazlaysa yeni kelime sayısını azalt,
  // az/hiç zayıf kelimesi yoksa artır — aşırı yükleme yapmadan.
  let newWordBudget = BASE_NEW_WORDS_PER_DAY;
  if (weakCards.length >= 15) newWordBudget = 2;
  else if (weakCards.length >= 8) newWordBudget = 4;
  else if (weakCards.length === 0 && overdueCards.length === 0) {
    newWordBudget = BASE_NEW_WORDS_PER_DAY + 4;
  }

  const cappedDue = dueCards.slice(0, MAX_DUE_PER_DAY);
  const newCards = newPool.slice(0, newWordBudget);

  return {
    dueCards: cappedDue,
    overdueCards,
    weakCards,
    newCards,
    totalCount:
      cappedDue.length + overdueCards.length + weakCards.length + newCards.length,
  };
}

// ============================================================
// 6) INTERLEAVING — günlük paketi karışık sırayla diz
// ============================================================
// Basit ve etkili bir interleaving: önceliği (gecikmiş > zayıf > tekrar >
// yeni) koruyarak ama art arda aynı kategoriden kart gelmesini engelleyen
// bir "round-robin" karıştırma yapar. Kullanıcı bir önceki kartın
// bağlamından bir sonrakini tahmin edemesin diye kategoriler birbirine
// serpiştirilir.
export function interleaveDailyPackage(pkg: DailyPackage): Flashcard[] {
  const buckets = [
    shuffle(pkg.overdueCards),
    shuffle(pkg.weakCards),
    shuffle(pkg.dueCards),
    shuffle(pkg.newCards),
  ].filter((b) => b.length > 0);

  const result: Flashcard[] = [];
  let remaining = buckets.reduce((sum, b) => sum + b.length, 0);

  while (remaining > 0) {
    for (const bucket of buckets) {
      const next = bucket.shift();
      if (next) {
        result.push(next);
        remaining -= 1;
      }
    }
  }

  return result;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ============================================================
// 7) SORU MOTORU — kartın aşamasına göre soru tipi seç
// ============================================================
// SM-2 sadece "ne zaman"a karar verir; bu fonksiyon "nasıl"a karar verir.
// Aynı kelime sürekli aynı şekilde sorulmasın diye aşamaya göre bir
// olasılık dağılımından tip seçilir (tamamen deterministik değil).
export function pickQuestionType(card: Flashcard, poolSize: number): QuestionType {
  const stage = deriveLearningStage(card);

  // Havuzda yeterli kart yoksa (distractor üretilemez) her zaman recall kullan
  if (poolSize < 4) return "recall";

  const roll = Math.random();

  switch (stage) {
    case "new":
      // Yeni kelimede önce çıplak hatırlama + gösterme, tanıma sorusu ara sıra
      return roll < 0.7 ? "recall" : "mcq_fr_to_tr";

    case "learning":
      // Tanıma ağırlıklı, bazen ters yön
      if (roll < 0.45) return "mcq_fr_to_tr";
      if (roll < 0.7) return "recall";
      return "mcq_tr_to_fr";

    case "consolidating":
      // Aktif hatırlama ve bağlam ağırlıklı
      if (roll < 0.4) return "mcq_tr_to_fr";
      if (roll < 0.7 && card.example_sentence) return "fill_blank";
      return "recall";

    case "long_term":
      // Bağlam ağırlıklı — kalıcılığı bağlamla test et
      if (card.example_sentence && roll < 0.6) return "fill_blank";
      return "mcq_tr_to_fr";
  }
}

// ============================================================
// 8) DISTRACTOR ÜRETİMİ
// ============================================================
// Kelime + preposition testi: "word" alanı test edilirken, kelimenin
// preposition kalıbı varsa (örn. "à qn/qch") bu kalıp kelimeyle
// BİRLİKTE tek bir test edilebilir birim olarak kullanılır. Böylece
// kullanıcı doğru edatı bilmeden sadece kelimeyi tanıyarak testi
// geçemez.
export function getTestableWord(card: Flashcard): string {
  return card.preposition ? `${card.word} ${card.preposition}` : card.word;
}

// Tamamen rastgele değil: benzer kelime uzunluğu / aynı havuzdan seçim.
// Kullanıcının önceden karıştırdığı kelimeler (weak/struggle kayıtlı
// kartlar) varsa onlara öncelik verilir — böylece distractor'lar
// kullanıcının gerçekten karıştırma ihtimali olan kelimelerden seçilir.
export function buildDistractors(
  target: Flashcard,
  pool: Flashcard[],
  field: "meaning" | "word",
  count = 3,
  combinePreposition = true
): string[] {
  const candidates = pool.filter((c) => c.id !== target.id);

  const getValue = (c: Flashcard): string =>
    field === "word" ? (combinePreposition ? getTestableWord(c) : c.word) : c.meaning;

  const targetValue = getValue(target);
  const targetLen = targetValue.length;

  const scored = candidates
    .map((c) => {
      const value = getValue(c);
      const lenDiff = Math.abs(value.length - targetLen);
      const struggleBonus = (c.struggle_count ?? 0) + (c.is_weak ? 2 : 0);
      // Küçük uzunluk farkı ve yüksek struggle geçmişi = daha "makul" distractor
      const score = -lenDiff + struggleBonus * 2;
      return { value, score };
    })
    .sort((a, b) => b.score - a.score);

  const uniqueValues = new Set<string>();
  const results: string[] = [];

  for (const { value } of scored) {
    if (value && value !== targetValue && !uniqueValues.has(value)) {
      uniqueValues.add(value);
      results.push(value);
    }
    if (results.length >= count) break;
  }

  return results;
}

export function buildMcqOptions(
  target: Flashcard,
  pool: Flashcard[],
  field: "meaning" | "word",
  combinePreposition = true
): string[] {
  const targetValue =
    field === "word" ? (combinePreposition ? getTestableWord(target) : target.word) : target.meaning;
  const distractors = buildDistractors(target, pool, field, 3, combinePreposition);
  const options = shuffle([targetValue, ...distractors]);
  return options;
}

export function buildFillBlankQuestion(
  card: Flashcard,
  pool: Flashcard[]
): StudyQuestion | null {
  if (!card.example_sentence) return null;

  // Kelimeyi cümlede bul ve ______ ile değiştir (büyük/küçük harf duyarsız)
  const escaped = card.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "i");
  if (!regex.test(card.example_sentence)) return null;

  const blankedSentence = card.example_sentence.replace(regex, "______");
  const options = buildMcqOptions(card, pool, "word", false);

  return {
    type: "fill_blank",
    card,
    options,
    correctAnswer: card.word,
    blankedSentence,
  };
}

/** Bir kart için tam bir StudyQuestion nesnesi üretir (soru tipini de kendi seçer). */
export function buildQuestion(card: Flashcard, pool: Flashcard[]): StudyQuestion {
  // Kartın eş anlamlı grubu varsa, ara sıra (yaklaşık %25) doğrudan
  // grup testi sor — hafıza çapası mantığını pekiştirmek için.
  if (card.group_id && Math.random() < 0.25) {
    const synonymQuestion = buildSynonymQuestion(card, pool);
    if (synonymQuestion) return synonymQuestion;
  }

  const type = pickQuestionType(card, pool.length);

  if (type === "mcq_fr_to_tr") {
    return {
      type,
      card,
      options: buildMcqOptions(card, pool, "meaning"),
      correctAnswer: card.meaning,
    };
  }

  if (type === "mcq_tr_to_fr") {
    return {
      type,
      card,
      options: buildMcqOptions(card, pool, "word"),
      correctAnswer: getTestableWord(card),
    };
  }

  if (type === "fill_blank") {
    const fillBlank = buildFillBlankQuestion(card, pool);
    if (fillBlank) return fillBlank;
    // Cümle uygun değilse recall'a düş
    return { type: "recall", card };
  }

  return { type: "recall", card };
}

// ============================================================
// 9) TEST MODU — SM-2'yi hiç etkilemeyen, her zaman cevaplanabilir soru üretir
// ============================================================
// "Test" modu için: her zaman mcq_fr_to_tr / mcq_tr_to_fr / fill_blank
// döndürür, ASLA "recall" döndürmez (çünkü test modunda otomatik
// doğru/yanlış değerlendirmesi gerekiyor). Bu fonksiyon SM-2 durumuna
// bakmaz, sadece havuzdan rastgele bir tip seçer.
export function buildTestQuestion(card: Flashcard, pool: Flashcard[]): StudyQuestion {
  const candidateTypes: QuestionType[] = ["mcq_fr_to_tr", "mcq_tr_to_fr"];
  if (card.example_sentence) candidateTypes.push("fill_blank", "fill_blank"); // biraz daha olası yap
  if (card.group_id && getGroupSiblings(card, pool).length > 0) {
    candidateTypes.push("synonym", "synonym"); // grubu varsa biraz daha olası yap
  }

  const type = candidateTypes[Math.floor(Math.random() * candidateTypes.length)];

  if (type === "synonym") {
    const synonymQuestion = buildSynonymQuestion(card, pool);
    if (synonymQuestion) return synonymQuestion;
  }

  if (type === "fill_blank") {
    const fillBlank = buildFillBlankQuestion(card, pool);
    if (fillBlank) return fillBlank;
  }

  if (type === "mcq_tr_to_fr") {
    return {
      type,
      card,
      options: buildMcqOptions(card, pool, "word"),
      correctAnswer: getTestableWord(card),
    };
  }

  return {
    type: "mcq_fr_to_tr",
    card,
    options: buildMcqOptions(card, pool, "meaning"),
    correctAnswer: card.meaning,
  };
}

// ============================================================
// 10) EŞ ANLAMLI GRUP TESTİ
// ============================================================
// Amaç: kullanıcı bir kelimeyi unutsa bile, aynı gruptaki (group_id
// aynı) bildiği başka bir kelime hafıza çapası olarak devreye girsin.
// Bu yüzden distractor'lar özellikle FARKLI gruplardan/grupsuz
// kartlardan seçilir — doğru cevap her zaman AYNI gruptan bir kelime.

/** Bir kartın aynı gruptaki diğer üyelerini döndürür (kendisi hariç). */
export function getGroupSiblings(card: Flashcard, pool: Flashcard[]): Flashcard[] {
  if (!card.group_id) return [];
  return pool.filter((c) => c.id !== card.id && c.group_id === card.group_id);
}

/**
 * Eş anlamlı grup sorusu üretir. Kartın grubu yoksa veya grupta tek
 * başınaysa null döner (bu durumda çağıran taraf başka bir soru
 * tipine düşmeli).
 */
export function buildSynonymQuestion(card: Flashcard, pool: Flashcard[]): StudyQuestion | null {
  const siblings = getGroupSiblings(card, pool);
  if (siblings.length === 0) return null;

  const correctSibling = siblings[Math.floor(Math.random() * siblings.length)];
  const correctAnswer = getTestableWord(correctSibling);

  // Distractor'lar: FARKLI gruptan veya grupsuz kartlardan (aynı grubun
  // başka üyeleri distractor olarak KULLANILMAZ, çünkü onlar da doğru
  // sayılırdı — testin amacı grup ayrımını netleştirmek).
  const outsideGroup = pool.filter((c) => c.id !== card.id && c.group_id !== card.group_id);

  const distractors = shuffle(outsideGroup)
    .slice(0, 3)
    .map((c) => getTestableWord(c));

  const options = shuffle([correctAnswer, ...distractors]);

  return {
    type: "synonym",
    card,
    options,
    correctAnswer,
  };
}
