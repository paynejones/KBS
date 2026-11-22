import type { Metadata } from "next";
import Script from "next/script";
import { RootFailureProbe } from "@/components/root-failure-probe";
import { themeInitializationScript } from "@/lib/theme";
import "./globals.css";

const themeInitialization = themeInitializationScript();

export const metadata: Metadata = {
  title: "Knowledge Base",
  description: "A focused workspace for notes, pages, and structured data.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/*
         * `next/font` used to preload these. The local `@font-face` files are
         * only requested once the stylesheet applies, which leaves the first
         * paint on the fallback; fonts load in CORS mode, so the preload
         * carries `crossorigin`.
         */}
        <link
          rel="preload"
          href="/fonts/geist-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/geist-mono-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <RootFailureProbe />
        {children}
        <Script id="kbs-theme-init" strategy="beforeInteractive">
          {themeInitialization}
        </Script>
      </body>
    </html>
  );
}
