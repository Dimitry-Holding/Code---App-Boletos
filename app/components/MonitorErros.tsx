"use client";

import { useEffect } from "react";

/**
 * Rede de segurança do monitoramento: captura erros de JavaScript que ninguém
 * tratou (tela que quebra, promessa rejeitada) em QUALQUER tela e os envia ao
 * painel 🩺 do admin. Sem login a API recusa (401) e nada é gravado.
 */
export default function MonitorErros() {
  useEffect(() => {
    let enviados = 0;
    // ruído conhecido de navegador, sem valor de diagnóstico
    const IGNORAR = /ResizeObserver loop|^Script error\.?$/i;

    function enviar(mensagem: string, detalhe: string) {
      if (!mensagem || IGNORAR.test(mensagem) || enviados >= 5) return;
      enviados++;
      fetch("/api/log-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origem: "app",
          mensagem: `Erro inesperado na tela: ${mensagem}`.slice(0, 480),
          detalhe: `${detalhe} | página: ${location.pathname}`,
        }),
      }).catch(() => {});
    }

    function aoErro(e: ErrorEvent) {
      enviar(e.message, `${e.filename ?? ""}:${e.lineno ?? ""} | ${(e.error?.stack ?? "").slice(0, 300)}`);
    }
    function aoRejeitar(e: PromiseRejectionEvent) {
      const r = e.reason;
      enviar(
        r instanceof Error ? r.message : String(r),
        `promessa rejeitada | ${(r instanceof Error ? (r.stack ?? "") : "").slice(0, 300)}`,
      );
    }

    window.addEventListener("error", aoErro);
    window.addEventListener("unhandledrejection", aoRejeitar);
    return () => {
      window.removeEventListener("error", aoErro);
      window.removeEventListener("unhandledrejection", aoRejeitar);
    };
  }, []);

  return null;
}
