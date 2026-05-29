import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono, Cormorant_Garamond } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/contexts/theme-context";
import { readThemeCookie } from "@/lib/theme/server";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Volund — Zordon",
  description: "Gestão operacional para desenvolvimento agentico",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Zordon",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#dc2626",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Cookie lido no SSR → data-theme pintado na primeira resposta → zero FOUC.
  const initialTheme = await readThemeCookie();

  return (
    <html
      lang="pt-BR"
      className={`dark ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${cormorant.variable} h-full antialiased`}
      data-theme={initialTheme}
    >
      <body className="min-h-full flex">
        <ThemeProvider initialTheme={initialTheme}>
          {children}
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
