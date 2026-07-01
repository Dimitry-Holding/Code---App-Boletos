# 🛠️ Notas Fiscais Dimitry — Manual do Administrador

Guia para controlar as notas, baixar relatórios e gerenciar usuários.

---

## 1. Entrar como administrador

1. Abra o link do aplicativo: **https://__________________________**
2. Digite o **usuário** `admin` e a **senha**.
3. Toque em **Entrar**.

O administrador **não carrega** notas: apenas consulta, baixa e gerencia.

---

## 2. Tela principal — Notas fiscais

Você vê **todas as notas** de todos os usuários, em forma de tabela.

### Filtros
- **De / Até** — intervalo de datas (útil para os fechamentos de cada cartão, que têm
  períodos diferentes).
- **Usuário** — filtra por pessoa.
- **Cartão (TDC)** — filtra por cartão (4 últimos dígitos).

O **Total do período** soma os valores filtrados.

### Ações em cada linha
- **👁️ Ver** — abre a foto/PDF da nota.
- **⬇️ Baixar** — baixa a foto com o nome
  `Fornecedor-Data-R$Valor-Cartão` (ex.: `LAVANDERIA ASA SUL LTDA-2026-06-18-R$200,45-1261.jpg`).
- **🗑️ Excluir** — apaga a nota e a foto (pede confirmação).

---

## 3. Baixar relatórios

No topo da tela:

- **⬇️ Excel** — baixa uma planilha com todas as colunas das notas **do período filtrado**
  (ID, data, fornecedor, valor, categoria, pagamento, cartão, descrição, usuário e nome do arquivo).
- **📷 Fotos (ZIP)** — baixa **todas as fotos do período filtrado** em um único arquivo ZIP,
  cada foto já com o nome `Fornecedor-Data-R$Valor-Cartão`. Mostra o progresso (ex.: `5/20…`).

> 💡 Os dois botões respeitam os filtros (datas, usuário, cartão). Ajuste o filtro para o
> fechamento que quer revisar e baixe só o que precisa.

---

## 4. Gerenciar usuários — botão **👥 Usuários**

### Criar um usuário
1. Preencha **Nome**, **Usuário** (ex.: `nome.sobrenome`), **Senha** (mín. 6) e **Tipo**
   (Usuário ou Administrador).
2. Toque em **Criar usuário**.

### Redefinir senha
- Toque em **🔑 Senha** ao lado do usuário e digite a nova senha.

### Cartões e categorias de cada usuário
Cada usuário só vê **os cartões e categorias que você atribuir**.

1. Toque em **💳 Cartões e categorias** no usuário.
2. **Cartões**: informe um **apelido** (ex.: Santander) e os **4 últimos dígitos**,
   depois **+ Adicionar cartão**. Use o **✕** para remover.
3. **Categorias**: cole uma **categoria por linha** na caixa e toque em **+ Adicionar categorias**
   (dá para adicionar várias de uma vez). Use o **✕** para remover.

> ⚠️ Se um usuário não tiver cartões **ou** categorias, ele não conseguirá registrar notas.
> Atribua pelo menos um de cada.

---

## 5. Regras importantes

- **Edição/exclusão pelo usuário**: cada pessoa pode editar ou excluir as **próprias** notas
  **somente até 30 dias** depois de criadas. Depois disso, ficam bloqueadas para ela.
- **O administrador** pode **excluir qualquer nota** a qualquer momento.
- O **ID** de cada nota (`DMT-000123`) é único e **não muda** — é o que liga a linha do
  Excel com a sua foto.

---

## 6. Sair

Toque em **Sair**, no canto superior direito.

---

## Dicas de segurança
- Troque a senha do `admin` por uma só sua.
- Crie um usuário/administrador real com seu nome e use a conta de teste só no início.
- Não compartilhe as senhas por mensagem; se alguém esquecer, use **🔑 Redefinir senha**.
