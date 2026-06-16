import { z } from "zod";
import { CATEGORIAS } from "./categorias";

/**
 * Esquema de los datos que Claude extrae de cada boleto / nota fiscal.
 * Se usa tanto para validar la respuesta de la IA como para tipar la app.
 */
export const BoletoSchema = z.object({
  tipo: z.enum([
    "boleto",
    "nota_fiscal",
    "cupom_fiscal",
    "recibo",
    "outro",
  ]),
  fornecedor: z.string(),
  cnpj_cpf: z.string(),
  valor: z.number(),
  moeda: z.string(),
  data_emissao: z.string(),
  data_vencimento: z.string(),
  numero_documento: z.string(),
  linha_digitavel: z.string(),
  descricao: z.string(),
  categoria_sugerida: z.enum(CATEGORIAS),
  confianca: z.enum(["alta", "media", "baixa"]),
});

export type Boleto = z.infer<typeof BoletoSchema>;

/** Un boleto ya procesado y guardado en la tabla. */
export type Registro = Boleto & {
  id: string;
  /** Imagen redimensionada (data URL) para descargar/renombrar después. */
  imagen: string;
  /** Nombre de archivo sugerido para clasificar en Nibo. */
  nombreArchivo: string;
  /** Fecha de procesamiento (ISO). */
  procesadoEn: string;
};

/** Convierte texto a una forma segura para nombre de archivo. */
export function slug(texto: string, maxLen = 40): string {
  return texto
    .normalize("NFD") // separa los acentos de las letras base
    .replace(/[^a-zA-Z0-9]+/g, "-") // los acentos y símbolos quedan como "-"
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .toUpperCase();
}

/**
 * Construye un nombre de archivo fácil de ordenar y clasificar en Nibo.
 * Ej: 2026-06-10_TELEFONICA_R$150-00_NF12345.jpg
 */
export function construirNombre(b: Boleto, extension = "jpg"): string {
  const fecha = b.data_vencimento || b.data_emissao || "sin-fecha";
  const fornecedor = slug(b.fornecedor) || "FORNECEDOR";
  const valor =
    b.valor && b.valor > 0
      ? `R$${b.valor.toFixed(2).replace(".", "-")}`
      : "";
  const doc = b.numero_documento ? slug(b.numero_documento, 20) : "";

  const partes = [fecha, fornecedor, valor, doc].filter(Boolean);
  return `${partes.join("_")}.${extension}`;
}

/** Cabeceras del Excel resumen, en orden. */
export const COLUMNAS_EXCEL: { clave: keyof Registro; titulo: string }[] = [
  { clave: "data_vencimento", titulo: "Vencimento" },
  { clave: "data_emissao", titulo: "Emissão" },
  { clave: "fornecedor", titulo: "Fornecedor" },
  { clave: "cnpj_cpf", titulo: "CNPJ/CPF" },
  { clave: "tipo", titulo: "Tipo" },
  { clave: "numero_documento", titulo: "Nº Documento" },
  { clave: "valor", titulo: "Valor (R$)" },
  { clave: "categoria_sugerida", titulo: "Categoria (Nibo)" },
  { clave: "descricao", titulo: "Descrição" },
  { clave: "linha_digitavel", titulo: "Linha digitável" },
  { clave: "nombreArchivo", titulo: "Arquivo" },
  { clave: "confianca", titulo: "Confiança" },
];
