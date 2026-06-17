"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import {
  type Evento,
  codigoId,
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

export default function AdminApp({ nome }: { nome: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [perfiles, setPerfiles] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);

  const [inicio, setInicio] = useState(isoPrimeiroDiaMes());
  const [fim, setFim] = useState(isoHoje());
  const [usuario, setUsuario] = useState("todos");
  const [tdc, setTdc] = useState("todos");

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

  const filtrados = eventos.filter((e) => {
    const dia = (e.data_documento || e.criado_em || "").slice(0, 10);
    if (inicio && dia < inicio) return false;
    if (fim && dia > fim) return false;
    if (usuario !== "todos" && e.conductor_id !== usuario) return false;
    if (tdc !== "todos" && (e.ultimos4 || "") !== tdc) return false;
    return true;
  });

  const total = filtrados.reduce((s, e) => s + (Number(e.valor) || 0), 0);

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

  return (
    <>
      <TopBar nome={nome} papel="Administrador" />
      <main className="wrap">
        <div className="section-title">
          <span>Notas fiscais</span>
          <span className="count">{filtrados.length}</span>
          <span className="spacer" />
          <Link href="/usuarios" className="btn btn-light">
            👥 Usuários
          </Link>
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
          </div>

          <p className="note">
            Período: <strong>{inicio || "—"}</strong> a <strong>{fim || "—"}</strong> ·
            Total: <strong>R$ {total.toFixed(2)}</strong>
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
                    <th>ID</th>
                    <th>Data</th>
                    <th>Fornecedor</th>
                    <th>Valor</th>
                    <th>Centro de custo</th>
                    <th>Categoria</th>
                    <th>Pagamento</th>
                    <th>Cartão</th>
                    <th>Usuário</th>
                    <th>Foto</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((e) => (
                    <tr key={e.id}>
                      <td className="codigo">{codigoId(e.id)}</td>
                      <td>{e.data_documento || "—"}</td>
                      <td>{e.fornecedor || "—"}</td>
                      <td className="num">{Number(e.valor ?? 0).toFixed(2)}</td>
                      <td>{e.centro_custo || "—"}</td>
                      <td>{e.categoria || "—"}</td>
                      <td>
                        {TIPO_PAGAMENTO_LABEL[e.tipo_pagamento ?? ""] ?? "—"}
                      </td>
                      <td>{e.ultimos4 ? `••${e.ultimos4}` : "—"}</td>
                      <td>{perfiles[e.conductor_id] ?? "—"}</td>
                      <td>
                        <button
                          className="btn-ghost"
                          onClick={() => verFoto(e.foto_path)}
                        >
                          👁️ Ver
                        </button>
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
