"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { buscarEventos } from "@/lib/eventos-query";
import TopBar from "./TopBar";

/** Só as colunas que o dashboard usa (a tabela de notas tem bem mais). */
type Linha = {
  id: number;
  conductor_id: string;
  fornecedor: string | null;
  valor: number | null;
  valor_brl: number | null;
  centro_custo: string | null;
  categoria: string | null;
  data_documento: string | null;
  criado_em: string;
};
const COLUNAS =
  "id,conductor_id,fornecedor,valor,valor_brl,centro_custo,categoria,data_documento,criado_em";

type Grupo = { nome: string; valor: number; notas: number };
type Balde = Grupo & { chave: string; rotulo: string };
type Dica = { x: number; y: number; titulo: string; valor: string; extra: string };

const PRESETS = [
  { id: "mes", rotulo: "Este mês" },
  { id: "mes_passado", rotulo: "Mês passado" },
  { id: "3m", rotulo: "Últimos 3 meses" },
  { id: "6m", rotulo: "Últimos 6 meses" },
  { id: "ano", rotulo: "Este ano" },
] as const;
type PresetId = (typeof PRESETS)[number]["id"] | "outro";

const MESES_CURTOS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compacto = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function iso(ano: number, mes0: number, dia: number): string {
  const d = new Date(ano, mes0, dia);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function periodoDoPreset(p: PresetId): { inicio: string; fim: string } {
  const h = new Date();
  const a = h.getFullYear();
  const m = h.getMonth();
  const hoje = iso(a, m, h.getDate());
  switch (p) {
    case "mes_passado":
      return { inicio: iso(a, m - 1, 1), fim: iso(a, m, 0) };
    case "3m":
      return { inicio: iso(a, m - 2, 1), fim: hoje };
    case "6m":
      return { inicio: iso(a, m - 5, 1), fim: hoje };
    case "ano":
      return { inicio: iso(a, 0, 1), fim: hoje };
    default:
      return { inicio: iso(a, m, 1), fim: hoje };
  }
}

const valorDe = (l: Linha) => Number(l.valor_brl ?? l.valor ?? 0);
const diaDe = (l: Linha) => (l.data_documento || l.criado_em || "").slice(0, 10);
const brData = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");

/** Junta grafias que diferem só em maiúsculas, acentos ou espaços. */
function chaveNome(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Soma por nome, maior primeiro; além de `max` linhas, o resto vira "Outras". */
function agrupar(linhas: Linha[], nomeDe: (l: Linha) => string, max = 8): Grupo[] {
  const mapa = new Map<string, Grupo & { grafias: Map<string, number> }>();
  for (const l of linhas) {
    const nome = nomeDe(l);
    const k = chaveNome(nome);
    const g = mapa.get(k) ?? { nome, valor: 0, notas: 0, grafias: new Map() };
    g.valor += valorDe(l);
    g.notas += 1;
    g.grafias.set(nome, (g.grafias.get(nome) ?? 0) + 1);
    mapa.set(k, g);
  }
  const grupos = [...mapa.values()]
    .map((g) => ({
      // mostra a grafia mais usada
      nome: [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0],
      valor: g.valor,
      notas: g.notas,
    }))
    .sort((a, b) => b.valor - a.valor);
  if (grupos.length <= max) return grupos;
  const resto = grupos.slice(max - 1);
  return [
    ...grupos.slice(0, max - 1),
    {
      nome: `Outras (${resto.length})`,
      valor: resto.reduce((s, g) => s + g.valor, 0),
      notas: resto.reduce((s, g) => s + g.notas, 0),
    },
  ];
}

/** Série no tempo: por dia em períodos curtos, por mês nos longos. Inclui os vazios. */
function serieNoTempo(linhas: Linha[], inicio: string, fim: string): { baldes: Balde[]; porDia: boolean } {
  const dias = linhas.map(diaDe).filter(Boolean).sort();
  const de = inicio || dias[0] || "";
  const ate = fim || dias[dias.length - 1] || "";
  if (!de || !ate || de > ate) return { baldes: [], porDia: true };

  const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const totalDias = Math.round((utc(ate) - utc(de)) / 86400000) + 1;
  const porDia = totalDias <= 45;
  const variosAnos = de.slice(0, 4) !== ate.slice(0, 4);

  const baldes: Balde[] = [];
  if (porDia) {
    for (let t = utc(de); t <= utc(ate); t += 86400000) {
      const chave = new Date(t).toISOString().slice(0, 10);
      baldes.push({ chave, rotulo: String(+chave.slice(8, 10)), nome: brData(chave), valor: 0, notas: 0 });
    }
  } else {
    let a = +de.slice(0, 4);
    let m = +de.slice(5, 7);
    const fimChave = ate.slice(0, 7);
    for (;;) {
      const chave = `${a}-${String(m).padStart(2, "0")}`;
      baldes.push({
        chave,
        rotulo: MESES_CURTOS[m - 1] + (variosAnos ? `/${String(a).slice(2)}` : ""),
        nome: `${MESES_CURTOS[m - 1]}/${a}`,
        valor: 0,
        notas: 0,
      });
      if (chave >= fimChave) break;
      m += 1;
      if (m > 12) {
        m = 1;
        a += 1;
      }
    }
  }
  const indice = new Map(baldes.map((b, i) => [b.chave, i]));
  for (const l of linhas) {
    const i = indice.get(porDia ? diaDe(l) : diaDe(l).slice(0, 7));
    if (i === undefined) continue;
    baldes[i].valor += valorDe(l);
    baldes[i].notas += 1;
  }
  return { baldes, porDia };
}

/** Eixo com números redondos e uma folga acima da maior coluna. */
function eixoRedondo(maximo: number): { topo: number; marcas: number[] } {
  if (maximo <= 0) return { topo: 1, marcas: [0] };
  const bruto = (maximo * 1.12) / 4;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const f = bruto / pot;
  const passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pot;
  const topo = Math.ceil((maximo * 1.12) / passo) * passo;
  const marcas: number[] = [];
  for (let v = 0; v <= topo + passo / 2; v += passo) marcas.push(v);
  return { topo, marcas };
}

const notasTxt = (n: number) => `${n} nota${n === 1 ? "" : "s"}`;

export default function DashboardApp({ nome }: { nome: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [preset, setPreset] = useState<PresetId>("mes");
  const [inicio, setInicio] = useState(() => periodoDoPreset("mes").inicio);
  const [fim, setFim] = useState(() => periodoDoPreset("mes").fim);
  const [usuario, setUsuario] = useState("todos");

  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [perfis, setPerfis] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [dica, setDica] = useState<Dica | null>(null);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, nome")
      .then(({ data }) => {
        const mapa: Record<string, string> = {};
        ((data as { id: string; nome: string }[]) ?? []).forEach((p) => (mapa[p.id] = p.nome));
        setPerfis(mapa);
      });
  }, [supabase]);

  useEffect(() => {
    let cancelado = false;
    const t = setTimeout(async () => {
      setAtualizando(true);
      try {
        const dados = await buscarEventos<Linha>(supabase, { inicio, fim, colunas: COLUNAS });
        if (cancelado) return;
        setLinhas(dados);
        setFalha(null);
      } catch (err) {
        if (!cancelado) setFalha(err instanceof Error ? err.message : "erro");
      } finally {
        if (!cancelado) {
          setCarregando(false);
          setAtualizando(false);
        }
      }
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [supabase, inicio, fim]);

  function escolherPreset(p: PresetId) {
    const per = periodoDoPreset(p);
    setPreset(p);
    setInicio(per.inicio);
    setFim(per.fim);
  }

  const nomeUsuario = (id: string) => perfis[id] ?? id.slice(0, 8);

  const usuariosNoPeriodo = useMemo(() => {
    const ids = new Set(linhas.map((l) => l.conductor_id));
    if (usuario !== "todos") ids.add(usuario);
    return [...ids].map((id) => ({ id, nome: perfis[id] ?? id.slice(0, 8) }));
  }, [linhas, perfis, usuario]);

  const dados = useMemo(
    () =>
      linhas.filter((l) => {
        const dia = diaDe(l);
        if (inicio && dia < inicio) return false;
        if (fim && dia > fim) return false;
        return usuario === "todos" || l.conductor_id === usuario;
      }),
    [linhas, inicio, fim, usuario],
  );

  const total = dados.reduce((s, l) => s + valorDe(l), 0);
  const maior = dados.reduce<Linha | null>(
    (m, l) => (m === null || valorDe(l) > valorDe(m) ? l : m),
    null,
  );
  const usuariosAtivos = new Set(dados.map((l) => l.conductor_id)).size;

  const { baldes, porDia } = useMemo(() => serieNoTempo(dados, inicio, fim), [dados, inicio, fim]);
  const porCentro = useMemo(() => agrupar(dados, (l) => l.centro_custo || "Sem centro de custo"), [dados]);
  const porCategoria = useMemo(() => agrupar(dados, (l) => l.categoria || "Sem categoria"), [dados]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const porUsuario = useMemo(() => agrupar(dados, (l) => nomeUsuario(l.conductor_id)), [dados, perfis]);

  const maxBalde = Math.max(0, ...baldes.map((b) => b.valor));
  const { topo, marcas } = eixoRedondo(maxBalde);
  const iMaior = baldes.findIndex((b) => b.valor === maxBalde && maxBalde > 0);
  // rótulos do eixo X: todos quando cabem; senão, de N em N
  const passoRotulo = Math.max(1, Math.ceil(baldes.length / 12));

  /** Liga a dica (hover/foco) a qualquer marca do gráfico. */
  function dicaDe(g: Grupo) {
    const conteudo = {
      titulo: g.nome,
      valor: moeda.format(g.valor),
      extra:
        notasTxt(g.notas) +
        (total > 0 ? ` · ${((g.valor / total) * 100).toFixed(1).replace(".", ",")}% do período` : ""),
    };
    return {
      tabIndex: 0,
      "aria-label": `${g.nome}: ${conteudo.valor}, ${conteudo.extra}`,
      onPointerMove: (e: React.PointerEvent) => setDica({ x: e.clientX, y: e.clientY, ...conteudo }),
      onPointerLeave: () => setDica(null),
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        setDica({ x: r.left + r.width / 2, y: r.top, ...conteudo });
      },
      onBlur: () => setDica(null),
    };
  }

  // Função comum (não um componente): assim as linhas não são recriadas a cada
  // movimento do mouse, o que faria a dica piscar e o foco se perder.
  function listaBarras(itens: Grupo[]) {
    const max = Math.max(0, ...itens.map((g) => g.valor));
    if (itens.length === 0) return <p className="note">Sem notas neste período.</p>;
    return (
      <div className="dz-lista">
        {itens.map((g) => (
          <div key={g.nome} className="dz-linha" {...dicaDe(g)}>
            <span className="dz-nome" title={g.nome}>
              {g.nome}
            </span>
            <span className="dz-trilho">
              <span
                className="dz-barra"
                style={{ width: max > 0 ? `${Math.max((g.valor / max) * 100, 0.8)}%` : 0 }}
              />
            </span>
            <span className="dz-valor">{moeda.format(g.valor)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <TopBar nome={nome} papel="Administrador" />
      <main className="wrap wrap-wide dz-root">
        <div className="section-title">
          <Link href="/" className="btn-ghost">
            ← Notas
          </Link>
          <span>Dashboard de gastos</span>
        </div>

        {/* Filtros: uma linha só, acima de tudo que eles afetam */}
        <div className="card">
          <div className="dz-presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`dz-chip${preset === p.id ? " ativo" : ""}`}
                aria-pressed={preset === p.id}
                onClick={() => escolherPreset(p.id)}
              >
                {p.rotulo}
              </button>
            ))}
          </div>
          <div className="filters" style={{ marginTop: 12 }}>
            <div className="field">
              <label>De</label>
              <input
                type="date"
                value={inicio}
                onChange={(e) => {
                  setPreset("outro");
                  setInicio(e.target.value);
                }}
              />
            </div>
            <div className="field">
              <label>Até</label>
              <input
                type="date"
                value={fim}
                onChange={(e) => {
                  setPreset("outro");
                  setFim(e.target.value);
                }}
              />
            </div>
            <div className="field">
              <label>Usuário</label>
              <select value={usuario} onChange={(e) => setUsuario(e.target.value)}>
                <option value="todos">Todos</option>
                {usuariosNoPeriodo.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {falha && (
          <div className="error-box">Não foi possível carregar os dados ({falha}).</div>
        )}

        {carregando ? (
          <div className="card status">
            <div className="spinner" />
            <div>Carregando…</div>
          </div>
        ) : (
          <div style={{ opacity: atualizando ? 0.5 : 1, transition: "opacity 0.15s" }}>
            {/* Indicadores */}
            <div className="dz-kpis">
              <div className="card dz-kpi">
                <div className="dz-kpi-rotulo">Total gasto</div>
                <div className="dz-kpi-valor">{moeda.format(total)}</div>
                <div className="dz-kpi-sub">
                  {brData(inicio)} a {brData(fim)}
                </div>
              </div>
              <div className="card dz-kpi">
                <div className="dz-kpi-rotulo">Notas lançadas</div>
                <div className="dz-kpi-valor">{dados.length}</div>
                <div className="dz-kpi-sub">
                  {usuariosAtivos} usuário{usuariosAtivos === 1 ? "" : "s"}
                </div>
              </div>
              <div className="card dz-kpi">
                <div className="dz-kpi-rotulo">Valor médio por nota</div>
                <div className="dz-kpi-valor">
                  {moeda.format(dados.length ? total / dados.length : 0)}
                </div>
                <div className="dz-kpi-sub">total ÷ notas</div>
              </div>
              <div className="card dz-kpi">
                <div className="dz-kpi-rotulo">Maior nota</div>
                <div className="dz-kpi-valor">{moeda.format(maior ? valorDe(maior) : 0)}</div>
                <div className="dz-kpi-sub" title={maior?.fornecedor ?? ""}>
                  {maior ? `${maior.fornecedor ?? "sem fornecedor"} · ${brData(diaDe(maior))}` : "—"}
                </div>
              </div>
            </div>

            {/* Gasto no tempo */}
            <div className="card">
              <div className="dz-titulo">Gasto por {porDia ? "dia" : "mês"}</div>
              <div className="dz-sub">Em reais, pela data da nota</div>
              {baldes.length === 0 || maxBalde === 0 ? (
                <p className="note">Sem notas neste período.</p>
              ) : (
                <>
                  <div className="dz-grafico">
                    <div className="dz-eixo-y">
                      {marcas.map((v) => (
                        <span key={v} style={{ bottom: `${(v / topo) * 100}%` }}>
                          {compacto.format(v)}
                        </span>
                      ))}
                    </div>
                    <div className="dz-area">
                      {marcas.map((v) => (
                        <div
                          key={v}
                          className={`dz-grade${v === 0 ? " base" : ""}`}
                          style={{ bottom: `${(v / topo) * 100}%` }}
                        />
                      ))}
                      <div className="dz-colunas">
                        {baldes.map((b, i) => (
                          <div key={b.chave} className="dz-vaga" role="img" {...dicaDe(b)}>
                            {i === iMaior && (
                              <span className="dz-topo">{moeda.format(b.valor)}</span>
                            )}
                            <div
                              className="dz-coluna"
                              style={{
                                height:
                                  b.valor > 0 ? `max(2px, ${(b.valor / topo) * 100}%)` : 0,
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div />
                    <div className="dz-eixo-x">
                      {baldes.map((b, i) => (
                        <span key={b.chave}>{i % passoRotulo === 0 ? b.rotulo : ""}</span>
                      ))}
                    </div>
                  </div>
                  <details className="dz-detalhes">
                    <summary>Ver valores em tabela</summary>
                    <table>
                      <thead>
                        <tr>
                          <th>{porDia ? "Dia" : "Mês"}</th>
                          <th className="num">Valor</th>
                          <th className="num">Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {baldes.map((b) => (
                          <tr key={b.chave}>
                            <td>{b.nome}</td>
                            <td className="num">{moeda.format(b.valor)}</td>
                            <td className="num">{b.notas}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </>
              )}
            </div>

            <div className="dz-duas">
              <div className="card">
                <div className="dz-titulo">Por centro de custo</div>
                <div className="dz-sub">Total do período, maior primeiro</div>
                {listaBarras(porCentro)}
              </div>
              <div className="card">
                <div className="dz-titulo">Por usuário</div>
                <div className="dz-sub">Total do período, maior primeiro</div>
                {listaBarras(porUsuario)}
              </div>
            </div>

            <div className="card">
              <div className="dz-titulo">Por categoria</div>
              <div className="dz-sub">
                As 7 maiores; o restante aparece somado em “Outras”
              </div>
              {listaBarras(porCategoria)}
            </div>
          </div>
        )}

        {dica && (
          <div
            className="dz-dica"
            role="status"
            style={{
              left: Math.max(8, Math.min(dica.x + 14, window.innerWidth - 236)),
              top: Math.max(8, dica.y - 74),
            }}
          >
            <strong>{dica.valor}</strong>
            <span>{dica.titulo}</span>
            <span className="dz-dica-extra">{dica.extra}</span>
          </div>
        )}
      </main>
    </>
  );
}
