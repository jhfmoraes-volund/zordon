import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono, Cormorant_Garamond } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/contexts/theme-context";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme/bootstrap";
import { DEFAULT_THEME_ID } from "@/lib/theme/themes";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`dark ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${cormorant.variable} h-full antialiased`}
      data-theme={DEFAULT_THEME_ID}
    >
      <head>
        {/* Anti-FOUC: lê tema salvo e seta data-theme antes do CSS aplicar. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-full flex">
        <ThemeProvider initialTheme={DEFAULT_THEME_ID}>
          {children}
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
