"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  type Evento,
  type Cartao,
  type Categoria,
  type CentroCusto,
  type Extraccion,
  codigoId,
  labelCartao,
  dentroDePlazo,
} from "@/lib/evento";
import TopBar from "./TopBar";

type Estado = "inicio" | "procesando" | "revision" | "edicion";
type Borrador = Extraccion & { centro_custo: string };
type Captura = { dataUrl: string; mediaType: string; esPdf: boolean };

const MAX_PDF_BYTES = 3 * 1024 * 1024;

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const BORRADOR_VACIO: Borrador = {
  fornecedor: "",
  valor: 0,
  moeda: "BRL",
  data_documento: "",
  categoria: "",
  tipo_pagamento: "debito",
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
  const [captura, setCaptura] = useState<Captura | null>(null);
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [filtroCentro, setFiltroCentro] = useState("todos");
  const [editId, setEditId] = useState<number | null>(null);
  const [fotoEditUrl, setFotoEditUrl] = useState<string | null>(null);

  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const hoy = new Date();
  const [ano, setAno] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);

  useEffect(() => {
    cargarTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargarTodo() {
    const [{ data: evs }, { data: cs }, { data: cats }, { data: ccs }] =
      await Promise.all([
        supabase.from("eventos").select("*").order("id", { ascending: false }),
        supabase.from("cartoes").select("*").order("apelido"),
        supabase.from("categorias").select("*").order("nome"),
        supabase.from("centros_custo").select("*").order("nome"),
      ]);
    setEventos((evs as Evento[]) ?? []);
    setCartoes((cs as Cartao[]) ?? []);
    setCategorias((cats as Categoria[]) ?? []);
    setCentros((ccs as CentroCusto[]) ?? []);
  }

  const eventosFiltrados = eventos.filter((e) => {
    const d = new Date(e.data_documento || e.criado_em);
    if (d.getFullYear() !== ano || d.getMonth() + 1 !== mes) return false;
    if (filtroCentro !== "todos" && (e.centro_custo || "") !== filtroCentro)
      return false;
    return true;
  });
  const total = eventosFiltrados.reduce((s, e) => s + (Number(e.valor) || 0), 0);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await procesarArchivo(file);
    e.target.value = "";
  }

  async function procesarArchivo(file: File) {
    setError(null);
    setEditId(null);
    setEstado("procesando");
    try {
      let cap: Captura;
      if (file.type === "application/pdf") {
        if (file.size > MAX_PDF_BYTES) {
          throw new Error("PDF muito grande (máx. 3 MB). Tente uma foto ou um PDF menor.");
        }
        cap = { dataUrl: await leerComoDataUrl(file), mediaType: "application/pdf", esPdf: true };
      } else if (file.type.startsWith("image/")) {
        cap = { dataUrl: await redimensionar(file), mediaType: "image/jpeg", esPdf: false };
      } else {
        throw new Error("Formato não suportado. Use foto ou PDF.");
      }
      setCaptura(cap);

      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: cap.dataUrl.split(",")[1],
          mediaType: cap.mediaType,
          categorias: categorias.map((c) => c.nome),
        }),
      });
      const data = (await resp.json()) as Extraccion & { error?: string };
      if (!resp.ok) throw new Error(data.error || "Erro ao processar.");

      // La IA pre-selecciona la tarjeta si los 4 dígitos coinciden con una del usuario.
      const cartaoMatch = cartoes.find((c) => c.ultimos4 === data.ultimos4);
      setBorrador({
        ...BORRADOR_VACIO,
        ...data,
        ultimos4: cartaoMatch ? cartaoMatch.ultimos4 : "",
        categoria: categorias.some((c) => c.nome === data.categoria) ? data.categoria : "",
        // Centro de custo: por defecto el único (o vacío si tiene varios).
        centro_custo: centros.length === 1 ? centros[0].nome : "",
      });
      setEstado("revision");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setEstado("inicio");
      setCaptura(null);
    }
  }

  function actualizar<K extends keyof Borrador>(clave: K, valor: Borrador[K]) {
    setBorrador((b) => ({ ...b, [clave]: valor }));
  }

  function validar(): string | null {
    if (!borrador.centro_custo) return "Selecione o centro de custo.";
    if (!borrador.ultimos4) return "Selecione o cartão.";
    if (!borrador.categoria) return "Selecione a categoria.";
    return null;
  }

  async function guardar() {
    if (!captura) return;
    const v = validar();
    if (v) {
      setError(v);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const ext = captura.esPdf ? "pdf" : "jpg";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const blob = await (await fetch(captura.dataUrl)).blob();
      const up = await supabase.storage
        .from("notas")
        .upload(path, blob, { contentType: captura.mediaType });
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

      await cargarTodo();
      cancelar();
    } catch (e) {
      setError("Erro ao salvar: " + (e instanceof Error ? e.message : ""));
    } finally {
      setGuardando(false);
    }
  }

  async function abrirEdicion(ev: Evento) {
    setError(null);
    setEditId(ev.id);
    setBorrador({
      fornecedor: ev.fornecedor ?? "",
      valor: Number(ev.valor ?? 0),
      moeda: ev.moeda ?? "BRL",
      data_documento: ev.data_documento ?? "",
      categoria: ev.categoria ?? "",
      tipo_pagamento: (ev.tipo_pagamento === "credito" ? "credito" : "debito"),
      ultimos4: ev.ultimos4 ?? "",
      descricao: ev.descricao ?? "",
      confianca: (ev.confianca as Borrador["confianca"]) ?? "media",
      centro_custo: ev.centro_custo ?? "",
    });
    setFotoEditUrl(null);
    const { data } = await supabase.storage
      .from("notas")
      .createSignedUrl(ev.foto_path, 300);
    setFotoEditUrl(data?.signedUrl ?? null);
    setCaptura({
      dataUrl: "",
      mediaType: ev.foto_path.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
      esPdf: ev.foto_path.endsWith(".pdf"),
    });
    setEstado("edicion");
  }

  async function guardarEdicion() {
    if (editId == null) return;
    const v = validar();
    if (v) {
      setError(v);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const upd = await supabase
        .from("eventos")
        .update({
          fornecedor: borrador.fornecedor || null,
          valor: borrador.valor || null,
          moeda: borrador.moeda || "BRL",
          centro_custo: borrador.centro_custo,
          data_documento: borrador.data_documento || null,
          categoria: borrador.categoria,
          tipo_pagamento: borrador.tipo_pagamento,
          ultimos4: borrador.ultimos4 || null,
          descricao: borrador.descricao || null,
        })
        .eq("id", editId);
      if (upd.error) throw upd.error;
      await cargarTodo();
      cancelar();
    } catch (e) {
      setError("Erro ao salvar: " + (e instanceof Error ? e.message : ""));
    } finally {
      setGuardando(false);
    }
  }

  function cancelar() {
    setEstado("inicio");
    setCaptura(null);
    setBorrador(BORRADOR_VACIO);
    setEditId(null);
    setFotoEditUrl(null);
    setError(null);
  }

  async function eliminar(ev: Evento) {
    if (!confirm("Excluir esta nota? Esta ação não pode ser desfeita.")) return;
    await supabase.storage.from("notas").remove([ev.foto_path]);
    const { error } = await supabase.from("eventos").delete().eq("id", ev.id);
    if (error) {
      alert("Não foi possível excluir (talvez já passaram 30 dias).");
      return;
    }
    setEventos((prev) => prev.filter((e) => e.id !== ev.id));
  }

  const editando = estado === "edicion";
  const faltaAtribuir =
    cartoes.length === 0 || categorias.length === 0 || centros.length === 0;

  function previa() {
    if (editando) {
      if (!captura) return null;
      if (captura.esPdf || !fotoEditUrl) {
        return (
          <div className="pdf-box">
            <span style={{ fontSize: 38 }}>{captura.esPdf ? "📄" : "🖼️"}</span>
            <span>{captura.esPdf ? "PDF (original)" : "Foto original"}</span>
          </div>
        );
      }
      return <img src={fotoEditUrl} alt="nota" className="preview" />;
    }
    if (!captura) return null;
    if (captura.esPdf) {
      return (
        <div className="pdf-box">
          <span style={{ fontSize: 38 }}>📄</span>
          <span>PDF carregado</span>
        </div>
      );
    }
    return <img src={captura.dataUrl} alt="nota" className="preview" />;
  }

  return (
    <>
      <TopBar nome={nome} papel="Usuário" />
      <main className="wrap">
        {estado === "inicio" && (
          <div className="card">
            <strong>Nova nota fiscal</strong>
            {faltaAtribuir ? (
              <div className="error-box" style={{ marginTop: 10 }}>
                Sua conta ainda não tem cartões, categorias e/ou centro de custo
                atribuídos. Peça ao administrador.
              </div>
            ) : (
              <p className="note" style={{ marginTop: 4 }}>
                Escolha como carregar o documento:
              </p>
            )}
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 12 }}
              disabled={faltaAtribuir}
              onClick={() => camRef.current?.click()}
            >
              📷 Tirar foto
            </button>
            <button
              className="btn btn-light btn-block"
              style={{ marginTop: 10 }}
              disabled={faltaAtribuir}
              onClick={() => galRef.current?.click()}
            >
              🖼️ Carregar da galeria
            </button>
            <button
              className="btn btn-light btn-block"
              style={{ marginTop: 10 }}
              disabled={faltaAtribuir}
              onClick={() => pdfRef.current?.click()}
            >
              📄 Carregar PDF
            </button>

            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={alElegir} />
            <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={alElegir} />
            <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={alElegir} />

            {error && <div className="error-box">{error}</div>}
          </div>
        )}

        {estado === "procesando" && (
          <div className="card">
            {previa()}
            <div className="status">
              <div className="spinner" />
              <div>Lendo o documento com IA…</div>
            </div>
          </div>
        )}

        {(estado === "revision" || estado === "edicion") && (
          <div className="card">
            {previa()}
            <div className="row" style={{ marginTop: 12 }}>
              <strong>{editando ? "Editar nota" : "Revisar e salvar"}</strong>
              {!editando && (
                <>
                  <span className="spacer" />
                  <span className={`badge ${borrador.confianca}`}>
                    Confiança: {borrador.confianca}
                  </span>
                </>
              )}
            </div>

            <div className="field">
              <label>Fornecedor</label>
              <input value={borrador.fornecedor} onChange={(e) => actualizar("fornecedor", e.target.value)} />
            </div>

            <div className="grid-2">
              <div className="field">
                <label>Valor</label>
                <input
                  type="number"
                  step="0.01"
                  value={borrador.valor}
                  onChange={(e) => actualizar("valor", parseFloat(e.target.value) || 0)}
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
                {centros.map((c) => (
                  <option key={c.id} value={c.nome}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Cartão *</label>
              <select value={borrador.ultimos4} onChange={(e) => actualizar("ultimos4", e.target.value)}>
                <option value="">— Selecione —</option>
                {cartoes.map((c) => (
                  <option key={c.id} value={c.ultimos4}>
                    {labelCartao(c)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Categoria *</label>
              <select value={borrador.categoria} onChange={(e) => actualizar("categoria", e.target.value)}>
                <option value="">— Selecione —</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.nome}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Pagamento</label>
              <select
                value={borrador.tipo_pagamento}
                onChange={(e) => actualizar("tipo_pagamento", e.target.value as Borrador["tipo_pagamento"])}
              >
                <option value="debito">Débito</option>
                <option value="credito">Crédito</option>
              </select>
            </div>

            <div className="field">
              <label>Descrição</label>
              <textarea value={borrador.descricao} onChange={(e) => actualizar("descricao", e.target.value)} />
            </div>

            {error && <div className="error-box">{error}</div>}

            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn btn-light" onClick={cancelar}>
                Cancelar
              </button>
              <span className="spacer" />
              <button
                className="btn btn-primary"
                onClick={editando ? guardarEdicion : guardar}
                disabled={guardando}
              >
                {guardando ? "Salvando…" : editando ? "Salvar alterações" : "Salvar"}
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
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Ano</label>
              <select value={ano} onChange={(e) => setAno(Number(e.target.value))}>
                {[ano + 1, ano, ano - 1, ano - 2].map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Centro de custo</label>
              <select
                value={filtroCentro}
                onChange={(e) => setFiltroCentro(e.target.value)}
              >
                <option value="todos">Todos</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.nome}>
                    {c.nome}
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
            eventosFiltrados.map((ev) => {
              const editavel = dentroDePlazo(ev.criado_em);
              return (
                <div key={ev.id} className="evento">
                  <div className="top">
                    <span className="fornecedor">{ev.fornecedor || "(sem fornecedor)"}</span>
                    <span className="valor">R$ {Number(ev.valor ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="meta">
                    <span className="codigo">{codigoId(ev.id)}</span>{" "}
                    {ev.data_documento || "sem data"} · {ev.centro_custo || "—"} ·{" "}
                    {ev.categoria || "—"} · {ev.ultimos4 ? `••${ev.ultimos4}` : "—"}
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <span className="spacer" />
                    {editavel ? (
                      <>
                        <button className="btn-ghost" onClick={() => abrirEdicion(ev)}>
                          ✏️ Editar
                        </button>
                        <button className="btn-danger-ghost" onClick={() => eliminar(ev)}>
                          🗑️ Excluir
                        </button>
                      </>
                    ) : (
                      <span className="note" style={{ margin: 0 }}>
                        Bloqueada (mais de 30 dias)
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </>
  );
}

function leerComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

async function redimensionar(file: File, maxDim = 1600, calidad = 0.8): Promise<string> {
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
