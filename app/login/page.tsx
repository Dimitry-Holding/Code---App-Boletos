"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCargando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });
    if (error) {
      setErro("E-mail ou senha incorretos.");
      setCargando(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={entrar}>
        <h1>📄 Notas Fiscais</h1>
        <p>Dimitry — registro de compras com cartão</p>

        <div className="field">
          <label>E-mail</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label>Senha</label>
          <input
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
        </div>

        {erro && <div className="error-box">{erro}</div>}

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 16 }}
          disabled={cargando}
        >
          {cargando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
