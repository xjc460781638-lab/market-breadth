import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "市场宽度 · 市场温度观察",
  description: "申万行业 MA20 宽度、全市场占比与250日历史观察。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
