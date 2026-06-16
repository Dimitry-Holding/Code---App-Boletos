# 📄 Escáner de Boletos

App web (usable desde el celular) para **escanear boletos y notas fiscais brasileñas**,
extraer sus datos con IA (Google Gemini, gratis), resumirlos en una **tabla Excel** y generar un
**nombre de archivo estandarizado** fácil de clasificar después en **Nibo**.

## ¿Qué hace hoy (la base)?

1. Tomás una foto del boleto desde el celular.
2. Google Gemini (visión) lee el documento y extrae: fornecedor, CNPJ/CPF, valor, vencimiento,
   nº de documento, linha digitável, descripción y una categoría (elegida de tu lista fija).
3. Revisás/corregís los datos y lo guardás en la tabla.
4. Exportás todo a **Excel** y descargás cada foto **renombrada**
   (ej: `2026-06-10_TELEFONICA_R$150-00_NF12345.jpg`).

Los boletos guardados quedan en el navegador (localStorage).

## Requisitos

- Node.js 18+ (tenés la 24, perfecto)
- Una API key **gratuita** de Google Gemini (sin tarjeta de crédito): https://aistudio.google.com/apikey

## Cómo correrla localmente

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar la clave
#    Copiá .env.local.example a .env.local y poné tu GEMINI_API_KEY
copy .env.local.example .env.local   # (en PowerShell)

# 3. Arrancar
npm run dev
```

Abrí http://localhost:3000

### Probar desde el celular (misma red WiFi)

`npm run dev` muestra una URL "Network" (ej: `http://192.168.x.x:3000`).
Abrí esa dirección en el navegador del celular estando en el mismo WiFi.

## Desplegar en la nube (para usar desde cualquier lugar)

La forma más simple es **Vercel** (gratis para empezar):

1. Subí el proyecto a un repositorio de GitHub.
2. Importalo en https://vercel.com
3. En *Settings → Environment Variables* agregá `GEMINI_API_KEY`.
4. Deploy. Te queda una URL `https://...vercel.app` que abrís desde cualquier celular.

## Costo

Usa el **nivel gratuito de Google Gemini** (`gemini-2.5-flash`). Sin tarjeta de crédito.
Tiene límites de uso por minuto/día, suficientes para escanear decenas de boletos por día.

> ⚠️ **Privacidad:** el nivel gratuito de Gemini puede usar los datos enviados para mejorar
> el servicio. Para documentos fiscales suele ser aceptable; si necesitás privacidad total,
> habría que pasar a un plan pago o a OCR local.

## Próximos pasos (no incluidos todavía)

- Subida automática del Excel y las fotos a Google Drive / OneDrive.
- Formato de importación directo a Nibo.
- Base de datos en la nube para no depender del navegador.

## Estructura

```
app/
  page.tsx              UI principal (cámara, revisión, tabla, export)
  layout.tsx            Layout y metadata
  globals.css           Estilos mobile-first
  api/extract/route.ts  Llama a Claude (visión) para extraer datos
lib/
  boleto.ts             Esquema de datos, nombres de archivo y columnas del Excel
```
