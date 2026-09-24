export interface Flashcard {
  id: string;
  created_at: string;
  word: string;
  preposition: string | null;
  meaning: string;
  example_sentence: string;
  repetitions: number;
  interval: number;
  ease_factor: number;
  next_review_date: string;
  // --- Öğrenme motoru alanları (migration_2_learning_engine.sql) ---
  // Eski kayıtlarda bu alanlar DB'de default değerle gelir; olası bir
  // eski/cache'lenmiş kayıt durumunda kod tarafında da güvenli fallback var.
  correct_count?: number;
  incorrect_count?: number;
  struggle_count?: number;
  is_weak?: boolean;
  last_reviewed_at?: string | null;
  // --- SM-2 Geçiş Sistemi (migration_6_learning_phase.sql) ---
  in_learning_phase?: boolean;
  learning_streak?: number;
  hint_word?: string | null;
  synonyms?: string | null;
  // --- Eş Anlamlı Gruplar (migration_7_word_groups.sql) ---
  group_id?: string | null;
}

export interface WordGroup {
  id: string;
  name: string;
  created_at: string;
}

// Gemini'nin döndürdüğü ham JSON satırı (henüz DB'ye kaydedilmemiş)
export interface ExtractedWord {
  word: string;
  preposition: string;
  meaning: string;
  example_sentence: string;
  hint_word?: string;
  synonyms?: string | string[];
}

// --- SM-2 ---
// 1 = Unuttum (Again), 2 = Zorlandım (Hard), 3 = Hatırladım (Good), 5 = Çok kolaydı (Easy)
// NOT: 1/3/5 formülleri ORİJİNAL SM-2 mantığıyla birebir aynı, değiştirilmedi.
// "2" (Zorlandım) katmanı, kullanıcının kelimeyi zorlanarak da olsa doğru
// hatırladığı ama SM-2 formülünün özünü (interval * ease_factor büyümesi,
// min ease_factor 1.3) bozmadan daha yavaş ilerlemesini sağlayan katkısal
// bir ek katmandır — mevcut 1/3/5 davranışı hiçbir şekilde değişmedi.
export type SM2Rating = 1 | 2 | 3 | 5;

export interface SM2Result {
  repetitions: number;
  interval: number;
  ease_factor: number;
  next_review_date: string; // ISO string
}

// --- Öğrenme Motoru ---

// Kelimenin hafızadaki ilerleme aşaması (repetitions/interval'dan türetilir, DB'de tutulmaz)
export type LearningStage =
  | "new" // Yeni
  | "learning" // Öğreniliyor
  | "consolidating" // Pekişiyor
  | "long_term"; // Uzun süreli hafıza

// Kartın "şu an" durumu (next_review_date + is_weak'ten türetilir)
export type CardStatus = "new" | "due" | "overdue" | "weak" | "strong";

// Kullanıcının kendi kendine yaptığı değerlendirme (serbest yazı YOK)
export type SelfAssessment = "forgot" | "struggled" | "recalled" | "easy";

// Soru motorunun üretebileceği soru tipleri
export type QuestionType =
  | "recall" // Kelimeyi gör, zihinden hatırla, cevabı göster (temel akış)
  | "mcq_fr_to_tr" // İngilizce kelime → doğru Türkçe anlamı seç
  | "mcq_tr_to_fr" // Türkçe anlam → doğru İngilizce kelimeyi seç
  | "fill_blank" // Örnek cümlede boşluk doldurma (çoktan seçmeli)
  | "synonym"; // Aynı gruptaki eş anlamlı kelimeyi seç

export interface StudyQuestion {
  type: QuestionType;
  card: Flashcard;
  options?: string[]; // mcq_* ve fill_blank için seçenekler (doğru cevap da içinde)
  correctAnswer?: string; // mcq_* ve fill_blank için doğru seçenek metni
  blankedSentence?: string; // fill_blank için kelimenin ______ ile değiştirildiği cümle
}

export interface DailyPackage {
  dueCards: Flashcard[];
  overdueCards: Flashcard[];
  weakCards: Flashcard[];
  newCards: Flashcard[];
  totalCount: number;
}
