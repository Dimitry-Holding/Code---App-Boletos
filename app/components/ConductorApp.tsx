"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIAS, CATEGORIA_DEFECTO } from "@/lib/categorias";
import { CENTROS_CUSTO } from "@/lib/centros";
import {
  type Evento,
  type Extraccion,
  codigoId,
} from "@/lib/evento";
import TopBar from "./TopBar";

type Estado = "inicio" | "procesando" | "revision";
type Borrador = Extraccion & { centro_custo: string };

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const BORRADOR_VACIO: Borrador = {
  fornecedor: "",
  valor: 0,
  moeda: "BRL",
  data_documento: "",
  categoria: CATEGORIA_DEFECTO,
  tipo_pagamento: "outro",
  ultimos4: "",
  descricao: "",
  confianca: "media",
  centro_custo: "",
};

export default function ConductorApp({
  nome,
  userId,
}: {
  nome: string;
  userId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [estado, setEstado] = useState<Estado>("inicio");
  const [error, setError] = useState<string | null>(null);
  const [imagen, setImagen] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const hoy = new Date();
  const [ano, setAno] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1); // 1-12

  useEffect(() => {
    cargarEventos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargarEventos() {
    const { data } = await supabase
      .from("eventos")
      .select("*")
      .order("id", { ascending: false });
    setEventos((data as Evento[]) ?? []);
  }

  const eventosFiltrados = eventos.filter((e) => {
    const fecha = e.data_documento || e.criado_em;
    const d = new Date(fecha);
    return d.getFullYear() === ano && d.getMonth() + 1 === mes;
  });

  const total = eventosFiltrados.reduce((s, e) => s + (Number(e.valor) || 0), 0);

  async function alElegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await procesarFoto(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function procesarFoto(file: File) {
    setError(null);
    setEstado("procesando");
    try {
      const dataUrl = await redimensionar(file);
      setImagen(dataUrl);

      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: dataUrl.split(",")[1],
          mediaType: "image/jpeg",
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Erro ao processar.");

      setBorrador({ ...BORRADOR_VACIO, ...data, centro_custo: "" });
      setEstado("revision");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setEstado("inicio");
      setImagen(null);
    }
  }

  function actualizar<K extends keyof Borrador>(clave: K, valor: Borrador[K]) {
    setBorrador((b) => ({ ...b, [clave]: valor }));
  }

  async function guardar() {
    if (!imagen) return;
    if (!borrador.centro_custo) {
      setError("Selecione o centro de custo.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const blob = await (await fetch(imagen)).blob();
      const up = await supabase.storage
        .from("notas")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;

      const ins = await supabase.from("eventos").insert({
        conductor_id: userId,
        fornecedor: borrador.fornecedor || null,
        valor: borrador.valor || null,
        moeda: borrador.moeda || "BRL",
        centro_custo: borrador.centro_custo,
        data_documento: borrador.data_documento || null,
        categoria: borrador.categoria,
        tipo_pagamento: borrador.tipo_pagamento,
        ultimos4: borrador.ultimos4 || null,
        descricao: borrador.descricao || null,
        confianca: borrador.confianca,
        foto_path: path,
      });
      if (ins.error) throw ins.error;

      await cargarEventos();
      cancelar();
    } catch (e) {
      setError("Erro ao salvar: " + (e instanceof Error ? e.message : ""));
    } finally {
      setGuardando(false);
    }
  }

  function cancelar() {
    setEstado("inicio");
    setImagen(null);
    setBorrador(BORRADOR_VACIO);
    setError(null);
  }

  async function eliminar(ev: Evento) {
    if (!confirm("Excluir esta nota? Esta ação não pode ser desfeita.")) return;
    await supabase.storage.from("notas").remove([ev.foto_path]);
    await supabase.from("eventos").delete().eq("id", ev.id);
    setEventos((prev) => prev.filter((e) => e.id !== ev.id));
  }

  return (
    <>
      <TopBar nome={nome} papel="Condutor" />
      <main className="wrap">
        {estado === "inicio" && (
          <div className="card">
            <label className="capture">
              <span className="icon">📷</span>
              <strong>Fotografar nota fiscal</strong>
              <span className="hint">Toque para abrir a câmera</span>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={alElegirFoto}
              />
            </label>
            {error && <div className="error-box">{error}</div>}
          </div>
        )}

        {estado === "procesando" && (
          <div className="card">
            {imagen && <img src={imagen} alt="nota" className="preview" />}
            <div className="status">
              <div className="spinner" />
              <div>Lendo a nota com IA…</div>
            </div>
          </div>
        )}

        {estado === "revision" && (
          <div className="card">
            {imagen && <img src={imagen} alt="nota" className="preview" />}
            <div className="row" style={{ marginTop: 12 }}>
              <span className={`badge ${borrador.confianca}`}>
                Confiança: {borrador.confianca}
              </span>
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
                <label>Valor</label>
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
                <label>Data</label>
                <input
                  type="date"
                  value={borrador.data_documento}
                  onChange={(e) => actualizar("data_documento", e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label>Centro de custo *</label>
              <select
                value={borrador.centro_custo}
                onChange={(e) => actualizar("centro_custo", e.target.value)}
              >
                <option value="">— Selecione —</option>
                {CENTROS_CUSTO.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Categoria</label>
              <select
                value={borrador.categoria}
                onChange={(e) =>
                  actualizar(
                    "categoria",
                    e.target.value as Borrador["categoria"],
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

            <div className="grid-2">
              <div className="field">
                <label>Pagamento</label>
                <select
                  value={borrador.tipo_pagamento}
                  onChange={(e) =>
                    actualizar(
                      "tipo_pagamento",
                      e.target.value as Borrador["tipo_pagamento"],
                    )
                  }
                >
                  <option value="debito">Débito</option>
                  <option value="credito">Crédito</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div className="field">
                <label>Últimos 4 dígitos</label>
                <input
                  inputMode="numeric"
                  maxLength={4}
                  value={borrador.ultimos4}
                  onChange={(e) =>
                    actualizar("ultimos4", e.target.value.replace(/\D/g, ""))
                  }
                />
              </div>
            </div>

            <div className="field">
              <label>Descrição</label>
              <textarea
                value={borrador.descricao}
                onChange={(e) => actualizar("descricao", e.target.value)}
              />
            </div>

            {error && <div className="error-box">{error}</div>}

            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn btn-light" onClick={cancelar}>
                Cancelar
              </button>
              <span className="spacer" />
              <button
                className="btn btn-primary"
                onClick={guardar}
                disabled={guardando}
              >
                {guardando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        )}

        <div className="section-title">
          <span>Minhas notas</span>
          <span className="count">{eventosFiltrados.length}</span>
        </div>

        <div className="card">
          <div className="filters">
            <div className="field">
              <label>Mês</label>
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Ano</label>
              <select value={ano} onChange={(e) => setAno(Number(e.target.value))}>
                {[ano + 1, ano, ano - 1, ano - 2].map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="note">
            Total do período: <strong>R$ {total.toFixed(2)}</strong>
          </p>

          {eventosFiltrados.length === 0 ? (
            <p className="note">Nenhuma nota neste mês.</p>
          ) : (
            eventosFiltrados.map((ev) => (
              <div key={ev.id} className="evento">
                <div className="top">
                  <span className="fornecedor">
                    {ev.fornecedor || "(sem fornecedor)"}
                  </span>
                  <span className="valor">
                    R$ {Number(ev.valor ?? 0).toFixed(2)}
                  </span>
                </div>
                <div className="meta">
                  <span className="codigo">{codigoId(ev.id)}</span>{" "}
                  {ev.data_documento || "sem data"} · {ev.centro_custo || "—"} ·{" "}
                  {ev.categoria || "—"}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="spacer" />
                  <button
                    className="btn-danger-ghost"
                    onClick={() => eliminar(ev)}
                  >
                    🗑️ Excluir
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </>
  );
}

/** Redimensiona y comprime la imagen antes de subirla y enviarla a la IA. */
async function redimensionar(
  file: File,
  maxDim = 1600,
  calidad = 0.8,
): Promise<string> {
  const img = await cargarImagen(file);
  const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * escala);
  const h = Math.round(img.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem.");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", calidad);
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
      reject(new Error("Não foi possível carregar a imagem."));
    };
    img.src = url;
  });
}
