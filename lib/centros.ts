/**
 * LISTA FIJA DE CENTROS DE COSTO.
 *
 * 👉 Reemplazá con TUS centros de costo reales de Dimitry.
 *    El conductor elige uno de esta lista al cargar cada nota.
 */
export const CENTROS_CUSTO = [
  "Frota / Veículos",
  "Manutenção",
  "Administrativo",
  "Operações",
  "Logística",
  "Comercial",
  "Outros",
] as const;

export type CentroCusto = (typeof CENTROS_CUSTO)[number];
