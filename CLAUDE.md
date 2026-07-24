# CLAUDE.md — App Notas Fiscais (Dimitry)

> Este arquivo é lido automaticamente pelo Claude Code no início de cada sessão.
> Ele é o "cérebro" do repasse: quem assumir o projeto tem aqui o contexto e as tarefas pendentes.

## Idioma
Responder **sempre em português do Brasil (pt-BR)**. A interface do app também é em português.

## O que é o projeto
App web (Next.js) onde funcionários da Dimitry com cartão corporativo **fotografam notas
fiscais/cupons/boletos**; uma **IA (Google Gemini)** lê a imagem e extrai os dados; o
funcionário confere e salva; a **administração** baixa relatórios em **Excel** e as **fotos**
por período. Objetivo original: facilitar a classificação depois no **Nibo** (integração ainda
não feita — é uma melhoria futura).

## Stack
- **Next.js 16** (App Router) + React 19 + TypeScript
- **Google Gemini** (nível gratuito) — leitura das imagens/PDFs
- **Supabase** — Postgres (dados) + Auth (login) + Storage (fotos), com **RLS** (segurança por papel)
- **Vercel** — hospedagem; **deploy automático** a cada `git push` na branch `main`
- **GitHub** — repositório `LuisL-Dimitry/Code---App-Boletos`
- Bibliotecas: `xlsx` (Excel), `jszip` (ZIP de fotos)

## Papéis
- **Usuário (conductor):** só vê/cria/edita/apaga as próprias notas (edição liberada por 30 dias).
- **Supervisor:** vê relatórios só dos usuários atribuídos a ele; não edita/apaga/gerencia.
- **Admin:** vê tudo, exporta tudo, gerencia usuários/cartões/categorias/centros de custo.

## Arquivos-chave
- `lib/evento.ts` — ⭐ regras de negócio: tipos, valor em R$, **IOF (3,5%)**, moedas, nome de
  arquivo das fotos, colunas do Excel.
- `app/components/ConductorApp.tsx` — tela do usuário (capturar, revisar, salvar, editar).
- `app/components/AdminApp.tsx` — tela do admin/supervisor (tabela, filtros, Excel, ZIP).
- `app/components/GestaoUsuarios.tsx` — gestão de usuários/cartões/categorias/centros.
- `app/api/extract/route.ts` — chama o Gemini (com fallback de modelo se estourar cota).
- `app/api/cambio/route.ts` — cotação **PTAX do Banco Central** para converter moeda em R$.
- `app/api/admin/users/route.ts` — cria/edita usuários (protegido: só admin).
- `supabase/schema.sql` + `migration_2/3/4.sql` — estrutura do banco (rodar no Supabase SQL Editor).
- `docs/ENTREGA.md` — checklist de repasse. `docs/DESARROLLO.md` — trabalhar de outro PC.

## Como rodar
```bash
npm install
# criar .env.local com as 5 chaves (ver .env.local.example)
npm run dev            # http://localhost:3000
```
Publicar = `git push origin main` (a Vercel faz o deploy sozinha).

## Variáveis de ambiente (.env.local, NÃO vai pro Git)
`GEMINI_API_KEY`, `GEMINI_MODEL` (opcional; default no código = `gemini-flash-latest`),
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## Convenções / regras invioláveis
- **NUNCA** commitar segredos. `.env.local` e `USUARIOS_Y_CONTRASENAS.txt` estão no `.gitignore`.
- **Nunca** colar chaves no chat; editar o `.env.local` direto.
- Mensagens de commit em espanhol/português; terminar com a linha `Co-Authored-By`.
- No Windows, cuidado com o limite de 260 caracteres de caminho (por isso o nome do arquivo
  das fotos é encurtado em `lib/evento.ts`).

## Funcionalidades recentes (já em produção)
- Conversão de moeda estrangeira → R$ via PTAX (guarda `valor_brl` e `cambio` em `eventos`).
- Linha de **IOF automática** (3,5%, categoria "IOF") ao salvar compra em moeda estrangeira.
- **Campos obrigatórios**: não salva sem fornecedor, valor, data, centro, cartão, categoria e descrição.
- Segurança validada: 20 testes de RLS por papel passaram em produção.

## ⚠️ TAREFAS PENDENTES DE REPASSE (o responsável anterior saiu da Dimitry)
Objetivo: tirar tudo de contas pessoais e passar para contas Dimitry, rotacionando as chaves.
Fazer nesta ordem por causa das dependências:

1. **GitHub** — transferir o repo `LuisL-Dimitry/Code---App-Boletos` para uma org/conta Dimitry
   (ou adicionar a nova pessoa como admin). Se transferir, reconectar o projeto na Vercel.
2. **Supabase** — transferir o projeto `rvrbogroafidhtuwfljo` para uma org Dimitry (ou virar
   Owner). Rotacionar as chaves de API (anon/service_role). **Ao rotacionar, atualizar as 3
   variáveis na Vercel e no `.env.local`** — senão o app para de conectar.
3. **Vercel** — projeto na org `dimitry-holding`; garantir que um admin Dimitry tenha acesso.
   Atualizar as env vars com as chaves novas do Supabase → **Redeploy**.
4. **Google Gemini** — a chave atual pode estar numa conta Google **pessoal** (será desativada
   ~fim de agosto/2026). Criar chave nova numa conta Dimitry em aistudio.google.com/apikey,
   trocar `GEMINI_API_KEY` na Vercel + `.env.local`, e só então apagar a antiga.
5. **App** — trocar a senha do admin e criar um admin real da Dimitry (tela 👥 Usuários).
6. **Limpeza** — atualizar o `README.md` (está descrevendo a versão antiga do app).

Detalhes e telas em `docs/ENTREGA.md`.

## Melhorias sugeridas (roadmap)
Atualizar README; exportação para o Nibo; recalcular IOF ao editar nota; dashboard de gastos
(totais/gráficos por centro e mês); testes automatizados; backup periódico do Supabase.
