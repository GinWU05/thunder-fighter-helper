import type { Metadata } from "next";
import { Noto_Sans_SC, Oxanium } from "next/font/google";
import "./globals.css";

const displayFont = Oxanium({
  weight: ["400", "600", "700"],
  variable: "--font-display",
  subsets: ["latin"],
});

const bodyFont = Noto_Sans_SC({
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "雷霆战机助手",
  description: "雷霆战机体力计算与规划工具。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${displayFont.variable} ${bodyFont.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
