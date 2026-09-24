import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/ThemeProvider";
import FloatingControls from "@/components/FloatingControls";
import VisitBeacon from "@/components/VisitBeacon";
import BottomNav from "@/components/BottomNav";

const sans = Manrope({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

const display = Fraunces({
  subsets: ["latin", "latin-ext"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Flashcard | Anki Klonu",
  description: "Fotoğraftan İngilizce kelime çıkaran, SM-2 aralıklı tekrar destekli flashcard uygulaması",
};

const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('quizanki:theme');
    var theme = stored === 'dark' || stored === 'light'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${sans.className} text-slate-900 antialiased dark:text-slate-50`}>
        <ThemeProvider>
          <VisitBeacon />
          <FloatingControls />
          {children}
          <BottomNav />
        </ThemeProvider>
      </body>
    </html>
  );
}
