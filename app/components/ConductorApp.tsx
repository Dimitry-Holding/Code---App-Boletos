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
  valorBRL,
  IOF_TAXA,
  IOF_CATEGORIA,
  MOEDAS,
} from "@/lib/evento";
import TopBar from "./TopBar";

type Estado = "inicio" | "scanner" | "procesando" | "revision" | "edicion";
type Borrador = Extraccion & { centro_custo: string };
type Captura = {
  dataUrl: string;
  mediaType: string;
  esPdf: boolean;
  storagePath?: string; // PDFs: ya subidos a Storage antes de extraer
};

const MAX_PDF_BYTES = 12 * 1024 * 1024;

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
  const [filtroCategoria, setFiltroCategoria] = useState("todos");
  const [busca, setBusca] = useState("");
  const [ordenarCol, setOrdenarCol] = useState("data");
  const [ordenarDir, setOrdenarDir] = useState<1 | -1>(-1);
  const [editId, setEditId] = useState<number | null>(null);
  const [fotoEditUrl, setFotoEditUrl] = useState<string | null>(null);
  // Conversión de moneda: cambio editable (se precarga con el PTAX del BCB)
  const [cambio, setCambio] = useState("");
  const [buscandoCambio, setBuscandoCambio] = useState(false);
  const [cambioInfo, setCambioInfo] = useState<string | null>(null);

  const galRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  // Modo scanner: páginas já capturadas (dataURLs JPEG), viram um único PDF.
  const [paginas, setPaginas] = useState<string[]>([]);
  // Progresso da leitura (etapa + cronômetro) e retentativa sem refazer a foto
  const [fase, setFase] = useState("");
  const [segundos, setSegundos] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const retentativaRef = useRef<{ cap: Captura; body: any } | null>(null);

  useEffect(() => {
    if (estado !== "procesando") {
      setSegundos(0);
      return;
    }
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [estado]);

  // etapa atual também num ref: os logs de erro leem o valor real do momento
  const faseRef = useRef("");
  function mudarFase(f: string) {
    faseRef.current = f;
    setFase(f);
  }

  const hoy = new Date();
  const [ano, setAno] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);

  useEffect(() => {
    cargarTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Conversión de moneda ---
  const emRevisao = estado === "revision" || estado === "edicion";
  const moedaEstrangeira = borrador.moeda !== "BRL";
  const cambioNum = parseFloat(cambio.replace(",", ".")) || 0;
  const valorBrlBorrador = moedaEstrangeira
    ? Math.round(borrador.valor * cambioNum * 100) / 100
    : borrador.valor;
  const iofBorrador = Math.round(valorBrlBorrador * IOF_TAXA * 100) / 100;
  // Evita re-buscar el PTAX si moneda+fecha no cambiaron (p. ej. al editar).
  const claveCambioRef = useRef<string | null>(null);

  useEffect(() => {
    if (!emRevisao || !moedaEstrangeira) {
      setCambioInfo(null);
      return;
    }
    const clave = `${borrador.moeda}|${borrador.data_documento}`;
    if (claveCambioRef.current === clave) return;
    claveCambioRef.current = clave;
    let cancelado = false;
    (async () => {
      setBuscandoCambio(true);
      setCambioInfo(null);
      try {
        const r = await fetch(
          `/api/cambio?moeda=${borrador.moeda}&data=${borrador.data_documento || ""}`,
        );
        const j = await r.json();
        if (cancelado) return;
        if (r.ok && j.cambio) {
          setCambio(String(j.cambio));
          setCambioInfo(`PTAX ${j.data_cotacao} (Banco Central)`);
        } else {
          setCambio("");
          setCambioInfo(j.error || "Informe o câmbio manualmente.");
        }
      } catch {
        if (!cancelado) {
          setCambio("");
          setCambioInfo("Informe o câmbio manualmente.");
        }
      } finally {
        if (!cancelado) setBuscandoCambio(false);
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emRevisao, moedaEstrangeira, borrador.moeda, borrador.data_documento]);

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
    if (filtroCategoria !== "todos" && (e.categoria || "") !== filtroCategoria)
      return false;
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      const forn = (e.fornecedor || "").toLowerCase();
      const val = String(e.valor ?? "") + " " + valorBRL(e).toFixed(2);
      if (!forn.includes(q) && !val.includes(q)) return false;
    }
    return true;
  });
  const total = eventosFiltrados.reduce((s, e) => s + valorBRL(e), 0);

  function valorOrden(e: Evento, col: string): string | number {
    switch (col) {
      case "valor": return valorBRL(e);
      case "fornecedor": return (e.fornecedor || "").toLowerCase();
      case "categoria": return (e.categoria || "").toLowerCase();
      case "centro": return (e.centro_custo || "").toLowerCase();
      default: return e.data_documento || e.criado_em || ""; // "data"
    }
  }
  const eventosOrdenados = [...eventosFiltrados].sort((a, b) => {
    const va = valorOrden(a, ordenarCol);
    const vb = valorOrden(b, ordenarCol);
    if (va < vb) return -ordenarDir;
    if (va > vb) return ordenarDir;
    return 0;
  });

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    // Várias fotos selecionadas na galeria = uma nota de várias páginas.
    if (files.length > 1) await procesarVariasImagens(files);
    else await procesarArchivo(files[0]);
  }

  /**
   * Processa páginas capturadas: 1 foto segue como imagem (com pré-visualização);
   * 2+ fotos viram um único PDF (uma página por foto).
   */
  async function procesarPaginas(pags: string[]) {
    if (pags.length === 1) {
      await procesarArchivo({ dataUrl: pags[0], mediaType: "image/jpeg", esPdf: false });
    } else {
      await procesarArchivo(await paginasParaPdf(pags));
    }
  }

  /** Várias imagens escolhidas na galeria = páginas da mesma nota. */
  async function procesarVariasImagens(files: File[]) {
    setError(null);
    setEstado("procesando");
    try {
      const pags: string[] = [];
      for (const f of files) pags.push(await redimensionar(f));
      await procesarPaginas(pags);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao juntar as fotos.");
      setEstado("inicio");
    }
  }

  // --- Modo scanner (uma foto por página, depois vira um PDF só) ---

  async function alElegirScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const pag = await redimensionar(file);
      setPaginas((p) => [...p, pag]);
      setEstado("scanner");
    } catch {
      setError("Não foi possível ler a foto. Tente novamente.");
    }
  }

  function removerPagina(i: number) {
    const novas = paginas.filter((_, idx) => idx !== i);
    setPaginas(novas);
    if (novas.length === 0) setEstado("inicio");
  }

  function cancelarScanner() {
    setPaginas([]);
    setEstado("inicio");
  }

  async function concluirScanner() {
    if (paginas.length === 0) return;
    const pags = paginas;
    setPaginas([]);
    setEstado("procesando");
    try {
      await procesarPaginas(pags);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao montar o PDF.");
      setEstado("inicio");
    }
  }

  /**
   * Chama a IA; se a CONEXÃO falhar no meio (sinal fraco, app em segundo
   * plano — o "Load failed" do iPhone), tenta de novo sozinha até 2 vezes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function extrairComRetentativa(body: any): Promise<Extraccion> {
    const corpo = JSON.stringify(body);
    for (let tentativa = 0; ; tentativa++) {
      try {
        const resp = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: corpo,
        });
        const data = (await resp.json()) as Extraccion & { error?: string };
        if (!resp.ok) {
          // o servidor já registrou esta falha no monitoramento (🩺 Erros)
          const e = new Error(data.error || "Erro ao processar.") as Error & {
            jaRegistrado?: boolean;
          };
          e.jaRegistrado = true;
          throw e;
        }
        return data;
      } catch (err) {
        if (ehErroDeRede(err) && tentativa < 2) {
          mudarFase("A conexão oscilou — tentando de novo…");
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        throw err;
      }
    }
  }

  /** Extrai os dados e abre a tela de revisão preenchida. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function extrairEAbrirRevisao(body: any) {
    const data = await extrairComRetentativa(body);
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
    retentativaRef.current = null;
    setEstado("revision");
  }

  /** "Tentar de novo": reusa a foto/PDF guardado, sem capturar nada de novo. */
  async function tentarDeNovo() {
    const r = retentativaRef.current;
    if (!r) return;
    setError(null);
    setEstado("procesando");
    mudarFase("Lendo a nota com a IA…");
    try {
      await extrairEAbrirRevisao(r.body);
    } catch (err) {
      const rede = ehErroDeRede(err);
      const bruto = err instanceof Error ? err.message : String(err);
      const msg = rede ? MSG_REDE : bruto || "Erro desconhecido.";
      setError(msg);
      if (!(err as { jaRegistrado?: boolean })?.jaRegistrado) {
        fetch("/api/log-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origem: "app",
            mensagem: msg,
            detalhe:
              `retentativa | bruto: ${bruto} | fase: ${faseRef.current}` +
              ` | stack: ${((err as Error)?.stack ?? "-").slice(0, 300)}`,
          }),
        }).catch(() => {});
      }
      // a nota segue guardada para nova tentativa (IA fora do ar passa);
      // quem decide desistir é o usuário, pelo botão "Descartar"
      setEstado("inicio");
    }
  }

  /** Descarta a nota que estava guardada para retentativa. */
  function descartarRetentativa() {
    const r = retentativaRef.current;
    retentativaRef.current = null;
    if (r?.cap.storagePath) {
      supabase.storage.from("notas").remove([r.cap.storagePath]);
    }
    setCaptura(null);
    setError(null);
  }

  /** Processa um arquivo (foto/PDF) ou uma captura já tratada (fluxo de fotos). */
  async function procesarArchivo(entrada: File | Captura) {
    setError(null);
    setEditId(null);
    setEstado("procesando");
    mudarFase("Preparando a foto…");
    retentativaRef.current = null;
    const previo = captura?.storagePath;
    let subido: string | null = null;
    let capFinal: Captura | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ultimoBody: any = null;
    try {
      let cap: Captura;
      if (!(entrada instanceof File)) {
        cap = entrada;
      } else {
        const file = entrada;
        // O tipo é detectado pelo CONTEÚDO do arquivo, não pelo rótulo do celular:
        // PDFs de apps de scanner/Drive/WhatsApp chegam com o MIME errado no Android.
        const tipo = await detectarTipoArquivo(file);
        if (tipo === "pdf") {
          if (file.size > MAX_PDF_BYTES) {
            throw new Error("PDF muito grande (máx. 12 MB). Tente um PDF menor.");
          }
          cap = { dataUrl: "", mediaType: "application/pdf", esPdf: true };
        } else if (tipo === "imagem") {
          try {
            cap = { dataUrl: await redimensionar(file), mediaType: "image/jpeg", esPdf: false };
          } catch {
            throw new Error(
              "Não consegui abrir esta imagem no navegador (formato HEIC?). " +
                "Tente tirar a foto pelo botão 📷 do app.",
            );
          }
        } else {
          throw new Error(
            `Não reconheci o arquivo "${file.name}"${file.type ? ` (tipo ${file.type})` : ""}. ` +
              "Use uma foto ou um PDF.",
          );
        }
      }
      // PDF: sube a Storage y extrae desde ahi (evita el limite de tamano de Vercel).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let extractBody: any;
      if (cap.esPdf) {
        if (!(entrada instanceof File)) throw new Error("PDF inválido.");
        mudarFase("Enviando o arquivo…");
        const path = `${userId}/${crypto.randomUUID()}.pdf`;
        const up = await supabase.storage
          .from("notas")
          .upload(path, entrada, { contentType: "application/pdf" });
        if (up.error) throw up.error;
        subido = path;
        cap = { ...cap, storagePath: path };
        extractBody = {
          storagePath: path,
          mediaType: "application/pdf",
          categorias: categorias.map((c) => c.nome),
        };
      } else {
        extractBody = {
          imageBase64: cap.dataUrl.split(",")[1],
          mediaType: cap.mediaType,
          categorias: categorias.map((c) => c.nome),
        };
      }
      setCaptura(cap);
      capFinal = cap;
      ultimoBody = extractBody;
      if (previo && previo !== cap.storagePath) {
        supabase.storage.from("notas").remove([previo]);
      }

      mudarFase("Lendo a nota com a IA…");
      await extrairEAbrirRevisao(extractBody);
      subido = null; // éxito: el PDF queda como captura para guardar
    } catch (err) {
      const rede = ehErroDeRede(err);
      const bruto = err instanceof Error ? err.message : String(err);
      const msg = rede ? MSG_REDE : bruto || "Erro desconhecido.";
      setError(msg);
      // reporta ao monitoramento do admin (erros do servidor já foram registrados lá)
      if (!(err as { jaRegistrado?: boolean })?.jaRegistrado) {
        fetch("/api/log-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origem: "app",
            mensagem: msg,
            detalhe:
              `bruto: ${bruto} | fase: ${faseRef.current} | online: ` +
              `${typeof navigator === "undefined" ? "?" : navigator.onLine}` +
              ` | stack: ${((err as Error)?.stack ?? "-").slice(0, 300)}`,
          }),
        }).catch(() => {});
      }
      if (capFinal && ultimoBody) {
        // Falhou na fase de LEITURA (conexão caiu OU IA fora do ar): a nota
        // fica guardada para "Tentar de novo" — inclusive o PDF já no Storage.
        // Erros antes disso (formato inválido, PDF grande) descartam normal.
        retentativaRef.current = { cap: capFinal, body: ultimoBody };
        subido = null;
      } else {
        retentativaRef.current = null;
        setCaptura(null);
      }
      setEstado("inicio");
      if (subido) await supabase.storage.from("notas").remove([subido]);
    }
  }

  function actualizar<K extends keyof Borrador>(clave: K, valor: Borrador[K]) {
    setBorrador((b) => ({ ...b, [clave]: valor }));
  }

  function validar(): string | null {
    if (!borrador.fornecedor.trim()) return "Informe o fornecedor.";
    if (!(borrador.valor > 0)) return "Informe o valor (maior que zero).";
    if (!borrador.data_documento) return "Informe a data do documento.";
    if (!borrador.centro_custo) return "Selecione o centro de custo.";
    if (!borrador.ultimos4) return "Selecione o cartão.";
    if (!borrador.categoria) return "Selecione a categoria.";
    if (!borrador.descricao.trim()) return "Escreva uma descrição.";
    if (moedaEstrangeira && !(cambioNum > 0))
      return "Informe o câmbio para converter a real.";
    return null;
  }

  async function guardar() {
    if (!captura) return;
    const v = validar();
    if (v) {
      setError(v);
      return;
    }
    // Possível duplicata? (mesmo fornecedor, data, valor e cartão já lançados)
    const dup = achaDuplicata(eventos, borrador);
    if (dup) {
      const confirma = confirm(
        "⚠️ Você já lançou uma nota igual a esta:\n\n" +
          `${codigoId(dup.id)} — ${dup.fornecedor ?? ""}\n` +
          `${dup.data_documento ?? "sem data"} · ${dup.moeda ?? "BRL"} ` +
          `${Number(dup.valor ?? 0).toFixed(2)} · cartão ••${dup.ultimos4 ?? ""}\n\n` +
          "Se for a MESMA compra, toque em Cancelar (a nota já está salva).\n" +
          "Se for outra compra parecida, toque em OK para lançar mesmo assim.",
      );
      if (!confirma) return;
    }
    setGuardando(true);
    setError(null);
    try {
      let path: string;
      if (captura.storagePath) {
        path = captura.storagePath; // PDF ya subido durante la extracción
      } else {
        path = `${userId}/${crypto.randomUUID()}.jpg`;
        const blob = await (await fetch(captura.dataUrl)).blob();
        const up = await supabase.storage
          .from("notas")
          .upload(path, blob, { contentType: captura.mediaType });
        if (up.error) throw up.error;
      }

      const ins = await supabase.from("eventos").insert({
        conductor_id: userId,
        fornecedor: borrador.fornecedor || null,
        valor: borrador.valor || null,
        moeda: borrador.moeda || "BRL",
        valor_brl: valorBrlBorrador || null,
        cambio: moedaEstrangeira ? cambioNum : null,
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

      // Compra en moneda extranjera: se registra el IOF como una línea aparte
      // (misma foto, misma fecha/tarjeta/centro, categoría "IOF").
      if (moedaEstrangeira && iofBorrador > 0) {
        const iofIns = await supabase.from("eventos").insert({
          conductor_id: userId,
          fornecedor: `IOF — ${borrador.fornecedor}`,
          valor: iofBorrador,
          moeda: "BRL",
          valor_brl: iofBorrador,
          cambio: null,
          centro_custo: borrador.centro_custo,
          data_documento: borrador.data_documento || null,
          categoria: IOF_CATEGORIA,
          tipo_pagamento: borrador.tipo_pagamento,
          ultimos4: borrador.ultimos4 || null,
          descricao: `IOF de ${(IOF_TAXA * 100).toFixed(1).replace(".", ",")}% sobre compra internacional (${borrador.moeda} ${borrador.valor.toFixed(2)} × ${cambioNum})`,
          confianca: "alta",
          foto_path: path,
        });
        if (iofIns.error) {
          alert(
            "A nota foi salva, mas não foi possível criar a linha de IOF: " +
              iofIns.error.message,
          );
        }
      }

      await cargarTodo();
      limparEstado(); // NO borrar el archivo recién guardado
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
    // Cambio guardado en la nota; se conserva salvo que cambien moneda o fecha.
    setCambio(ev.cambio ? String(ev.cambio) : "");
    setCambioInfo(ev.cambio ? "Câmbio salvo com a nota" : null);
    claveCambioRef.current = ev.cambio
      ? `${ev.moeda ?? "BRL"}|${ev.data_documento ?? ""}`
      : null;
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
          valor_brl: valorBrlBorrador || null,
          cambio: moedaEstrangeira ? cambioNum : null,
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

  function limparEstado() {
    setEstado("inicio");
    setCaptura(null);
    setBorrador(BORRADOR_VACIO);
    setEditId(null);
    setFotoEditUrl(null);
    setError(null);
    setCambio("");
    setCambioInfo(null);
    claveCambioRef.current = null;
  }

  async function cancelar() {
    // Si había un PDF subido y no se guardó, lo borramos (no dejar huérfanos).
    if (captura?.storagePath) {
      await supabase.storage.from("notas").remove([captura.storagePath]);
    }
    limparEstado();
  }

  async function eliminar(ev: Evento) {
    if (!confirm("Excluir esta nota? Esta ação não pode ser desfeita.")) return;
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
              onClick={() => scanRef.current?.click()}
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
            <p className="note" style={{ marginTop: 8 }}>
              A foto é digitalizada automaticamente (nitidez e contraste). Nota
              comprida? Tire uma foto por parte — dá para adicionar quantas quiser
              antes de concluir.
            </p>

            {error && <div className="error-box">{error}</div>}

            {error && retentativaRef.current && (
              <>
                <button
                  className="btn btn-primary btn-block"
                  style={{ marginTop: 10 }}
                  onClick={tentarDeNovo}
                >
                  🔄 Tentar de novo (a nota ficou guardada)
                </button>
                <button
                  className="btn-ghost"
                  style={{ marginTop: 8 }}
                  onClick={descartarRetentativa}
                >
                  Descartar a nota guardada
                </button>
              </>
            )}
          </div>
        )}

        {estado === "scanner" && (
          <div className="card">
            <strong>📷 Fotos da nota</strong>
            <p className="note" style={{ marginTop: 4 }}>
              {paginas.length} foto{paginas.length === 1 ? "" : "s"} capturada
              {paginas.length === 1 ? "" : "s"}, já digitalizada
              {paginas.length === 1 ? "" : "s"}. Se a nota continua, tire mais uma
              foto da próxima parte; se acabou, conclua.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
              {paginas.map((p, i) => (
                <div key={i} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p}
                    alt={`página ${i + 1}`}
                    style={{
                      width: 84,
                      height: 112,
                      objectFit: "cover",
                      borderRadius: 8,
                      border: "1px solid #d0d5dd",
                    }}
                  />
                  <button
                    className="btn-ghost"
                    aria-label={`remover página ${i + 1}`}
                    onClick={() => removerPagina(i)}
                    style={{ position: "absolute", top: 0, right: 0 }}
                  >
                    ✕
                  </button>
                  <div className="note" style={{ textAlign: "center", margin: 0 }}>
                    pág. {i + 1}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="btn btn-light btn-block"
              style={{ marginTop: 12 }}
              onClick={() => scanRef.current?.click()}
            >
              ➕ Adicionar outra foto
            </button>
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 10 }}
              onClick={concluirScanner}
            >
              ✔️ Concluir ({paginas.length} foto{paginas.length === 1 ? "" : "s"}) e ler com IA
            </button>
            <button className="btn-ghost" style={{ marginTop: 8 }} onClick={cancelarScanner}>
              Cancelar
            </button>
            {error && <div className="error-box">{error}</div>}
          </div>
        )}

        {/* Inputs de arquivo: fora dos blocos de estado para funcionarem em todos */}
        <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={alElegir} />
        <input ref={pdfRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={alElegir} />
        <input ref={scanRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={alElegirScan} />

        {estado === "procesando" && (
          <div className="card">
            {previa()}
            <div className="status">
              <div className="spinner" />
              <div>
                <div>{fase || "Lendo o documento com IA…"}</div>
                <div className="note" style={{ margin: "2px 0 0" }}>
                  {segundos}s
                  {segundos >= 20 &&
                    " — a IA está mais lenta que o normal, só aguardar…"}
                </div>
              </div>
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
              <label>Fornecedor *</label>
              <input value={borrador.fornecedor} onChange={(e) => actualizar("fornecedor", e.target.value)} />
            </div>

            <div className="grid-2">
              <div className="field">
                <label>Valor *</label>
                <input
                  type="number"
                  step="0.01"
                  value={borrador.valor}
                  onChange={(e) => actualizar("valor", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="field">
                <label>Data *</label>
                <input
                  type="date"
                  value={borrador.data_documento}
                  onChange={(e) => actualizar("data_documento", e.target.value)}
                />
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>Moeda *</label>
                <select
                  value={borrador.moeda}
                  onChange={(e) => actualizar("moeda", e.target.value)}
                >
                  {(MOEDAS.includes(borrador.moeda)
                    ? MOEDAS
                    : [...MOEDAS, borrador.moeda]
                  ).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              {moedaEstrangeira && (
                <div className="field">
                  <label>Câmbio (1 {borrador.moeda} em R$) *</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={cambio}
                    placeholder={buscandoCambio ? "Buscando…" : "ex: 5,43"}
                    onChange={(e) => setCambio(e.target.value)}
                  />
                </div>
              )}
            </div>

            {moedaEstrangeira && (
              <div className="note" style={{ marginTop: 2 }}>
                {buscandoCambio
                  ? "Consultando o câmbio no Banco Central…"
                  : cambioInfo}
                {cambioNum > 0 && borrador.valor > 0 && (
                  <>
                    <br />
                    Valor convertido: <strong>R$ {valorBrlBorrador.toFixed(2)}</strong>
                    {!editando && (
                      <>
                        {" "}· Será criada automaticamente uma linha de IOF (
                        {(IOF_TAXA * 100).toFixed(1).replace(".", ",")}%):{" "}
                        <strong>R$ {iofBorrador.toFixed(2)}</strong>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

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
              <label>Descrição *</label>
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
            <div className="field">
              <label>Categoria</label>
              <select
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
              >
                <option value="todos">Todas</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.nome}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field" style={{ marginTop: 8 }}>
            <label>🔎 Buscar (fornecedor ou valor)</label>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="ex: LAVANDERIA  ou  200"
            />
          </div>
          <div className="row" style={{ marginTop: 8, alignItems: "flex-end", gap: 8 }}>
            <div className="field" style={{ marginTop: 0, flex: 1 }}>
              <label>Ordenar por</label>
              <select value={ordenarCol} onChange={(e) => setOrdenarCol(e.target.value)}>
                <option value="data">Data</option>
                <option value="valor">Valor</option>
                <option value="fornecedor">Fornecedor</option>
                <option value="categoria">Categoria</option>
                <option value="centro">Centro de custo</option>
              </select>
            </div>
            <button
              type="button"
              className="btn btn-light"
              onClick={() => setOrdenarDir((d) => (d === 1 ? -1 : 1))}
              title="Inverter ordem"
            >
              {ordenarDir === 1 ? "▲ Asc" : "▼ Desc"}
            </button>
          </div>

          <p className="note">
            Total do período: <strong>R$ {total.toFixed(2)}</strong>
          </p>

          {eventosFiltrados.length === 0 ? (
            <p className="note">Nenhuma nota neste mês.</p>
          ) : (
            <div className="lista-scroll">
              {eventosOrdenados.map((ev) => {
                const editavel = dentroDePlazo(ev.criado_em);
                return (
                  <div key={ev.id} className="evento">
                  <div className="top">
                    <span className="fornecedor">{ev.fornecedor || "(sem fornecedor)"}</span>
                    <span className="valor">
                      R$ {valorBRL(ev).toFixed(2)}
                      {ev.moeda && ev.moeda !== "BRL" && (
                        <span className="note" style={{ margin: 0, display: "block", textAlign: "right" }}>
                          {ev.moeda} {Number(ev.valor ?? 0).toFixed(2)}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="meta">
                    <span className="codigo">{codigoId(ev.id)}</span>{" "}
                    {ev.data_documento || "sem data"} · {ev.centro_custo || "—"} ·{" "}
                    {ev.categoria || "—"} · {ev.ultimos4 ? `••${ev.ultimos4}` : "—"}
                  </div>
                  {ev.descricao && (
                    <div className="note" style={{ marginTop: 6, marginBottom: 0, whiteSpace: "pre-wrap" }}>
                      💬 {ev.descricao}
                    </div>
                  )}
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
                        🔒 Edição bloqueada (mais de 30 dias) — leitura liberada
                      </span>
                    )}
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

/**
 * Nota já lançada com mesmo fornecedor, data, valor e cartão = possível
 * duplicata (ex.: o mesmo cupom fotografado duas vezes). A lista `eventos`
 * do usuário só contém as notas dele (RLS), então a comparação é local.
 */
function achaDuplicata(eventos: Evento[], b: Borrador): Evento | undefined {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  return eventos.find(
    (e) =>
      norm(e.fornecedor) === norm(b.fornecedor) &&
      (e.data_documento ?? "") === b.data_documento &&
      Math.abs(Number(e.valor ?? 0) - b.valor) < 0.005 &&
      (e.ultimos4 ?? "") === b.ultimos4,
  );
}

/** Mensagem amigável quando a CONEXÃO cai no meio da leitura. */
const MSG_REDE =
  "A conexão falhou no meio da leitura (sinal fraco?). A nota ficou guardada — " +
  "toque em “Tentar de novo” quando o sinal voltar.";

/**
 * Erro de REDE (não de dados): no iPhone aparece como "Load failed", no
 * Android/desktop como "Failed to fetch". Acontece com sinal fraco ou quando
 * o app vai para segundo plano durante a leitura.
 */
function ehErroDeRede(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const m = err instanceof Error ? err.message : String(err);
  return /load failed|failed to fetch|network|abort|timed? ?out/i.test(m);
}

/**
 * Detecta o tipo REAL do arquivo pelos primeiros bytes (assinatura), porque no
 * Android arquivos vindos de apps de scanner/Drive/WhatsApp chegam com o MIME
 * vazio ou genérico — e um PDF válido era recusado como "formato não suportado".
 */
async function detectarTipoArquivo(file: File): Promise<"pdf" | "imagem" | "desconhecido"> {
  const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (i: number, n: number) =>
    String.fromCharCode(...Array.from(buf.slice(i, i + n)));
  if (ascii(0, 4) === "%PDF") return "pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "imagem"; // JPEG
  if (buf[0] === 0x89 && ascii(1, 3) === "PNG") return "imagem"; // PNG
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "imagem"; // WebP
  if (ascii(0, 3) === "GIF") return "imagem"; // GIF
  if (ascii(4, 4) === "ftyp") return "imagem"; // HEIC/HEIF/AVIF
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "imagem"; // BMP
  // Reserva: o rótulo informado pelo celular e a extensão do nome.
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("image/")) return "imagem";
  return "desconhecido";
}

/** Monta um PDF (uma página por foto) no próprio celular — modo scanner. */
async function paginasParaPdf(paginas: string[]): Promise<File> {
  const { jsPDF } = await import("jspdf");
  let pdf: import("jspdf").jsPDF | null = null;
  for (const dataUrl of paginas) {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Falha ao carregar uma das páginas."));
      im.src = dataUrl;
    });
    const w = img.naturalWidth || 1240;
    const h = img.naturalHeight || 1754;
    const orient = w >= h ? "landscape" : "portrait";
    if (!pdf) pdf = new jsPDF({ orientation: orient, unit: "px", format: [w, h] });
    else pdf.addPage([w, h], orient);
    pdf.addImage(dataUrl, "JPEG", 0, 0, w, h);
  }
  if (!pdf) throw new Error("Nenhuma página capturada.");
  return new File([pdf.output("blob")], "nota_multipagina.pdf", {
    type: "application/pdf",
  });
}

async function redimensionar(file: File, maxDim = 1600, calidad = 0.85): Promise<string> {
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
  aplicarEfeitoScanner(ctx, w, h);
  return canvas.toDataURL("image/jpeg", calidad);
}

/**
 * Efeito "digitalizado" automático (o motivo de usarem CamScanner): tons de
 * cinza, contraste esticado por percentis (papel → branco, tinta → preto) e
 * nitidez leve. Também ajuda a IA a ler fotos escuras/amareladas.
 */
function aplicarEfeitoScanner(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  const n = w * h;

  // luminância de cada pixel + histograma
  const lum = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const l = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
    lum[i] = l;
    hist[l]++;
  }

  // percentis 3%/97% → estica o contraste ignorando extremos (sombras/reflexos)
  let acc = 0;
  let p3 = 0;
  let p97 = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.03) { p3 = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= n * 0.03) { p97 = v; break; }
  }
  const faixa = Math.max(16, p97 - p3);
  const mapa = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    mapa[v] = Math.max(0, Math.min(255, Math.round(((v - p3) * 255) / faixa)));
  }
  const cinza = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) cinza[i] = mapa[lum[i]];

  // nitidez suave (máscara 3x3 a 50%) e gravação em tons de cinza
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = cinza[i];
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        const nitido =
          5 * cinza[i] - cinza[i - 1] - cinza[i + 1] - cinza[i - w] - cinza[i + w];
        v = (Math.max(0, Math.min(255, nitido)) + cinza[i]) >> 1;
      }
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(im, 0, 0);
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
