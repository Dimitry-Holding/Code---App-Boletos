"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  type Boleto,
  type Registro,
  construirNombre,
  COLUMNAS_EXCEL,
} from "@/lib/boleto";
import { CATEGORIAS, CATEGORIA_DEFECTO } from "@/lib/categorias";

const STORAGE_KEY = "boletos_v1";

type Estado = "inicio" | "procesando" | "revision";

const BOLETO_VACIO: Boleto = {
  tipo: "boleto",
  fornecedor: "",
  cnpj_cpf: "",
  valor: 0,
  moeda: "BRL",
  data_emissao: "",
  data_vencimento: "",
  numero_documento: "",
  linha_digitavel: "",
  descricao: "",
  categoria_sugerida: CATEGORIA_DEFECTO,
  confianca: "media",
};

export default function Pagina() {
  const [estado, setEstado] = useState<Estado>("inicio");
  const [error, setError] = useState<string | null>(null);
  const [imagenActual, setImagenActual] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Boleto>(BOLETO_VACIO);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cargar registros guardados al iniciar.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setRegistros(JSON.parse(raw));
    } catch {
      /* ignorar */
    }
  }, []);

  // Persistir cada cambio.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(registros));
    } catch {
      setError(
        "El almacenamiento del navegador está lleno. Exportá el Excel y borrá algunos boletos.",
      );
    }
  }, [registros]);

  async function alElegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await procesarFoto(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function procesarFoto(file: File) {
    setError(null);
    setEstado("procesando");
    try {
      const { dataUrl } = await redimensionar(file);
      setImagenActual(dataUrl);

      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: dataUrl.split(",")[1],
          mediaType: "image/jpeg",
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Error al procesar.");

      setBorrador({ ...BOLETO_VACIO, ...data });
      setEstado("revision");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
      setEstado("inicio");
      setImagenActual(null);
    }
  }

  function guardar() {
    if (!imagenActual) return;
    const registro: Registro = {
      ...borrador,
      id: crypto.randomUUID(),
      imagen: imagenActual,
      nombreArchivo: construirNombre(borrador),
      procesadoEn: new Date().toISOString(),
    };
    setRegistros((prev) => [registro, ...prev]);
    cancelar();
  }

  function cancelar() {
    setEstado("inicio");
    setImagenActual(null);
    setBorrador(BOLETO_VACIO);
    setError(null);
  }

  function eliminar(id: string) {
    setRegistros((prev) => prev.filter((r) => r.id !== id));
  }

  function descargarRenombrado(r: Registro) {
    const a = document.createElement("a");
    a.href = r.imagen;
    a.download = r.nombreArchivo;
    a.click();
  }

  function exportarExcel() {
    if (registros.length === 0) return;
    const filas = registros.map((r) =>
      Object.fromEntries(
        COLUMNAS_EXCEL.map((c) => [c.titulo, r[c.clave] ?? ""]),
      ),
    );
    const ws = XLSX.utils.json_to_sheet(filas, {
      header: COLUMNAS_EXCEL.map((c) => c.titulo),
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Boletos");
    const hoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `boletos_${hoy}.xlsx`);
  }

  function actualizar<K extends keyof Boleto>(clave: K, valor: Boleto[K]) {
    setBorrador((b) => ({ ...b, [clave]: valor }));
  }

  const total = registros.reduce((s, r) => s + (Number(r.valor) || 0), 0);

  return (
    <main className="app">
      <header>
        <h1>📄 Escáner de Boletos</h1>
        <p>Fotografiá boletos y notas fiscais → resumen en Excel + nombre listo para Nibo.</p>
      </header>

      {estado === "inicio" && (
        <div className="card">
          <label className="capture-label">
            <span className="icon">📷</span>
            <strong>Tomar foto del boleto</strong>
            <span className="hint">Tocá para abrir la cámara o elegir una imagen</span>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden-input"
              onChange={alElegirFoto}
            />
          </label>
          {error && <div className="error-box">{error}</div>}
        </div>
      )}

      {estado === "procesando" && (
        <div className="card">
          {imagenActual && (
            <img src={imagenActual} alt="boleto" className="preview" />
          )}
          <div className="status">
            <div className="spinner" />
            <div>Leyendo el boleto con IA…</div>
          </div>
        </div>
      )}

      {estado === "revision" && (
        <div className="card">
          {imagenActual && (
            <img src={imagenActual} alt="boleto" className="preview" />
          )}

          <div className="row wrap" style={{ marginTop: 12 }}>
            <span className={`badge ${borrador.confianca}`}>
              Confianza: {borrador.confianca}
            </span>
            <span className="spacer" />
          </div>

          <div className="field">
            <label>Fornecedor</label>
            <input
              value={borrador.fornecedor}
              onChange={(e) => actualizar("fornecedor", e.target.value)}
            />
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Valor (R$)</label>
              <input
                type="number"
                step="0.01"
                value={borrador.valor}
                onChange={(e) =>
                  actualizar("valor", parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="field">
              <label>Tipo</label>
              <select
                value={borrador.tipo}
                onChange={(e) =>
                  actualizar("tipo", e.target.value as Boleto["tipo"])
                }
              >
                <option value="boleto">Boleto</option>
                <option value="nota_fiscal">Nota fiscal</option>
                <option value="cupom_fiscal">Cupom fiscal</option>
                <option value="recibo">Recibo</option>
                <option value="outro">Otro</option>
              </select>
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Vencimento</label>
              <input
                type="date"
                value={borrador.data_vencimento}
                onChange={(e) => actualizar("data_vencimento", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Emissão</label>
              <input
                type="date"
                value={borrador.data_emissao}
                onChange={(e) => actualizar("data_emissao", e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>CNPJ / CPF</label>
              <input
                value={borrador.cnpj_cpf}
                onChange={(e) => actualizar("cnpj_cpf", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Nº Documento</label>
              <input
                value={borrador.numero_documento}
                onChange={(e) =>
                  actualizar("numero_documento", e.target.value)
                }
              />
            </div>
          </div>

          <div className="field">
            <label>Categoria (para Nibo)</label>
            <select
              value={borrador.categoria_sugerida}
              onChange={(e) =>
                actualizar(
                  "categoria_sugerida",
                  e.target.value as Boleto["categoria_sugerida"],
                )
              }
            >
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Descrição</label>
            <textarea
              value={borrador.descricao}
              onChange={(e) => actualizar("descricao", e.target.value)}
            />
          </div>

          <div className="field">
            <label>Linha digitável (boleto)</label>
            <input
              value={borrador.linha_digitavel}
              onChange={(e) => actualizar("linha_digitavel", e.target.value)}
            />
          </div>

          <p className="note">
            Nombre del archivo: <strong>{construirNombre(borrador)}</strong>
          </p>

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn-secondary" onClick={cancelar}>
              Cancelar
            </button>
            <span className="spacer" />
            <button className="btn-primary" style={{ width: "auto" }} onClick={guardar}>
              Guardar en la tabla
            </button>
          </div>
        </div>
      )}

      <div className="section-title">
        <span>Boletos guardados</span>
        <span className="count">{registros.length}</span>
        <span className="spacer" />
        {registros.length > 0 && (
          <button className="btn-secondary" onClick={exportarExcel}>
            ⬇️ Excel
          </button>
        )}
      </div>

      {registros.length === 0 ? (
        <p className="note">Todavía no escaneaste ningún boleto.</p>
      ) : (
        <>
          <p className="note">
            Total acumulado: <strong>R$ {total.toFixed(2)}</strong>
          </p>
          <div className="card">
            {registros.map((r) => (
              <div key={r.id} className="registro">
                <div className="top">
                  <span className="fornecedor">
                    {r.fornecedor || "(sin fornecedor)"}
                  </span>
                  <span className="valor">R$ {Number(r.valor).toFixed(2)}</span>
                </div>
                <div className="meta">
                  {r.data_vencimento || r.data_emissao || "sin fecha"} ·{" "}
                  {r.categoria_sugerida || "sin categoría"}
                </div>
                <div className="archivo">{r.nombreArchivo}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="btn-ghost"
                    onClick={() => descargarRenombrado(r)}
                  >
                    ⬇️ Foto renombrada
                  </button>
                  <span className="spacer" />
                  <button className="btn-ghost" onClick={() => eliminar(r.id)}>
                    🗑️ Borrar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="note">
        Próximo paso: subir automáticamente el Excel y las fotos renombradas a Google
        Drive / OneDrive, y armar la importación a Nibo.
      </p>
    </main>
  );
}

/** Redimensiona y comprime una imagen para acelerar la subida y bajar el costo de IA. */
async function redimensionar(
  file: File,
  maxDim = 1600,
  calidad = 0.8,
): Promise<{ dataUrl: string }> {
  const img = await cargarImagen(file);
  const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * escala);
  const h = Math.round(img.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen.");
  ctx.drawImage(img, 0, 0, w, h);

  return { dataUrl: canvas.toDataURL("image/jpeg", calidad) };
}

function cargarImagen(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo cargar la imagen."));
    };
    img.src = url;
  });
}
