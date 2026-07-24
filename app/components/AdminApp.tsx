"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";
import {
  type Evento,
  codigoId,
  nomeArquivoPdf,
  valorBRL,
  COLUNAS_EXCEL,
  TIPO_PAGAMENTO_LABEL,
} from "@/lib/evento";
import TopBar from "./TopBar";

type Perfil = { id: string; nome: string };

function isoHoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoPrimeiroDiaMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function AdminApp({
  nome,
  podeGerenciar = true,
}: {
  nome: string;
  podeGerenciar?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [perfiles, setPerfiles] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);

  const [inicio, setInicio] = useState(isoPrimeiroDiaMes());
  const [fim, setFim] = useState(isoHoje());
  const [usuario, setUsuario] = useState("todos");
  const [tdc, setTdc] = useState("todos");
  const [centro, setCentro] = useState("todos");
  const [categoria, setCategoria] = useState("todos");
  const [busca, setBusca] = useState("");
  const [baixando, setBaixando] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());

  useEffect(() => {
    (async () => {
      const [{ data: evs }, { data: profs }] = await Promise.all([
        supabase.from("eventos").select("*").order("id", { ascending: false }),
        supabase.from("profiles").select("id, nome"),
      ]);
      setEventos((evs as Evento[]) ?? []);
      const mapa: Record<string, string> = {};
      ((profs as Perfil[]) ?? []).forEach((p) => (mapa[p.id] = p.nome));
      setPerfiles(mapa);
      setCargando(false);
    })();
  }, [supabase]);

  const usuariosEnDatos = useMemo(() => {
    const ids = Array.from(new Set(eventos.map((e) => e.conductor_id)));
    return ids.map((id) => ({ id, nome: perfiles[id] ?? id.slice(0, 8) }));
  }, [eventos, perfiles]);

  const tarjetas = useMemo(
    () =>
      Array.from(
        new Set(eventos.map((e) => e.ultimos4).filter((x): x is string => !!x)),
      ).sort(),
    [eventos],
  );

  const centrosEnDatos = useMemo(
    () =>
      Array.from(
        new Set(eventos.map((e) => e.centro_custo).filter((x): x is string => !!x)),
      ).sort(),
    [eventos],
  );

  const categoriasEnDatos = useMemo(
    () =>
      Array.from(
        new Set(eventos.map((e) => e.categoria).filter((x): x is string => !!x)),
      ).sort(),
    [eventos],
  );

  const filtrados = eventos.filter((e) => {
    const dia = (e.data_documento || e.criado_em || "").slice(0, 10);
    if (inicio && dia < inicio) return false;
    if (fim && dia > fim) return false;
    if (usuario !== "todos" && e.conductor_id !== usuario) return false;
    if (tdc !== "todos" && (e.ultimos4 || "") !== tdc) return false;
    if (centro !== "todos" && (e.centro_custo || "") !== centro) return false;
    if (categoria !== "todos" && (e.categoria || "") !== categoria) return false;
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      const forn = (e.fornecedor || "").toLowerCase();
      const val = String(e.valor ?? "") + " " + valorBRL(e).toFixed(2);
      if (!forn.includes(q) && !val.includes(q)) return false;
    }
    return true;
  });

  const total = filtrados.reduce((s, e) => s + valorBRL(e), 0);

  // --- Ordenar por columna ---
  function valorOrden(e: Evento, col: string): string | number {
    switch (col) {
      case "id": return e.id;
      case "valor": return valorBRL(e);
      case "data": return e.data_documento || "";
      case "fornecedor": return (e.fornecedor || "").toLowerCase();
      case "centro": return (e.centro_custo || "").toLowerCase();
      case "categoria": return (e.categoria || "").toLowerCase();
      case "pagamento": return e.tipo_pagamento || "";
      case "cartao": return e.ultimos4 || "";
      case "usuario": return (perfiles[e.conductor_id] || "").toLowerCase();
      default: return "";
    }
  }
  const ordenados = ordem
    ? [...filtrados].sort((a, b) => {
        const va = valorOrden(a, ordem.col);
        const vb = valorOrden(b, ordem.col);
        if (va < vb) return -ordem.dir;
        if (va > vb) return ordem.dir;
        return 0;
      })
    : filtrados;
  function ordenarPor(col: string) {
    setOrdem((o) =>
      o && o.col === col
        ? { col, dir: (o.dir === 1 ? -1 : 1) as 1 | -1 }
        : { col, dir: 1 },
    );
  }
  function renderTh(col: string, label: string) {
    const activo = ordem?.col === col;
    return (
      <th
        onClick={() => ordenarPor(col)}
        style={{ cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}
      >
        {label}
        {activo ? (ordem?.dir === 1 ? " ▲" : " ▼") : " ↕"}
      </th>
    );
  }

  // --- Selección de filas ---
  const selecionadasList = filtrados.filter((e) => selecionados.has(e.id));
  const idsVisiveis = filtrados.map((e) => e.id);
  const todasSel =
    idsVisiveis.length > 0 && idsVisiveis.every((id) => selecionados.has(id));
  function toggleSel(id: number) {
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleTodas() {
    setSelecionados((s) => {
      const n = new Set(s);
      if (todasSel) idsVisiveis.forEach((id) => n.delete(id));
      else idsVisiveis.forEach((id) => n.add(id));
      return n;
    });
  }

  function exportarExcel() {
    if (filtrados.length === 0) return;
    const filas = filtrados.map((e) => {
      const conNome = { ...e, conductor_nome: perfiles[e.conductor_id] ?? "" };
      const fila: Record<string, string | number> = {};
      COLUNAS_EXCEL.forEach((c) => (fila[c.titulo] = c.valor(conNome)));
      return fila;
    });
    const ws = XLSX.utils.json_to_sheet(filas, {
      header: COLUNAS_EXCEL.map((c) => c.titulo),
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Notas");
    XLSX.writeFile(wb, `notas_${inicio}_a_${fim}.xlsx`);
  }

  async function verFoto(path: string) {
    const { data, error } = await supabase.storage
      .from("notas")
      .createSignedUrl(path, 120);
    if (error || !data) {
      alert("Não foi possível abrir a foto.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  function descargarBlob(blob: Blob, nome: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Devuelve el archivo SIEMPRE como PDF: si ya es PDF, lo deja igual; si es
   * una foto (JPG), la convierte a un PDF de 1 página (la imagen entera dentro).
   */
  async function comoPdf(ev: Evento, blob: Blob): Promise<Blob> {
    if (ev.foto_path.toLowerCase().endsWith(".pdf")) return blob;
    return imagemBlobParaPdf(blob);
  }

  /** Descarga una foto (convertida a PDF). */
  async function baixarFoto(ev: Evento) {
    const { data, error } = await supabase.storage
      .from("notas")
      .download(ev.foto_path);
    if (error || !data) {
      alert("Não foi possível baixar a foto.");
      return;
    }
    try {
      const pdf = await comoPdf(ev, data);
      descargarBlob(pdf, nomeArquivoPdf(ev));
    } catch {
      alert("Não foi possível gerar o PDF.");
    }
  }

  /** Descarga en un único ZIP todas las notas, cada una como PDF. */
  async function baixarZip(lista: Evento[], nomeArquivo: string) {
    if (lista.length === 0) return;
    setBaixando(`0/${lista.length}`);
    try {
      const zip = new JSZip();
      // JSZip guarda las fechas en UTC; compensamos para que el archivo
      // extraído muestre la hora local correcta (y no "del futuro").
      const dataLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
      const usados = new Set<string>();
      let i = 0;
      for (const ev of lista) {
        i++;
        setBaixando(`${i}/${lista.length}`);
        const { data } = await supabase.storage.from("notas").download(ev.foto_path);
        if (!data) continue;
        const pdf = await comoPdf(ev, data);
        let nome = nomeArquivoPdf(ev);
        if (usados.has(nome)) {
          const punto = nome.lastIndexOf(".");
          nome = `${nome.slice(0, punto)}-${ev.id}${nome.slice(punto)}`;
        }
        usados.add(nome);
        zip.file(nome, pdf, { date: dataLocal });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      descargarBlob(blob, nomeArquivo);
    } catch {
      alert("Erro ao gerar o ZIP.");
    } finally {
      setBaixando(null);
    }
  }

  /** Borra una nota (y su foto). Solo el admin. */
  async function eliminar(ev: Evento) {
    if (!confirm(`Excluir ${codigoId(ev.id)} (${ev.fornecedor ?? ""})?`)) return;
    // La foto puede estar compartida con la línea de IOF: solo se borra del
    // Storage cuando ninguna otra nota la usa.
    const { count } = await supabase
      .from("eventos")
      .select("id", { count: "exact", head: true })
      .eq("foto_path", ev.foto_path)
      .neq("id", ev.id);
    if (!count) {
      await supabase.storage.from("notas").remove([ev.foto_path]);
    }
    const { error } = await supabase.from("eventos").delete().eq("id", ev.id);
    if (error) {
      alert("Não foi possível excluir.");
      return;
    }
    setEventos((prev) => prev.filter((x) => x.id !== ev.id));
  }

  return (
    <>
      <TopBar nome={nome} papel={podeGerenciar ? "Administrador" : "Supervisor"} />
      <main className="wrap wrap-wide">
        <div className="section-title" style={{ flexWrap: "wrap", rowGap: 8 }}>
          <span>Notas fiscais</span>
          <span className="count">{filtrados.length}</span>
          <span className="spacer" />
          {podeGerenciar && (
            <Link href="/usuarios" className="btn btn-light">
              👥 Usuários
            </Link>
          )}
          {selecionadasList.length > 0 && (
            <button
              className="btn btn-light"
              onClick={() => baixarZip(selecionadasList, "pdfs_selecionadas.zip")}
              disabled={baixando !== null}
            >
              📄 Selecionadas ({selecionadasList.length})
            </button>
          )}
          <button
            className="btn btn-light"
            onClick={() => baixarZip(filtrados, `pdfs_${inicio}_a_${fim}.zip`)}
            disabled={filtrados.length === 0 || baixando !== null}
          >
            {baixando ? `📄 ${baixando}…` : "📄 PDFs (ZIP)"}
          </button>
          <button
            className="btn btn-primary"
            onClick={exportarExcel}
            disabled={filtrados.length === 0}
          >
            ⬇️ Excel
          </button>
        </div>

        <div className="card">
          <div className="filters">
            <div className="field">
              <label>De</label>
              <input
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Até</label>
              <input
                type="date"
                value={fim}
                onChange={(e) => setFim(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Usuário</label>
              <select value={usuario} onChange={(e) => setUsuario(e.target.value)}>
                <option value="todos">Todos</option>
                {usuariosEnDatos.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Cartão (TDC)</label>
              <select value={tdc} onChange={(e) => setTdc(e.target.value)}>
                <option value="todos">Todos</option>
                {tarjetas.map((t) => (
                  <option key={t} value={t}>
                    ••{t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Centro de custo</label>
              <select value={centro} onChange={(e) => setCentro(e.target.value)}>
                <option value="todos">Todos</option>
                {centrosEnDatos.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Categoria</label>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="todos">Todas</option>
                {categoriasEnDatos.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label>🔎 Buscar (fornecedor ou valor)</label>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="ex: LAVANDERIA  ou  200,45"
            />
          </div>

          <p className="note" style={{ marginBottom: 2 }}>
            Período: <strong>{inicio || "—"}</strong> a <strong>{fim || "—"}</strong>
          </p>
          <p style={{ fontSize: 16, fontWeight: 700, color: "var(--primary)", margin: "2px 0 6px" }}>
            Subtotal: R$ {total.toFixed(2)}{" "}
            <span className="note" style={{ margin: 0, fontWeight: 400 }}>
              ({filtrados.length} nota{filtrados.length === 1 ? "" : "s"})
            </span>
          </p>

          {cargando ? (
            <div className="status">
              <div className="spinner" />
              <div>Carregando…</div>
            </div>
          ) : filtrados.length === 0 ? (
            <p className="note">Nenhuma nota neste período.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>
                      <input
                        type="checkbox"
                        checked={todasSel}
                        onChange={toggleTodas}
                        title="Selecionar tudo"
                      />
                    </th>
                    {renderTh("id", "ID")}
                    {renderTh("data", "Data")}
                    {renderTh("fornecedor", "Fornecedor")}
                    {renderTh("valor", "Valor (R$)")}
                    {renderTh("centro", "Centro de custo")}
                    {renderTh("categoria", "Categoria")}
                    {renderTh("pagamento", "Pagamento")}
                    {renderTh("cartao", "Cartão")}
                    {renderTh("usuario", "Usuário")}
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenados.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selecionados.has(e.id)}
                          onChange={() => toggleSel(e.id)}
                        />
                      </td>
                      <td className="codigo">{codigoId(e.id)}</td>
                      <td>{e.data_documento || "—"}</td>
                      <td>{e.fornecedor || "—"}</td>
                      <td className="num">
                        {valorBRL(e).toFixed(2)}
                        {e.moeda && e.moeda !== "BRL" && (
                          <div className="note" style={{ margin: 0, whiteSpace: "nowrap" }}>
                            {e.moeda} {Number(e.valor ?? 0).toFixed(2)}
                          </div>
                        )}
                      </td>
                      <td>{e.centro_custo || "—"}</td>
                      <td>{e.categoria || "—"}</td>
                      <td>
                        {TIPO_PAGAMENTO_LABEL[e.tipo_pagamento ?? ""] ?? "—"}
                      </td>
                      <td>{e.ultimos4 ? `••${e.ultimos4}` : "—"}</td>
                      <td>{perfiles[e.conductor_id] ?? "—"}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <button className="btn-ghost" onClick={() => verFoto(e.foto_path)}>
                            👁️
                          </button>
                          <button className="btn-ghost" onClick={() => baixarFoto(e)}>
                            ⬇️
                          </button>
                          {podeGerenciar && (
                            <button className="btn-danger-ghost" onClick={() => eliminar(e)}>
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="note">
          O Excel inclui todas as colunas (com descrição e nome do arquivo da foto).
          O ID vincula cada linha com sua foto.
        </p>
      </main>
    </>
  );
}

/**
 * Converte uma imagem (blob JPG) em um PDF de 1 página, com a página do
 * tamanho exato da foto (sem margens nem distorção). Roda no navegador.
 * O jsPDF é carregado sob demanda (só quando se baixa algo).
 */
async function imagemBlobParaPdf(blob: Blob): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Falha ao ler a imagem."));
    fr.readAsDataURL(blob);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Falha ao carregar a imagem."));
    im.src = dataUrl;
  });
  const w = img.naturalWidth || 1240;
  const h = img.naturalHeight || 1754;
  const pdf = new jsPDF({
    orientation: w >= h ? "landscape" : "portrait",
    unit: "px",
    format: [w, h],
  });
  pdf.addImage(dataUrl, "JPEG", 0, 0, w, h);
  return pdf.output("blob");
}
