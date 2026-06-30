"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { emailParaUsuario } from "@/lib/auth";
import { type Cartao, type Categoria, labelCartao } from "@/lib/evento";
import TopBar from "./TopBar";

type Usuario = {
  id: string;
  email: string;
  nome: string;
  role: string;
};

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
  const [expandido, setExpandido] = useState<string | null>(null);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [apelido, setApelido] = useState("");
  const [last4, setLast4] = useState("");
  const [catBulk, setCatBulk] = useState("");

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
    if (expandido === u.id) {
      setExpandido(null);
      return;
    }
    setExpandido(u.id);
    setApelido("");
    setLast4("");
    setCatBulk("");
    await cargarDetalle(u.id);
  }

  async function cargarDetalle(userId: string) {
    const [{ data: cs }, { data: cats }] = await Promise.all([
      supabase.from("cartoes").select("*").eq("user_id", userId).order("apelido"),
      supabase.from("categorias").select("*").eq("user_id", userId).order("nome"),
    ]);
    setCartoes((cs as Cartao[]) ?? []);
    setCategorias((cats as Categoria[]) ?? []);
  }

  async function addCartao(userId: string) {
    const dig = last4.replace(/\D/g, "").slice(-4);
    if (dig.length < 4) {
      setErro("Os últimos 4 dígitos devem ter 4 números.");
      return;
    }
    const { error } = await supabase
      .from("cartoes")
      .insert({ user_id: userId, ultimos4: dig, apelido: apelido.trim() || null });
    if (error) {
      setErro("Erro ao adicionar cartão: " + error.message);
      return;
    }
    setApelido("");
    setLast4("");
    await cargarDetalle(userId);
  }

  async function removeCartao(userId: string, id: number) {
    await supabase.from("cartoes").delete().eq("id", id);
    await cargarDetalle(userId);
  }

  async function addCategoriasBulk(userId: string) {
    const nomes = catBulk
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (nomes.length === 0) return;
    const filas = nomes.map((n) => ({ user_id: userId, nome: n }));
    const { error } = await supabase.from("categorias").insert(filas);
    if (error) {
      setErro("Erro ao adicionar categorias: " + error.message);
      return;
    }
    setCatBulk("");
    await cargarDetalle(userId);
  }

  async function removeCategoria(userId: string, id: number) {
    await supabase.from("categorias").delete().eq("id", id);
    await cargarDetalle(userId);
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
            usuarios.map((u) => (
              <div key={u.id} className="evento">
                <div className="top">
                  <span className="fornecedor">{u.nome || "(sem nome)"}</span>
                  <span className={`badge ${u.role === "admin" ? "media" : "alta"}`}>
                    {u.role === "admin" ? "Administrador" : "Usuário"}
                  </span>
                </div>
                <div className="meta">{emailParaUsuario(u.email)}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  {u.role !== "admin" && (
                    <button className="btn-ghost" onClick={() => expandir(u)}>
                      💳 Cartões e categorias
                    </button>
                  )}
                  <span className="spacer" />
                  <button className="btn-ghost" onClick={() => resetarSenha(u)}>
                    🔑 Senha
                  </button>
                </div>

                {expandido === u.id && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
                    {/* TARJETAS */}
                    <strong style={{ fontSize: 14 }}>Cartões</strong>
                    {cartoes.length === 0 ? (
                      <p className="note">Nenhum cartão.</p>
                    ) : (
                      <div style={{ marginTop: 6 }}>
                        {cartoes.map((c) => (
                          <div key={c.id} className="row" style={{ padding: "4px 0" }}>
                            <span>{labelCartao(c)}</span>
                            <span className="spacer" />
                            <button className="btn-ghost" onClick={() => removeCartao(u.id, c.id)}>✕</button>
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
                    <button className="btn btn-light btn-block" style={{ marginTop: 8 }} onClick={() => addCartao(u.id)}>
                      + Adicionar cartão
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
                            <button className="btn-ghost" onClick={() => removeCategoria(u.id, c.id)}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="field" style={{ marginTop: 6 }}>
                      <label>Adicionar categorias (uma por linha)</label>
                      <textarea
                        rows={3}
                        placeholder={"Combustiveis e Lubrificantes\nHospedagem\n..."}
                        value={catBulk}
                        onChange={(e) => setCatBulk(e.target.value)}
                      />
                    </div>
                    <button className="btn btn-light btn-block" onClick={() => addCategoriasBulk(u.id)}>
                      + Adicionar categorias
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </main>
    </>
  );
}
