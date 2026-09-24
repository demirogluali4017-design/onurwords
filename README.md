# Flashcard / Anki Klonu (İngilizce Sürüm)

Next.js 14 (App Router) + Tailwind CSS + Supabase + Gemini 2.5 Flash OCR ile geliştirilmiş,
fotoğraftan İngilizce kelime çıkaran ve SM-2 aralıklı tekrar algoritmasıyla çalışan flashcard uygulaması.

Bu proje, orijinal Fransızca "quizanki" projesinin **birebir aynı özelliklere sahip**, sadece
hedef dili İngilizce olan bir kopyasıdır.

## Özellikler

- Fotoğraftan kelime çıkarma (Gemini, sayfa sayfa, takılırsa keser)
- Manuel kelime ekleme ve JSON yedek
- SM-2 aralıklı tekrar ve öğrenme kutusu
- Kart, test, eşleştirme ve eş anlam oyunu
- İlerleme sayfası; zorlanılan kelimeye basınca anlam ve örnek cümle
- Alt menü ve ana sayfada değişen motive edici cümleler
- Sesli telaffuz (en-US) ve karanlık mod
- İsteğe bağlı öğlen / akşam hatırlatma maili
- Giriş ekranı yok. Site herkese açık kalır.

## Kurulum

```bash
npm install
cp .env.local.example .env.local
# .env.local dosyasını kendi Supabase ve Gemini anahtarlarınızla doldurun
```

## Supabase Kurulumu

1. [supabase.com](https://supabase.com) üzerinde **yeni ve boş** bir proje oluşturun
   (orijinal Fransızca projeyle AYNI Supabase projesini kullanmayın — veriler karışır).
2. SQL Editor'e girip `supabase/full_setup.sql` dosyasının TAMAMINI çalıştırın.
   Bu tek dosya, tüm tabloları (flashcards, word_groups, test_results, match_results,
   daily_activity, app_settings), indeksleri ve RLS politikalarını tek seferde kurar.
   Veritabanı zaten kurulduysa yalnızca şunu çalıştırın:

   ```sql
   alter table public.app_settings
     add column if not exists last_seen_at timestamp with time zone;
   ```
3. Project Settings > API sekmesinden:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

## Gemini API Anahtarı

[Google AI Studio](https://aistudio.google.com/apikey) üzerinden bir API anahtarı oluşturup
`GEMINI_API_KEY` değişkenine ekleyin. Kota dolarsa `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3` gibi
ek anahtarlar da eklenebilir (kod otomatik sırayla dener).

## Vercel'e Deploy

1. Bu klasörü **yeni ve ayrı** bir GitHub repository'sine yükleyin.
2. Vercel'de "Import Project" ile bağlayın.
3. `.env.local`'daki tüm değişkenleri Vercel Environment Variables'a ekleyin.
4. Deploy edin.

## Orijinal Fransızca projeden farklar

Sadece şu dosyalar dile özel içerik taşıyordu ve İngilizce'ye uyarlandı:
- `app/api/process-image/route.ts` — Gemini prompt'u (İngilizce kelime çıkarma, "sb/sth" edat notasyonu)
- `components/SpeakButton.tsx`, `app/settings/page.tsx` — TTS dili (`en-US`)
- UI'daki "Fransızca" metinleri → "İngilizce"

Geri kalan öğrenme motoru ve tablo yapısı aynıdır. Giriş menüsü eklenmedi.
