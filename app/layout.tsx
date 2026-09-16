import type { Metadata } from "next";
import { Archivo, JetBrains_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Display serif that echoes the banner wordmark; used sparingly for the app title.
const playfair = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const DESCRIPTION =
  "Ask about the World Scholar's Cup 2026 syllabus and get a short answer tied to the exact section it came from, or a clear 'not covered' when it isn't.";

export const metadata: Metadata = {
  metadataBase: new URL("https://wsc-syllabus-rag.vercel.app"),
  title: "Guiding Questions Assistant",
  description: DESCRIPTION,
  openGraph: {
    title: "Guiding Questions Assistant",
    description: DESCRIPTION,
    url: "https://wsc-syllabus-rag.vercel.app",
    siteName: "Guiding Questions Assistant",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Guiding Questions Assistant",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${archivo.variable} ${jetbrainsMono.variable} ${playfair.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
