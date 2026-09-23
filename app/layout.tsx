import type { Metadata, Viewport } from "next";
import "./globals.css";

/** Telas de abertura do iPhone: um PNG por resolução de aparelho. */
const SPLASH_IPHONE = [
  { w: 375, h: 667, dpr: 2, png: "750x1334" }, // SE 2/3, 6/7/8
  { w: 414, h: 896, dpr: 2, png: "828x1792" }, // XR, 11
  { w: 375, h: 812, dpr: 3, png: "1125x2436" }, // X, XS, 11 Pro, 12/13 mini
  { w: 390, h: 844, dpr: 3, png: "1170x2532" }, // 12, 13, 14
  { w: 393, h: 852, dpr: 3, png: "1179x2556" }, // 14 Pro, 15, 16
  { w: 402, h: 874, dpr: 3, png: "1206x2622" }, // 16 Pro
  { w: 414, h: 896, dpr: 3, png: "1242x2688" }, // XS Max, 11 Pro Max
  { w: 430, h: 932, dpr: 3, png: "1290x2796" }, // 14 Pro Max, 15/16 Plus
  { w: 440, h: 956, dpr: 3, png: "1320x2868" }, // 16 Pro Max
].map((d) => ({
  url: `/splash/splash-${d.png}.png`,
  media:
    `(device-width: ${d.w}px) and (device-height: ${d.h}px) ` +
    `and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)`,
}));

export const metadata: Metadata = {
  title: "Notas Fiscais — Dimitry",
  description: "Registro de notas fiscais de compras com cartão",
  // PWA: instalável na tela inicial (iPhone usa estas metas próprias)
  appleWebApp: {
    capable: true,
    title: "Notas Dimitry",
    // a barra de status (relógio/bateria) fica sobre o azul do app
    statusBarStyle: "black-translucent",
    startupImage: SPLASH_IPHONE,
  },
  icons: {
    icon: "/icons/icone-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1e3a8a",
  // o conteúdo pode ocupar a área do notch (compensada no CSS com safe-area)
  viewportFit: "cover",
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
