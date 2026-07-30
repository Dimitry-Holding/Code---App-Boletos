@echo off
setlocal
chcp 65001 >nul

REM ================================================================
REM   CONFIGURACAO - preencha UMA unica vez e salve este arquivo.
REM   Token da API do Nibo: Sua Empresa ^> Mais opcoes ^> Configuracoes ^> API
REM ================================================================
set "NIBO_APITOKEN=COLE_AQUI_O_TOKEN_DA_API_DO_NIBO"
REM ================================================================
REM   ATENCAO: o codigo deste projeto e PUBLICO no GitHub. Se preencher
REM   o token acima, NAO envie (commit/push) este arquivo. Alternativa
REM   mais segura: crie um arquivo token.txt nesta pasta contendo so o
REM   token (token.txt nunca vai para o GitHub - esta no .gitignore).
REM ================================================================
if exist "%~dp0token.txt" set /p NIBO_APITOKEN=<"%~dp0token.txt"

REM localiza o Node.js (instalado junto com o projeto)
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
  ) else (
    echo ERRO: Node.js nao encontrado nesta maquina. Instale em https://nodejs.org
    pause
    exit /b 1
  )
)

echo ==================================================
echo    LANCAMENTOS NIBO - APP BOLETOS
echo ==================================================
echo.
echo    1 - CONFERIR o Excel (nao envia nada ao Nibo)
echo    2 - TESTE no Nibo (cria e APAGA um lancamento de R$ 0,01)
echo    3 - ENVIAR de verdade (pede confirmacao digitada)
echo.
set /p OPCAO="Escolha 1, 2 ou 3 e aperte Enter: "

if "%OPCAO%"=="2" (
  "%NODE%" "%~dp0lancar-nibo.mjs" --teste
  goto fim
)

echo.
echo Arraste o arquivo Excel (nibo_lancamentos_...xlsx) para esta janela e aperte Enter:
set /p ARQUIVO=
set "ARQUIVO=%ARQUIVO:"=%"

if "%OPCAO%"=="3" (
  "%NODE%" "%~dp0lancar-nibo.mjs" --enviar "%ARQUIVO%"
) else (
  "%NODE%" "%~dp0lancar-nibo.mjs" "%ARQUIVO%"
)

:fim
echo.
pause
endlocal
