"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { emailParaUsuario } from "@/lib/auth";
import {
  type Cartao,
  type Categoria,
  type CentroCusto,
  labelCartao,
} from "@/lib/evento";
import TopBar from "./TopBar";

type Usuario = { id: string; email: string; nome: string; role: string };

function badgeRole(role: string) {
  if (role === "admin") return { cls: "media", txt: "Administrador" };
  if (role === "supervisor") return { cls: "baixa", txt: "Semi-admin" };
  return { cls: "alta", txt: "Usuário" };
}

export default function GestaoUsuarios({ nome }: { nome: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // alta de usuario
  const [fNome, setFNome] = useState("");
  const [fUsuario, setFUsuario] = useState("");
  const [fSenha, setFSenha] = useState("");
  const [fRole, setFRole] = useState("conductor");
  const [creando, setCreando] = useState(false);

  // detalle expandido
  const [expandido, setExpandido] = useState<Usuario | null>(null);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [escopo, setEscopo] = useState<Set<string>>(new Set());
  const [apelido, setApelido] = useState("");
  const [last4, setLast4] = useState("");
  const [diaVenc, setDiaVenc] = useState("");
  const [catBulk, setCatBulk] = useState("");
  const [centroBulk, setCentroBulk] = useState("");

  const conductores = usuarios.filter((u) => u.role === "conductor");

  async function cargarUsuarios() {
    const r = await fetch("/api/admin/users");
    const d = await r.json();
    if (r.ok) setUsuarios(d.usuarios);
    else setErro(d.error || "Erro ao carregar.");
    setCargando(false);
  }

  useEffect(() => {
    cargarUsuarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOk(null);
    setCreando(true);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: fNome, usuario: fUsuario, senha: fSenha, role: fRole }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Erro ao criar.");
      setOk(`Usuário "${fUsuario}" criado.`);
      setFNome("");
      setFUsuario("");
      setFSenha("");
      setFRole("conductor");
      await cargarUsuarios();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro.");
    } finally {
      setCreando(false);
    }
  }

  async function resetarSenha(u: Usuario) {
    const nova = prompt(`Nova senha para ${u.nome} (mín. 6 caracteres):`);
    if (!nova) return;
    const r = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, senha: nova }),
    });
    const d = await r.json();
    if (r.ok) setOk(`Senha de ${u.nome} atualizada.`);
    else setErro(d.error || "Erro.");
  }

  async function expandir(u: Usuario) {
    if (expandido?.id === u.id) {
      setExpandido(null);
      return;
    }
    setExpandido(u);
    setApelido("");
    setLast4("");
    setDiaVenc("");
    setCatBulk("");
    setCentroBulk("");
    await cargarDetalle(u);
  }

  async function cargarDetalle(u: Usuario) {
    if (u.role === "supervisor") {
      const { data } = await supabase
        .from("supervisor_escopo")
        .select("user_id")
        .eq("supervisor_id", u.id);
      setEscopo(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)));
      return;
    }
    const [{ data: cs }, { data: cats }, { data: ccs }] = await Promise.all([
      supabase.from("cartoes").select("*").eq("user_id", u.id).order("apelido"),
      supabase.from("categorias").select("*").eq("user_id", u.id).order("nome"),
      supabase.from("centros_custo").select("*").eq("user_id", u.id).order("nome"),
    ]);
    setCartoes((cs as Cartao[]) ?? []);
    setCategorias((cats as Categoria[]) ?? []);
    setCentros((ccs as CentroCusto[]) ?? []);
  }

  // --- Tarjetas ---
  async function addCartao(u: Usuario) {
    const dig = last4.replace(/\D/g, "").slice(-4);
    if (dig.length < 4) {
      setErro("Os últimos 4 dígitos devem ter 4 números.");
      return;
    }
    const dia = Number(diaVenc);
    if (diaVenc && (!Number.isInteger(dia) || dia < 1 || dia > 31)) {
      setErro("O dia de vencimento deve ser um número de 1 a 31.");
      return;
    }
    const { error } = await supabase.from("cartoes").insert({
      user_id: u.id,
      ultimos4: dig,
      apelido: apelido.trim() || null,
      dia_vencimento: diaVenc ? dia : null,
    });
    if (error) return setErro("Erro ao adicionar cartão: " + error.message);
    setApelido("");
    setLast4("");
    setDiaVenc("");
    await cargarDetalle(u);
  }

  /** Define/atualiza o dia de vencimento da fatura de um cartão existente. */
  async function editarVencimento(u: Usuario, c: Cartao) {
    const resp = prompt(
      `Dia do mês em que vence a fatura do cartão ${labelCartao(c)} (1 a 31, vazio para limpar):`,
      c.dia_vencimento ? String(c.dia_vencimento) : "",
    );
    if (resp === null) return;
    const dia = Number(resp);
    if (resp !== "" && (!Number.isInteger(dia) || dia < 1 || dia > 31)) {
      setErro("O dia de vencimento deve ser um número de 1 a 31.");
      return;
    }
    const { error } = await supabase
      .from("cartoes")
      .update({ dia_vencimento: resp === "" ? null : dia })
      .eq("id", c.id);
    if (error) return setErro("Erro ao atualizar vencimento: " + error.message);
    await cargarDetalle(u);
  }
  async function removeCartao(u: Usuario, id: number) {
    await supabase.from("cartoes").delete().eq("id", id);
    await cargarDetalle(u);
  }

  // --- Categorías / Centros (bulk, uno por línea) ---
  async function addBulk(u: Usuario, tabla: string, texto: string, limpiar: () => void) {
    const nomes = texto.split("\n").map((s) => s.trim()).filter(Boolean);
    if (nomes.length === 0) return;
    const filas = nomes.map((n) => ({ user_id: u.id, nome: n }));
    const { error } = await supabase.from(tabla).insert(filas);
    if (error) return setErro(`Erro ao adicionar em ${tabla}: ` + error.message);
    limpiar();
    await cargarDetalle(u);
  }
  async function removeItem(u: Usuario, tabla: string, id: number) {
    await supabase.from(tabla).delete().eq("id", id);
    await cargarDetalle(u);
  }

  // --- Alcance del semi-admin ---
  async function toggleEscopo(sup: Usuario, condId: string) {
    if (escopo.has(condId)) {
      await supabase
        .from("supervisor_escopo")
        .delete()
        .eq("supervisor_id", sup.id)
        .eq("user_id", condId);
    } else {
      await supabase
        .from("supervisor_escopo")
        .insert({ supervisor_id: sup.id, user_id: condId });
    }
    await cargarDetalle(sup);
  }

  return (
    <>
      <TopBar nome={nome} papel="Administrador" />
      <main className="wrap">
        <div className="section-title">
          <Link href="/" className="btn-ghost">← Notas</Link>
        </div>

        <h2 style={{ fontSize: 18 }}>Usuários</h2>

        <div className="card">
          <strong>Novo usuário</strong>
          <form onSubmit={crear}>
            <div className="field">
              <label>Nome</label>
              <input value={fNome} onChange={(e) => setFNome(e.target.value)} required />
            </div>
            <div className="grid-2">
              <div className="field">
                <label>Usuário</label>
                <input
                  autoCapitalize="none"
                  placeholder="ex: nome.sobrenome"
                  value={fUsuario}
                  onChange={(e) => setFUsuario(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>Senha (mín. 6)</label>
                <input value={fSenha} onChange={(e) => setFSenha(e.target.value)} required />
              </div>
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={fRole} onChange={(e) => setFRole(e.target.value)}>
                <option value="conductor">Usuário</option>
                <option value="supervisor">Semi-admin (só leitura de certos usuários)</option>
                <option value="admin">Administrador</option>
              </select>
            </div>

            {erro && <div className="error-box">{erro}</div>}
            {ok && (
              <div className="error-box" style={{ background: "#dcfce7", borderColor: "#86efac", color: "#166534" }}>
                {ok}
              </div>
            )}

            <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} disabled={creando}>
              {creando ? "Criando…" : "Criar usuário"}
            </button>
          </form>
        </div>

        <div className="section-title">
          <span>Usuários</span>
          <span className="count">{usuarios.length}</span>
        </div>

        <div className="card">
          {cargando ? (
            <div className="status"><div className="spinner" /></div>
          ) : (
            usuarios.map((u) => {
              const b = badgeRole(u.role);
              const aberto = expandido?.id === u.id;
              return (
                <div key={u.id} className="evento">
                  <div className="top">
                    <span className="fornecedor">{u.nome || "(sem nome)"}</span>
                    <span className={`badge ${b.cls}`}>{b.txt}</span>
                  </div>
                  <div className="meta">{emailParaUsuario(u.email)}</div>
                  <div className="row" style={{ marginTop: 8 }}>
                    {u.role === "conductor" && (
                      <button className="btn-ghost" onClick={() => expandir(u)}>
                        💳 Cartões, categorias e centros
                      </button>
                    )}
                    {u.role === "supervisor" && (
                      <button className="btn-ghost" onClick={() => expandir(u)}>
                        👁️ Usuários que vê
                      </button>
                    )}
                    <span className="spacer" />
                    <button className="btn-ghost" onClick={() => resetarSenha(u)}>
                      🔑 Senha
                    </button>
                  </div>

                  {aberto && u.role === "conductor" && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
                      {/* CARTÕES */}
                      <strong style={{ fontSize: 14 }}>Cartões</strong>
                      {cartoes.length === 0 ? (
                        <p className="note">Nenhum cartão.</p>
                      ) : (
                        <div style={{ marginTop: 6 }}>
                          {cartoes.map((c) => (
                            <div key={c.id} className="row" style={{ padding: "4px 0" }}>
                              <span>
                                {labelCartao(c)}{" "}
                                <span className="note" style={{ margin: 0 }}>
                                  {c.dia_vencimento
                                    ? `(vence dia ${c.dia_vencimento})`
                                    : "(sem vencimento)"}
                                </span>
                              </span>
                              <span className="spacer" />
                              <button
                                className="btn-ghost"
                                title="Dia de vencimento da fatura"
                                onClick={() => editarVencimento(u, c)}
                              >
                                📅
                              </button>
                              <button className="btn-ghost" onClick={() => removeCartao(u, c.id)}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="grid-2" style={{ marginTop: 6 }}>
                        <div className="field" style={{ marginTop: 0 }}>
                          <label>Apelido</label>
                          <input placeholder="ex: Santander" value={apelido} onChange={(e) => setApelido(e.target.value)} />
                        </div>
                        <div className="field" style={{ marginTop: 0 }}>
                          <label>Últimos 4</label>
                          <input inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value)} />
                        </div>
                      </div>
                      <div className="field" style={{ marginTop: 6 }}>
                        <label>Dia de vencimento da fatura (1–31, opcional)</label>
                        <input
                          inputMode="numeric"
                          maxLength={2}
                          placeholder="ex: 15"
                          value={diaVenc}
                          onChange={(e) => setDiaVenc(e.target.value.replace(/\D/g, ""))}
                        />
                      </div>
                      <button className="btn btn-light btn-block" style={{ marginTop: 8 }} onClick={() => addCartao(u)}>
                        + Adicionar cartão
                      </button>

                      {/* CENTROS DE CUSTO */}
                      <strong style={{ fontSize: 14, display: "block", marginTop: 16 }}>Centros de custo</strong>
                      {centros.length === 0 ? (
                        <p className="note">Nenhum centro de custo.</p>
                      ) : (
                        <div style={{ marginTop: 6 }}>
                          {centros.map((c) => (
                            <div key={c.id} className="row" style={{ padding: "4px 0" }}>
                              <span>{c.nome}</span>
                              <span className="spacer" />
                              <button className="btn-ghost" onClick={() => removeItem(u, "centros_custo", c.id)}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="field" style={{ marginTop: 6 }}>
                        <label>Adicionar centros (um por linha)</label>
                        <textarea rows={2} placeholder={"Aeronave\nEscritório\n..."} value={centroBulk} onChange={(e) => setCentroBulk(e.target.value)} />
                      </div>
                      <button className="btn btn-light btn-block" onClick={() => addBulk(u, "centros_custo", centroBulk, () => setCentroBulk(""))}>
                        + Adicionar centros
                      </button>

                      {/* CATEGORIAS */}
                      <strong style={{ fontSize: 14, display: "block", marginTop: 16 }}>Categorias</strong>
                      {categorias.length === 0 ? (
                        <p className="note">Nenhuma categoria.</p>
                      ) : (
                        <div style={{ marginTop: 6 }}>
                          {categorias.map((c) => (
                            <div key={c.id} className="row" style={{ padding: "4px 0" }}>
                              <span>{c.nome}</span>
                              <span className="spacer" />
                              <button className="btn-ghost" onClick={() => removeItem(u, "categorias", c.id)}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="field" style={{ marginTop: 6 }}>
                        <label>Adicionar categorias (uma por linha)</label>
                        <textarea rows={3} placeholder={"Combustiveis e Lubrificantes\nHospedagem\n..."} value={catBulk} onChange={(e) => setCatBulk(e.target.value)} />
                      </div>
                      <button className="btn btn-light btn-block" onClick={() => addBulk(u, "categorias", catBulk, () => setCatBulk(""))}>
                        + Adicionar categorias
                      </button>
                    </div>
                  )}

                  {aberto && u.role === "supervisor" && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
                      <strong style={{ fontSize: 14 }}>Quais usuários pode ver</strong>
                      <p className="note" style={{ marginTop: 2 }}>
                        Marque os usuários cujos gastos este semi-admin poderá consultar.
                      </p>
                      {conductores.length === 0 ? (
                        <p className="note">Não há usuários para atribuir.</p>
                      ) : (
                        <div style={{ marginTop: 6 }}>
                          {conductores.map((c) => (
                            <label key={c.id} className="row" style={{ padding: "6px 0", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={escopo.has(c.id)}
                                onChange={() => toggleEscopo(u, c.id)}
                                style={{ width: 18, height: 18, marginRight: 8 }}
                              />
                              <span>{c.nome} <span className="note" style={{ margin: 0 }}>({emailParaUsuario(c.email)})</span></span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </main>
    </>
  );
}
