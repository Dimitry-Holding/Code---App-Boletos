"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TopBar from "./TopBar";

type Usuario = {
  id: string;
  email: string;
  nome: string;
  role: string;
  criado_em: string;
};

export default function GestaoUsuarios({ nome }: { nome: string }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [fNome, setFNome] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fSenha, setFSenha] = useState("");
  const [fRole, setFRole] = useState("conductor");
  const [creando, setCreando] = useState(false);

  async function cargar() {
    const r = await fetch("/api/admin/users");
    const d = await r.json();
    if (r.ok) setUsuarios(d.usuarios);
    else setErro(d.error || "Erro ao carregar.");
    setCargando(false);
  }

  useEffect(() => {
    cargar();
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
        body: JSON.stringify({
          nome: fNome,
          email: fEmail,
          senha: fSenha,
          role: fRole,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Erro ao criar.");
      setOk(`Usuário ${fEmail} criado.`);
      setFNome("");
      setFEmail("");
      setFSenha("");
      setFRole("conductor");
      await cargar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro.");
    } finally {
      setCreando(false);
    }
  }

  async function resetarSenha(u: Usuario) {
    const nova = prompt(`Nova senha para ${u.nome || u.email} (mín. 6 caracteres):`);
    if (!nova) return;
    const r = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, senha: nova }),
    });
    const d = await r.json();
    if (r.ok) setOk(`Senha de ${u.email} atualizada.`);
    else setErro(d.error || "Erro ao atualizar a senha.");
  }

  return (
    <>
      <TopBar nome={nome} papel="Administrador" />
      <main className="wrap">
        <div className="section-title">
          <Link href="/" className="btn-ghost">
            ← Notas
          </Link>
          <span className="spacer" />
        </div>

        <h2 style={{ fontSize: 18 }}>Condutores e usuários</h2>

        <div className="card">
          <strong>Novo usuário</strong>
          <form onSubmit={crear}>
            <div className="field">
              <label>Nome</label>
              <input value={fNome} onChange={(e) => setFNome(e.target.value)} required />
            </div>
            <div className="grid-2">
              <div className="field">
                <label>E-mail</label>
                <input
                  type="email"
                  value={fEmail}
                  onChange={(e) => setFEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>Senha (mín. 6)</label>
                <input
                  value={fSenha}
                  onChange={(e) => setFSenha(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={fRole} onChange={(e) => setFRole(e.target.value)}>
                <option value="conductor">Condutor</option>
                <option value="admin">Administrador</option>
              </select>
            </div>

            {erro && <div className="error-box">{erro}</div>}
            {ok && (
              <div
                className="error-box"
                style={{ background: "#dcfce7", borderColor: "#86efac", color: "#166534" }}
              >
                {ok}
              </div>
            )}

            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 14 }}
              disabled={creando}
            >
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
            <div className="status">
              <div className="spinner" />
            </div>
          ) : (
            usuarios.map((u) => (
              <div key={u.id} className="evento">
                <div className="top">
                  <span className="fornecedor">{u.nome || "(sem nome)"}</span>
                  <span
                    className={`badge ${u.role === "admin" ? "media" : "alta"}`}
                  >
                    {u.role === "admin" ? "Administrador" : "Condutor"}
                  </span>
                </div>
                <div className="meta">{u.email}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="spacer" />
                  <button className="btn-ghost" onClick={() => resetarSenha(u)}>
                    🔑 Redefinir senha
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
