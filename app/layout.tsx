import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ShiftGen — Shift Schedule Generator",
  description:
    "Kayan Sweets internal HR shift schedule generator. Upload employee lists and generate shift schedules.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {children}

        {/* xlsx-js-style (SheetJS fork with full cell styling) */}
        <Script
          src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"
          strategy="beforeInteractive"
        />
        {/* JSZip */}
        <Script
          src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
          strategy="beforeInteractive"
        />
        {/* FileSaver.js */}
        <Script
          src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"
          strategy="beforeInteractive"
        />
      </body>
    </html>
  );
}
