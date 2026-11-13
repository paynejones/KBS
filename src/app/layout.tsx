import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { RootFailureProbe } from "@/components/root-failure-probe";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const themeInitialization = `try {
  const theme = localStorage.getItem("kbs:theme");
  if (["light", "dark", "warm", "forest"].includes(theme)) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }
} catch {}`;

export const metadata: Metadata = {
  title: "Knowledge Base",
  description: "A focused workspace for notes, pages, and structured data.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <RootFailureProbe />
        {children}
        <Script id="kbs-theme-init" strategy="beforeInteractive">
          {themeInitialization}
        </Script>
      </body>
    </html>
  );
}
