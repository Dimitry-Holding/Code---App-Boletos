import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Notas Fiscais — Dimitry",
  description: "Registro de notas fiscais de compras com cartão",
  // PWA: instalável na tela inicial (iPhone usa estas metas próprias)
  appleWebApp: {
    capable: true,
    title: "Notas Dimitry",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icone-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1e3a8a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
