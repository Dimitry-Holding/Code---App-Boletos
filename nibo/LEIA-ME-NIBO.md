# 🧾 Integração com o Nibo (fase de testes controlados)

Fluxo em **duas etapas com revisão humana no meio** — nada vai para o Nibo sem conferência:

```
App (admin) ──🧾 Excel Nibo──▶ revisão/ajuste no Excel ──lancar-nibo.bat──▶ Nibo (API)
```

## Etapa 1 — Gerar o Excel no app
Na tela do administrador, filtre o período desejado e clique em **🧾 Excel Nibo**.
O arquivo `nibo_lancamentos_<de>_a_<até>.xlsx` traz 3 abas:
- **Lancamentos** — **uma linha = um lançamento** (únicos);
- **Instrucoes** — como revisar;
- **CategoriasNibo** — as categorias que **existem** no Nibo (fonte: planilha da
  administração, versionada em `nibo/categorias-nibo.json`).

Pontos do formato:
| Coluna | O que é |
|---|---|
| `Cartão` | O cartão em que o gasto foi feito (ex.: `Santander 5765`). **É ele o "fornecedor" do lançamento no Nibo.** |
| `Data` | Data da compra (vira a **competência** no Nibo). |
| `Vencimento` | Data de vencimento da **fatura** em que a compra cai (vira vencimento/agendamento no Nibo). Compra **depois** do dia de vencimento do cartão vai para o mês seguinte — ex.: vencimento dia 15, compra dia 16/03 → vence 15/04. Calculada com o **dia de vencimento cadastrado no cartão** (tela 👥 Usuários → 📅). |
| `Categoria (Nibo)` | Só aceita categoria **existente** no Nibo. Vem preenchida quando o nome do app casa com a lista; senão fica **vazia** — escolha na aba CategoriasNibo. |
| `Centro de custo (Nibo)` | Nome exato como está no Nibo. |
| `Enviar` | `SIM` envia; `NÃO` pula a linha. |

> ⚠️ **Confira as datas**: notas com data lida errada pela IA (ex.: ano 2018) são
> recusadas pelo script (aceita de 2025-01-01 até hoje) — corrija na coluna `Data`.

É possível **juntar linhas** num lançamento só repetindo o código na coluna
`Lançamento`. Regras que o script exige num lançamento com 2+ partidas:
mesmo cartão/data/vencimento em todas as linhas; **ou** 1 centro de custo com 2+
categorias (tipo II), **ou** 2+ centros com 1 categoria (tipo III).
🚫 **Proibido:** 2+ centros de custo **e** 2+ categorias no mesmo lançamento.

## Etapa 2 — Lançar no Nibo (`lancar-nibo.bat`)
Dê dois cliques em `nibo\lancar-nibo.bat`. O menu tem 3 modos, **use nesta ordem**:

1. **CONFERIR** — valida tudo (inclusive categorias contra a lista) e mostra o que
   seria enviado. **Não toca no Nibo.**
2. **TESTE** — valida o token criando no Nibo um fornecedor e um lançamento de R$ 0,01
   e **apagando os dois em seguida** (não existe ambiente de testes no Nibo; este modo
   é a forma segura de provar que a conexão funciona sem sujar os dados).
3. **ENVIAR** — cria os lançamentos de verdade, como **agendados** (não pagos), após
   você digitar `ENVIAR`. Cartões que ainda não existem como fornecedor no Nibo são
   **criados automaticamente**. Rodar duas vezes **não duplica**: cada lançamento leva
   uma referência única (`APPBOLETOS-DMT-…`) e os já existentes são pulados.

Cada execução salva um relatório `nibo_resultado_<data>.txt` na pasta atual.

### Token da API (preencher uma única vez)
O Nibo exige um token **por empresa**: **Sua Empresa → Mais opções → Configurações → API**.
Duas formas de configurar (a 2ª é a recomendada porque o projeto é público no GitHub):
1. Editar `lancar-nibo.bat` no Bloco de Notas e preencher `set "NIBO_APITOKEN=…"`; **ou**
2. Criar um arquivo `nibo\token.txt` contendo **só o token** (este arquivo está no
   `.gitignore` e nunca sobe para o GitHub).

> O token define **em qual empresa** do Nibo os lançamentos entram (Grupo Dimitry,
> Andrey PF, etc.). Troque o token para lançar em outra empresa.

### Pré-requisitos
- Rodar a migração `supabase/migration_5.sql` (adiciona o **dia de vencimento** ao
  cartão) e cadastrar o dia de cada cartão na tela 👥 Usuários (botão 📅).
- Os **centros de custo** usados precisam existir no Nibo com o nome exato.
- Para atualizar a lista de categorias: regerar `nibo/categorias-nibo.json` a partir
  da planilha de categorias da administração.
