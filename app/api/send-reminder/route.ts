import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase";
import { buildDailyPackage } from "@/lib/studyEngine";
import { Flashcard } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Bu endpoint Vercel Cron tarafından her gün belirli bir saatte tetiklenir
 * (bkz. vercel.json). Günlük çalışma paketini hesaplar, paket boşsa mesaj
 * ATMAZ (kullanıcıyı gereksiz spam'lemez), doluysa Twilio üzerinden
 * WhatsApp mesajı gönderir.
 *
 * Güvenlik: Bu route herkese açık bir URL'dir. CRON_SECRET ile korunur —
 * sadece doğru secret'ı bilen istekler (Vercel Cron dahil) tetikleyebilir.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET ortam değişkeni tanımlı değil." },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Yetkisiz istek." }, { status: 401 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM; // örn: whatsapp:+14155238886
  const toNumber = process.env.REMINDER_WHATSAPP_TO; // örn: whatsapp:+905XXXXXXXXX

  if (!accountSid || !authToken || !fromNumber || !toNumber) {
    return NextResponse.json(
      {
        error:
          "Twilio ortam değişkenleri eksik (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, REMINDER_WHATSAPP_TO).",
      },
      { status: 500 }
    );
  }

  try {
    const supabaseAdmin = createServiceRoleClient();
    const { data, error } = await supabaseAdmin.from("flashcards").select("*");

    if (error || !data) {
      return NextResponse.json(
        { error: "Kelimeler okunamadı.", details: error?.message },
        { status: 500 }
      );
    }

    const cards = data as Flashcard[];
    const pkg = buildDailyPackage(cards);

    if (pkg.totalCount === 0) {
      return NextResponse.json({ sent: false, reason: "Bugün için paket boş." });
    }

    const message = buildReminderMessage(pkg);
    await sendWhatsAppMessage({ accountSid, authToken, fromNumber, toNumber, message });

    return NextResponse.json({ sent: true, package: summarize(pkg) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    console.error("send-reminder hata:", err);
    return NextResponse.json({ error: "Hatırlatıcı gönderilemedi.", details: message }, { status: 500 });
  }
}

function summarize(pkg: ReturnType<typeof buildDailyPackage>) {
  return {
    overdue: pkg.overdueCards.length,
    weak: pkg.weakCards.length,
    due: pkg.dueCards.length,
    fresh: pkg.newCards.length,
    total: pkg.totalCount,
  };
}

function buildReminderMessage(pkg: ReturnType<typeof buildDailyPackage>): string {
  const { overdue, weak, due, fresh, total } = summarize(pkg);
  const lines = ["📚 *Flashcard Hatırlatıcı*", ""];

  if (overdue > 0) lines.push(`⏰ ${overdue} kelimen gecikmiş durumda.`);
  if (weak > 0) lines.push(`🟠 ${weak} zayıf kelimen var.`);
  if (due > 0) lines.push(`🔁 ${due} kelimenin tekrar zamanı geldi.`);
  if (fresh > 0) lines.push(`🆕 ${fresh} yeni kelime seni bekliyor.`);

  lines.push("", `Toplam ${total} kelime — bugün tekrar ederek unutmayı engelleyebilirsin.`);

  return lines.join("\n");
}

async function sendWhatsAppMessage(params: {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  message: string;
}) {
  const { accountSid, authToken, fromNumber, toNumber, message } = params;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const body = new URLSearchParams({
    From: fromNumber,
    To: toNumber,
    Body: message,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twilio hata: ${response.status} - ${errorText}`);
  }
}
