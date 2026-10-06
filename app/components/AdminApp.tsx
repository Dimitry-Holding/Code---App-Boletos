"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";
import {
  type Cartao,
  type Evento,
  codigoId,
  nomeArquivoPdf,
  valorBRL,
  COLUNAS_EXCEL,
  TIPO_PAGAMENTO_LABEL,
} from "@/lib/evento";
import { gerarWorkbookNibo } from "@/lib/nibo";
import { buscarEventos } from "@/lib/eventos-query";
import TopBar from "./TopBar";

type Perfil = { id: string; nome: string; role?: string };

/** Usuário que não consegue lançar notas por falta de cadastro. */
type SemConfig = { id: string; nome: string; faltam: string[]; jaUsava: boolean };

/** Linha da tabela de monitoramento `erros_app` (painel 🩺 Erros). */
type ErroApp = {
  id: number;
  criado_em: string;
  origem: string;
  mensagem: string;
  detalhe: string | null;
  user_id: string | null;
};

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
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [perfiles, setPerfiles] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  // troca de período: mantém a tabela anterior esmaecida até chegar a nova
  const [recarregando, setRecarregando] = useState(false);
  const [falhaNotas, setFalhaNotas] = useState<string | null>(null);

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
  // nota cuja observação (descrição) está aberta na tabela
  const [obsAberta, setObsAberta] = useState<number | null>(null);
  // painel de monitoramento de erros (🩺)
  const [verErros, setVerErros] = useState(false);
  const [erros, setErros] = useState<ErroApp[] | null>(null);
  const [errosFalha, setErrosFalha] = useState(false);
  // avisos que aparecem sem precisar abrir o painel
  const [errosTotal, setErrosTotal] = useState(0);
  const [semConfig, setSemConfig] = useState<SemConfig[]>([]);

  // Notas: só as do período escolhido, lidas em páginas (o Supabase corta
  // qualquer consulta em 1000 linhas). Recarrega quando as datas mudam.
  useEffect(() => {
    let cancelado = false;
    const t = setTimeout(async () => {
      setRecarregando(true);
      try {
        const evs = await buscarEventos<Evento>(supabase, { inicio, fim });
        if (cancelado) return;
        setEventos(evs);
        setFalhaNotas(null);
      } catch (err) {
        if (cancelado) return;
        setFalhaNotas(err instanceof Error ? err.message : "erro");
      } finally {
        if (!cancelado) {
          setCargando(false);
          setRecarregando(false);
        }
      }
    }, 350); // espera o usuário terminar de mexer na data
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [supabase, inicio, fim]);

  useEffect(() => {
    (async () => {
      const [{ data: profs }, { data: cts }] = await Promise.all([
        supabase.from("profiles").select("id, nome, role"),
        supabase.from("cartoes").select("*"),
      ]);
      setCartoes((cts as Cartao[]) ?? []);
      const mapa: Record<string, string> = {};
      ((profs as Perfil[]) ?? []).forEach((p) => (mapa[p.id] = p.nome));
      setPerfiles(mapa);

      if (!podeGerenciar) return;
      // Monitoramento (só admin): quantos erros há registrados e quais usuários
      // estão sem cartão/categoria/centro — sem isso o app deles não lança nota.
      const [{ data: cats }, { data: ccs }, { count }] = await Promise.all([
        supabase.from("categorias").select("user_id"),
        supabase.from("centros_custo").select("user_id"),
        supabase.from("erros_app").select("id", { count: "exact", head: true }),
      ]);
      setErrosTotal(count ?? 0);
      const tem = (lista: unknown, id: string) =>
        ((lista as { user_id: string }[]) ?? []).some((x) => x.user_id === id);
      const travados = ((profs as Perfil[]) ?? [])
        .filter((p) => p.role === "conductor")
        .map((p) => ({
          id: p.id,
          nome: p.nome,
          faltam: [
            tem(cts, p.id) ? "" : "cartão",
            tem(cats, p.id) ? "" : "categoria",
            tem(ccs, p.id) ? "" : "centro de custo",
          ].filter(Boolean),
        }))
        .filter((s) => s.faltam.length > 0);
      // "já usava o app" = tem alguma nota em qualquer data (não só no período)
      const comNotas = await Promise.all(
        travados.map((s) =>
          supabase
            .from("eventos")
            .select("id", { count: "exact", head: true })
            .eq("conductor_id", s.id),
        ),
      );
      setSemConfig(
        travados.map((s, i) => ({ ...s, jaUsava: (comNotas[i].count ?? 0) > 0 })),
      );
    })();
  }, [supabase, podeGerenciar]);

  // As opções dos filtros vêm das notas do período. O valor já escolhido entra
  // sempre na lista, para o filtro não "sumir" ao trocar para um período em
  // que ele não tem notas.
  const comEscolhido = (lista: (string | null)[], escolhido: string) =>
    Array.from(
      new Set(
        [...lista, escolhido === "todos" ? null : escolhido].filter(
          (x): x is string => !!x,
        ),
      ),
    );

  const usuariosEnDatos = useMemo(
    () =>
      comEscolhido(eventos.map((e) => e.conductor_id), usuario).map((id) => ({
        id,
        nome: perfiles[id] ?? id.slice(0, 8),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventos, perfiles, usuario],
  );

  const tarjetas = useMemo(
    () => comEscolhido(eventos.map((e) => e.ultimos4), tdc).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventos, tdc],
  );

  const centrosEnDatos = useMemo(
    () => comEscolhido(eventos.map((e) => e.centro_custo), centro).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventos, centro],
  );

  const categoriasEnDatos = useMemo(
    () => comEscolhido(eventos.map((e) => e.categoria), categoria).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventos, categoria],
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

  /** Excel no formato dos lançamentos do Nibo, para revisão antes do envio. */
  function exportarExcelNibo() {
    if (filtrados.length === 0) return;
    const wb = gerarWorkbookNibo(
      filtrados.map((e) => ({
        ...e,
        conductor_nome: perfiles[e.conductor_id] ?? "",
      })),
      cartoes,
    );
    XLSX.writeFile(wb, `nibo_lancamentos_${inicio}_a_${fim}.xlsx`);
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

  /** Abre/fecha o painel 🩺 Erros, recarregando a lista a cada abertura. */
  async function abrirErros() {
    if (verErros) {
      setVerErros(false);
      return;
    }
    setVerErros(true);
    setErros(null);
    const { data, error } = await supabase
      .from("erros_app")
      .select("*")
      .order("id", { ascending: false })
      .limit(50);
    if (error) {
      setErrosFalha(true);
      setErros([]);
      return;
    }
    setErrosFalha(false);
    setErros((data as ErroApp[]) ?? []);
  }

  async function limparErros() {
    if (!confirm("Apagar todos os erros registrados?")) return;
    await supabase.from("erros_app").delete().gte("id", 0);
    setErros([]);
    setErrosTotal(0);
  }

  // usuário que já lançava notas e ficou travado = aviso urgente no botão
  const travadoUrgente = semConfig.some((s) => s.jaUsava);

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
            <button
              className="btn btn-light"
              onClick={abrirErros}
              title="Erros registrados automaticamente pelo app"
            >
              🩺 Erros{errosTotal > 0 ? ` (${errosTotal})` : ""}
              {travadoUrgente ? " ⚠️" : ""}
            </button>
          )}
          {podeGerenciar && (
            <Link href="/dashboard" className="btn btn-light">
              📊 Dashboard
            </Link>
          )}
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
            className="btn btn-light"
            onClick={exportarExcelNibo}
            disabled={filtrados.length === 0}
            title="Excel no formato dos lançamentos do Nibo, para revisar antes de enviar"
          >
            🧾 Excel Nibo
          </button>
          <button
            className="btn btn-primary"
            onClick={exportarExcel}
            disabled={filtrados.length === 0}
          >
            ⬇️ Excel
          </button>
        </div>

        {verErros && (
          <div className="card">
            <div className="row">
              <strong>🩺 Erros registrados pelo app</strong>
              <span className="count">{erros?.length ?? 0}</span>
              <span className="spacer" />
              {erros !== null && erros.length > 0 && (
                <button className="btn-danger-ghost" onClick={limparErros}>
                  🗑️ Limpar
                </button>
              )}
            </div>
            {semConfig.length > 0 && (
              <div className="error-box" style={{ marginTop: 8 }}>
                <strong>Usuários que não conseguem lançar notas agora</strong>
                {semConfig.map((s) => (
                  <div key={s.id}>
                    {s.jaUsava ? "⚠️ " : ""}
                    {s.nome}: sem {s.faltam.join(", ")}
                    {s.jaUsava ? " (já usava o app)" : " (ainda sem notas)"}
                  </div>
                ))}
                <div className="note" style={{ margin: "4px 0 0" }}>
                  Corrija em 👥 Usuários.
                </div>
              </div>
            )}
            {errosFalha ? (
              <p className="note">
                Não foi possível carregar. A migração 6 (`supabase/migration_6.sql`)
                já foi aplicada no Supabase?
              </p>
            ) : erros === null ? (
              <div className="status">
                <div className="spinner" />
              </div>
            ) : erros.length === 0 ? (
              <p className="note">Nenhum erro registrado. 🎉</p>
            ) : (
              <div style={{ marginTop: 8, maxHeight: 340, overflowY: "auto" }}>
                {erros.map((er) => (
                  <div
                    key={er.id}
                    style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}
                  >
                    <div className="note" style={{ margin: 0 }}>
                      {new Date(er.criado_em).toLocaleString("pt-BR")} ·{" "}
                      {er.origem === "extract" ? "servidor/IA" : "celular do usuário"} ·{" "}
                      {er.user_id ? (perfiles[er.user_id] ?? "usuário") : "—"}
                    </div>
                    <div style={{ fontSize: 13.5 }}>{er.mensagem}</div>
                    {er.detalhe && (
                      <div
                        className="note"
                        style={{ margin: 0, fontSize: 11.5, wordBreak: "break-word" }}
                      >
                        {er.detalhe}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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

          {falhaNotas && (
            <div className="error-box">
              Não foi possível carregar as notas deste período ({falhaNotas}).
              A tabela abaixo pode estar desatualizada.
            </div>
          )}
          {cargando ? (
            <div className="status">
              <div className="spinner" />
              <div>Carregando…</div>
            </div>
          ) : filtrados.length === 0 ? (
            <p className="note">
              {recarregando ? "Carregando…" : "Nenhuma nota neste período."}
            </p>
          ) : (
            <div
              className="table-scroll"
              style={{ opacity: recarregando ? 0.5 : 1 }}
            >
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
                    <Fragment key={e.id}>
                    <tr>
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
                          {e.descricao && (
                            <button
                              className="btn-ghost"
                              title="Ver observação da nota"
                              onClick={() =>
                                setObsAberta(obsAberta === e.id ? null : e.id)
                              }
                            >
                              💬
                            </button>
                          )}
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
                    {obsAberta === e.id && e.descricao && (
                      <tr>
                        <td colSpan={11} style={{ background: "#f8fafc" }}>
                          <span style={{ whiteSpace: "pre-wrap" }}>
                            💬 <strong>Observação ({codigoId(e.id)}):</strong>{" "}
                            {e.descricao}
                          </span>
                        </td>
                      </tr>
                    )}
                    </Fragment>
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
