import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  Manrope,
  IBM_Plex_Sans,
  IBM_Plex_Mono,
  Archivo,
  Source_Sans_3,
  JetBrains_Mono,
  Barlow_Condensed,
  Barlow,
  Sora,
  DM_Sans,
  DM_Mono,
  Fraunces,
  Nunito_Sans,
  Fira_Mono,
} from "next/font/google";
import { Toaster } from "sonner";
import { THEME_COOKIE, asTheme } from "@/lib/theme";
import "./globals.css";

// One trio per theme (display, body, mono). All are declared so a theme
// switch needs no reload; the browser only downloads the three in use.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--font-source-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow-condensed" });
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm-mono" });
const fraunces = Fraunces({ subsets: ["latin"], axes: ["opsz"], variable: "--font-fraunces" });
const nunitoSans = Nunito_Sans({ subsets: ["latin"], variable: "--font-nunito-sans" });
const firaMono = Fira_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-fira-mono" });

const fontVars = [
  manrope, plexSans, plexMono,
  archivo, sourceSans, jetbrainsMono,
  barlowCondensed, barlow,
  sora, dmSans, dmMono,
  fraunces, nunitoSans, firaMono,
].map((f) => f.variable).join(" ");

export const metadata: Metadata = {
  title: "Astrobiz Dashboard",
  description: "Employee dashboard for Astrobiz",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = asTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${fontVars} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
        <Toaster position="bottom-right" theme="system" />
      </body>
    </html>
  );
}
