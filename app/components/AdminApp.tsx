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

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type Perfil = { id: string; nome: string };

export default function AdminApp({ nome }: { nome: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [perfiles, setPerfiles] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);

  const hoy = new Date();
  const [ano, setAno] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [condutor, setCondutor] = useState("todos");

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

  const conductoresEnDatos = useMemo(() => {
    const ids = Array.from(new Set(eventos.map((e) => e.conductor_id)));
    return ids.map((id) => ({ id, nome: perfiles[id] ?? id.slice(0, 8) }));
  }, [eventos, perfiles]);

  const filtrados = eventos.filter((e) => {
    const d = new Date(e.data_documento || e.criado_em);
    if (d.getFullYear() !== ano || d.getMonth() + 1 !== mes) return false;
    if (condutor !== "todos" && e.conductor_id !== condutor) return false;
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
    XLSX.writeFile(wb, `notas_${ano}-${String(mes).padStart(2, "0")}.xlsx`);
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
            👥 Condutores
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
            <div className="field">
              <label>Condutor</label>
              <select
                value={condutor}
                onChange={(e) => setCondutor(e.target.value)}
              >
                <option value="todos">Todos</option>
                {conductoresEnDatos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="note">
            Total do período: <strong>R$ {total.toFixed(2)}</strong>
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
                    <th>Condutor</th>
                    <th>Foto</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((e) => (
                    <tr key={e.id}>
                      <td className="codigo">{codigoId(e.id)}</td>
                      <td>{e.data_documento || "—"}</td>
                      <td>{e.fornecedor || "—"}</td>
                      <td className="num">
                        {Number(e.valor ?? 0).toFixed(2)}
                      </td>
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
