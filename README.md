# Flashcard / Anki Klonu (İngilizce Sürüm)

Next.js 14 (App Router) + Tailwind CSS + Supabase + Gemini 2.5 Flash OCR ile geliştirilmiş,
fotoğraftan İngilizce kelime çıkaran ve SM-2 aralıklı tekrar algoritmasıyla çalışan flashcard uygulaması.

Bu proje, orijinal Fransızca "quizanki" projesinin **birebir aynı özelliklere sahip**, sadece
hedef dili İngilizce olan bir kopyasıdır.

## Özellikler

- 📷 Fotoğraftan (tek veya çoklu, azami 3 sayfa) kelime çıkarma (Gemini)
- ✍️ Manuel kelime ekleme
- 🧠 SM-2 aralıklı tekrar + öz-değerlendirmeli (Unuttum/Zorlandım/Hatırladım/Çok kolaydı) çalışma modu
- 🌱 Sıfırdan Öğren modu + otomatik/manuel SM-2 geçiş sistemi (öğrenme kutusu)
- 🗂️ Kartlar (puansız gezinme), 📝 Test (puanlı sınav, rekor takibi), 🧩 Eşleştir (süreli oyun)
- 🔗 Eş anlamlı kelime grupları + grup testi
- 📈 İlerleme sayfası (streak, günlük hedef, aşama dağılımı, kelime bazlı detay)
- 🔊 Sesli telaffuz (Web Speech API, en-US)
- 🌙 Karanlık mod
- 📱 Mobil uyumlu, tüm veriler Supabase'te (localStorage değil — cihazlar arası senkron)

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

Geri kalan her şey (SM-2 algoritması, öğrenme motoru, veritabanı yapısı, tüm sayfalar) **birebir aynı**.
