import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase";
import { buildDailyPackage } from "@/lib/studyEngine";
import { Flashcard } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Vercel Cron, Türkiye saatiyle iki kez çağırır (vercel.json, UTC):
 * öğlen 12:00 ve akşam 16:00.
 * Öğlen e-postası her gün gider. Akşam e-postası yalnızca o gün siteye
 * hiç girilmemişse gider. WhatsApp yalnızca öğlen, paket doluysa gider.
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
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM;
  const toNumber = process.env.REMINDER_WHATSAPP_TO;
  const whatsappReady = Boolean(accountSid && authToken && fromNumber && toNumber);

  const resendKey = process.env.RESEND_API_KEY;
  const emailTo = process.env.REMINDER_EMAIL_TO;
  const emailFrom = process.env.REMINDER_EMAIL_FROM;
  const emailReady = Boolean(resendKey && emailTo && emailFrom);

  if (!whatsappReady && !emailReady) {
    return NextResponse.json(
      {
        error:
          "Hatırlatma kanalı yok. WhatsApp için Twilio değişkenleri ya da e-posta için RESEND_API_KEY, REMINDER_EMAIL_FROM ve REMINDER_EMAIL_TO gerekli.",
      },
      { status: 500 }
    );
  }

  const slot = request.nextUrl.searchParams.get("when") === "evening" ? "evening" : "noon";

  try {
    const supabaseAdmin = createServiceRoleClient();

    if (slot === "evening") {
      if (!emailReady) {
        return NextResponse.json({ sent: false, reason: "Akşam hatırlatması yalnızca e-posta ile gider." });
      }
      if (await visitedToday(supabaseAdmin)) {
        return NextResponse.json({ sent: false, reason: "Bugün giriş yapılmış." });
      }
    }

    const { data, error } = await supabaseAdmin.from("flashcards").select("*");

    if (error || !data) {
      return NextResponse.json(
        { error: "Kelimeler okunamadı.", details: error?.message },
        { status: 500 }
      );
    }

    const cards = data as Flashcard[];
    const pkg = buildDailyPackage(cards);
    const email = buildEmail(pkg, slot);

    if (slot === "noon" && whatsappReady && pkg.totalCount > 0) {
      await sendWhatsAppMessage({
        accountSid: accountSid as string,
        authToken: authToken as string,
        fromNumber: fromNumber as string,
        toNumber: toNumber as string,
        message: buildReminderMessage(pkg),
      });
    }

    if (emailReady) {
      await sendEmail({
        apiKey: resendKey as string,
        from: emailFrom as string,
        to: emailTo as string,
        subject: email.subject,
        text: email.text,
      });
    }

    return NextResponse.json({
      sent: emailReady || (slot === "noon" && whatsappReady && pkg.totalCount > 0),
      slot,
      whatsapp: slot === "noon" && whatsappReady && pkg.totalCount > 0,
      email: emailReady,
      package: summarize(pkg),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    console.error("send-reminder hata:", err);
    return NextResponse.json({ error: "Hatırlatıcı gönderilemedi.", details: message }, { status: 500 });
  }
}

export async function POST() {
  const resendKey = process.env.RESEND_API_KEY;
  const emailTo = process.env.REMINDER_EMAIL_TO;
  const emailFrom = process.env.REMINDER_EMAIL_FROM;
  if (!resendKey || !emailTo || !emailFrom) {
    return NextResponse.json(
      { error: "E-posta ayarı eksik. RESEND_API_KEY, REMINDER_EMAIL_FROM ve REMINDER_EMAIL_TO gerekli." },
      { status: 500 }
    );
  }

  try {
    const supabaseAdmin = createServiceRoleClient();
    const { data, error } = await supabaseAdmin.from("flashcards").select("*");
    if (error || !data) {
      return NextResponse.json({ error: "Kelimeler okunamadı.", details: error?.message }, { status: 500 });
    }
    const email = buildEmail(buildDailyPackage(data as Flashcard[]), "noon");
    await sendEmail({
      apiKey: resendKey,
      from: emailFrom,
      to: emailTo,
      subject: `Deneme: ${email.subject}`,
      text: email.text,
    });
    return NextResponse.json({ sent: true, to: emailTo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 500 });
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

function istanbulDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(date);
}

function istanbulDayStart(date = new Date()): Date {
  return new Date(`${istanbulDate(date)}T00:00:00+03:00`);
}

function dayIndex(date = new Date()): number {
  const start = Date.UTC(2026, 0, 1);
  return Math.floor((date.getTime() - start) / 86400000);
}

async function visitedToday(supabase: ReturnType<typeof createServiceRoleClient>): Promise<boolean> {
  const start = istanbulDayStart();

  const seen = await supabase.from("app_settings").select("last_seen_at").eq("id", 1).maybeSingle();
  const lastSeen = (seen.data as { last_seen_at?: string | null } | null)?.last_seen_at;
  if (!seen.error && lastSeen && new Date(lastSeen) >= start) return true;

  const activity = await supabase
    .from("daily_activity")
    .select("reviews_done, new_words_done")
    .eq("activity_date", istanbulDate())
    .maybeSingle();
  if (
    activity.data &&
    ((activity.data.reviews_done ?? 0) > 0 || (activity.data.new_words_done ?? 0) > 0)
  ) {
    return true;
  }

  const reviewed = await supabase
    .from("flashcards")
    .select("id")
    .gte("last_reviewed_at", start.toISOString())
    .limit(1);
  if (reviewed.data && reviewed.data.length > 0) return true;

  const ownerRow = await supabase.from("app_owner").select("email").eq("id", 1).maybeSingle();
  const email = (ownerRow.data?.email || process.env.REMINDER_EMAIL_TO || "").toLowerCase();
  if (!email) return false;
  const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = listed.data?.users?.find((item) => item.email?.toLowerCase() === email);
  return Boolean(user?.last_sign_in_at && new Date(user.last_sign_in_at) >= start);
}

const NOON_LETTERS = [
  {
    subject: "Azim, bugün de masada",
    lead: "Azim bir günde tükenmez. Kararlılık, dün oturduğun yere bugün de oturmaktır. İstikrar ise bunu kimse alkışlamazken sürdürmektir.",
  },
  {
    subject: "Küçük tur, büyük istikrar",
    lead: "Büyük sıçrama beklemene gerek yok. İstikrar, her öğlen aynı kapıdan içeri girmektir. Azmin sesi gürültülü değildir; sadece vazgeçmez.",
  },
  {
    subject: "Kararlılık bir duygu değil",
    lead: "Kararlılık, canın istemese de başladığın işe dönmektir. Azim o dönüşü taşır. İstikrar, bu dönüşü yarına da bırakır.",
  },
  {
    subject: "Bugünün payı sende",
    lead: "Kelime bir günde yerleşmez. Azim onu tekrar tekrar çağırır. Kararlılık bahane üretmez. İstikrar, takvimi yırtmadan ilerler.",
  },
  {
    subject: "Hadi, bir tur daha",
    lead: "Güçlenmek bağırarak olmaz. Azimle açarsın, kararlılıkla bitirirsin, istikrarla yarın yine buradasındır.",
  },
  {
    subject: "Öğrenmek bir yürüyüş",
    lead: "Hızlı olan değil, yürüyüşü bırakmayan ilerler. Azim adımı atar. Kararlılık yönü şaşırmaz. İstikrar yolu uzatır.",
  },
  {
    subject: "Bugün de sözünde kal",
    lead: "Kendine verdiğin söz, başkasına verilenden daha sessizdir. Azim onu hatırlar. Kararlılık onu tutar. İstikrar onu alışkanlık yapar.",
  },
  {
    subject: "Masan hazır",
    lead: "Dağınık bir günün ortasında bile kısa bir tur yeter. Azim bahaneyi ezer. Kararlılık süreyi ayırır. İstikrar bunu sıradanlaştırır.",
  },
];

const EVENING_LETTERS = [
  {
    subject: "Gün bitmeden bir tur",
    lead: "Öğlen haber vermiştim. Henüz içeri girmedin. Kararlılık, kaçan saati akşama bırakıp yine de gelmektir.",
  },
  {
    subject: "İstikrar bu akşam da duruyor",
    lead: "Bugün kapıyı açmadın. Azim kırılmaz; ertelenir, sonra geri çağrılır. İstikrar, boş geçen günü boş bırakmamaktır.",
  },
  {
    subject: "On dakika, sözünü tutar",
    lead: "Akşam yorgunluğu bahanedir. Kararlılık kısa bir turla da ayakta kalır. Azim, bitmemiş günü kapatmadan önce bir adım daha ister.",
  },
  {
    subject: "Bugün henüz sen yoksun",
    lead: "Giriş yok, tekrar yok. İstikrar tam da böyle günlerde belli olur. Azim sesini yükseltmez. Sadece beklemeyi bırakmanı ister.",
  },
  {
    subject: "Kararlılık geç kalmayı affeder",
    lead: "Öğlen kaçtıysa akşam hâlâ senindir. Azim saat tutmaz, dönüşü tutar. İstikrar, günü sıfır yazmadan kapatır.",
  },
  {
    subject: "Hadi, günü boş geçirme",
    lead: "Bir gün atlamak zinciri inceltir. Kararlılık o inceliği görür ve döner. Azimle aç, istikrarla kapat.",
  },
];

function buildEmail(pkg: ReturnType<typeof buildDailyPackage>, slot: "noon" | "evening") {
  const { overdue, weak, due, fresh, total } = summarize(pkg);
  const letters = slot === "evening" ? EVENING_LETTERS : NOON_LETTERS;
  const letter = letters[Math.abs(dayIndex()) % letters.length];
  const lines = [letter.lead, ""];
  if (total > 0) {
    lines.push(`Bugünkü paket ${total} kelime.`);
    if (overdue > 0) lines.push(`${overdue} tanesi gecikmiş. Onlar azmini ölçer.`);
    if (weak > 0) lines.push(`${weak} tanesi hâlâ zayıf. Kararlılık onları bırakmaz.`);
    if (due > 0) lines.push(`${due} tanesinin vakti bugün.`);
    if (fresh > 0) lines.push(`${fresh} yeni kelime, istikrarın yeni halkası.`);
  } else {
    lines.push("Bugün zorunlu paket boş. Yine de kısa bir tur, istikrarı canlı tutar.");
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL || "";
  lines.push("", "Hadi güçlenelim.", site);
  return { subject: letter.subject, text: lines.join("\n") };
}

async function sendEmail(params: { apiKey: string; from: string; to: string; subject: string; text: string }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      text: params.text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`E-posta hata: ${response.status} - ${errorText}`);
  }
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
