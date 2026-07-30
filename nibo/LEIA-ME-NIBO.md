# 🧾 Integração com o Nibo (fase de testes controlados)

Fluxo em **duas etapas com revisão humana no meio** — nada vai para o Nibo sem conferência:

```
App (admin) ──🧾 Excel Nibo──▶ revisão/ajuste no Excel ──lancar-nibo.bat──▶ Nibo (API)
```

## Etapa 1 — Gerar o Excel no app
Na tela do administrador, filtre o período desejado e clique em **🧾 Excel Nibo**.
O arquivo `nibo_lancamentos_<de>_a_<até>.xlsx` traz:
- Aba **Lancamentos** — uma linha por partida, com um agrupamento **proposto**
  (notas do mesmo fornecedor, mesma data e mesmo cartão viram um lançamento).
- Aba **Instrucoes** — como revisar.

Colunas que a pessoa revisa:
| Coluna | O que fazer |
|---|---|
| `Lançamento` | Código do grupo (L001…). Mude para juntar/separar linhas num mesmo lançamento. |
| `Enviar` | `SIM` envia; `NÃO` pula a linha. |
| `Categoria (Nibo)` / `Centro de custo (Nibo)` | Escreva o nome **exato** como está no Nibo (os nomes do app são diferentes — as colunas “(app)” são só referência). |
| `CNPJ/CPF` | Opcional; usado se o fornecedor precisar ser criado no Nibo. |

### Regras de um lançamento (o script recusa o que violar)
- **I** — 1 partida: 1 centro de custo, 1 categoria
- **II** — 2+ partidas: **1 centro de custo**, 2+ categorias
- **III** — 2+ partidas: 2+ centros de custo, **1 categoria**
- 🚫 **Proibido:** 2+ centros de custo **e** 2+ categorias no mesmo lançamento.
- Todas as partidas de um lançamento: mesmo fornecedor e mesma data.

## Etapa 2 — Lançar no Nibo (`lancar-nibo.bat`)
Dê dois cliques em `nibo\lancar-nibo.bat`. O menu tem 3 modos, **use nesta ordem**:

1. **CONFERIR** — lê o Excel, valida tudo e mostra o que seria enviado. **Não toca no Nibo.**
2. **TESTE** — valida o token criando no Nibo um fornecedor e um lançamento de R$ 0,01
   e **apagando os dois em seguida** (não existe ambiente de testes no Nibo; este modo
   é a forma segura de provar que a conexão funciona sem sujar os dados).
3. **ENVIAR** — cria os lançamentos de verdade, como **agendados** (não pagos), após
   você digitar `ENVIAR`. Fornecedores que não existem no Nibo são **criados
   automaticamente**. Rodar duas vezes **não duplica**: cada lançamento leva uma
   referência única (`APPBOLETOS-DMT-…`) e os já existentes são pulados.

Cada execução salva um relatório `nibo_resultado_<data>.txt` na pasta atual.

### Token da API (preencher uma única vez)
O Nibo exige um token: **Sua Empresa → Mais opções → Configurações → API**.
Duas formas de configurar (a 2ª é a recomendada porque o projeto é público no GitHub):
1. Editar `lancar-nibo.bat` no Bloco de Notas e preencher `set "NIBO_APITOKEN=…"`; **ou**
2. Criar um arquivo `nibo\token.txt` contendo **só o token** (este arquivo está no
   `.gitignore` e nunca sobe para o GitHub).

### Requisitos na conta do Nibo
- As **categorias** e os **centros de custo** usados no Excel precisam já existir no
  Nibo com o nome exato (o script lista os que não encontrar e não envia nada).
- Fornecedores não precisam existir (são criados na hora).
