import type { MetadataRoute } from "next";

/**
 * Manifesto do PWA: permite "instalar" o app na tela inicial do celular
 * (ícone da Dimitry, abre em tela cheia, sem barra do navegador).
 * O Next publica isto em /manifest.webmanifest e o linka sozinho no <head>.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Notas Fiscais — Dimitry",
    short_name: "Notas Dimitry",
    description: "Registro de notas fiscais de compras com cartão",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f1f5f9",
    theme_color: "#1e3a8a",
    icons: [
      { src: "/icons/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icone-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icone-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
